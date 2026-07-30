import { NextResponse } from "next/server";
import { identityStore } from "@/lib/server/store";
import { burnPasswordTime, verifyPassword } from "@/lib/server/password";
import { issueSession, landingFor } from "@/lib/server/session";

/**
 * Email and password in, a session cookie out.
 *
 * **One failure message for every credential failure.** Unknown address, wrong
 * password, suspended account — all "Those details do not match an account."
 * Distinguishing them is friendly to the person who mistyped and equally
 * friendly to somebody working through a breach list, and the second use is the
 * one that matters. The timing is equalised too, so the answer cannot be read
 * from the clock instead of the body.
 *
 * A crude per-address throttle sits in front. It is memory-only and therefore
 * per-process — real rate limiting belongs in front of the application — but
 * unlimited password guessing at full speed is worse than an imperfect brake.
 */

export const runtime = "nodejs";

const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; first: number }>();

function throttled(key: string): boolean {
  const now = Date.now();
  const seen = attempts.get(key);
  if (!seen || now - seen.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return false;
  }
  seen.count += 1;
  return seen.count > MAX_ATTEMPTS;
}

function clearThrottle(key: string) {
  attempts.delete(key);
}

const DENIED = "Those details do not match an account.";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json(
      { ok: false, message: "That request could not be read." },
      { status: 400 },
    );
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!email || !password)
    return NextResponse.json(
      { ok: false, message: "Enter your email address and password." },
      { status: 400 },
    );

  if (throttled(email))
    return NextResponse.json(
      {
        ok: false,
        message:
          "Too many attempts. Wait a few minutes before trying again.",
      },
      { status: 429 },
    );

  const account = await identityStore.findAccountByEmail(email);

  if (!account) {
    /* Spend the time a real verification would have taken. Returning now would
       make "no such account" measurably faster than "wrong password", which is
       an account-enumeration oracle regardless of how identical the wording is. */
    await burnPasswordTime();
    return NextResponse.json({ ok: false, message: DENIED }, { status: 401 });
  }

  const valid = await verifyPassword(password, account.passwordHash);
  if (!valid || account.status !== "active")
    return NextResponse.json({ ok: false, message: DENIED }, { status: 401 });

  clearThrottle(email);
  await issueSession(account, request.headers.get("user-agent"));
  await identityStore.touchAccount(account.id, new Date().toISOString());

  /* Where they land is decided here, from the stored archetype. The client is
     told; it does not work it out. */
  return NextResponse.json({
    ok: true,
    landing: landingFor(account.archetype),
    account: {
      displayName: account.displayName,
      email: account.email,
      archetype: account.archetype,
    },
  });
}
