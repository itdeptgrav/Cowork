import { NextResponse } from "next/server";
import { currentSession, mayOpenAdmin } from "@/lib/server/session";
import { identityStore, normaliseEmail } from "@/lib/server/store";

/**
 * The AUTH facts about one employee, for the administration screen.
 *
 * Separate from the workspace's `getEmployee` because it crosses the boundary
 * the whole architecture rests on: employees live in the workspace, accounts
 * live server-side, and only the server may join them. A client that could ask
 * "does this address have an account" without a session would have an
 * enumeration oracle.
 *
 * It deliberately returns NOTHING sensitive — no hash, no session tokens, no
 * phone. Whether an account exists, whether it is active, what it may open, and
 * when it was last used. That is what an administrator needs to answer "can
 * this person get in", and nothing more.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session)
    return NextResponse.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!mayOpenAdmin(session.archetype))
    return NextResponse.json({ ok: false }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const email = normaliseEmail(
    new URL(request.url).searchParams.get("email") ?? "",
  );
  if (!email)
    return NextResponse.json(
      { ok: true, hasAccount: false },
      { headers: { "Cache-Control": "no-store" } },
    );

  const account = await identityStore.findAccountByEmail(email);
  const tokens = await identityStore.listTokens();
  const now = new Date().toISOString();
  const pending = tokens.find((t) => t.email === email && t.expiresAt > now);

  return NextResponse.json(
    {
      ok: true,
      hasAccount: !!account,
      status: account?.status ?? null,
      archetype: account?.archetype ?? null,
      lastSeenAt: account?.lastSeenAt ?? null,
      createdAt: account?.createdAt ?? null,
      /* An outstanding invitation is a state an administrator has to be able to
         see — otherwise "why has she not signed in" has no answer, and they
         re-issue a link that silently invalidates the one already sent. */
      pendingLink: pending
        ? { purpose: pending.purpose, expiresAt: pending.expiresAt }
        : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
