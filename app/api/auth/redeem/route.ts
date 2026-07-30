import { NextResponse } from "next/server";
import { identityStore, UniqueViolation } from "@/lib/server/store";
import { hashPassword, passwordProblem } from "@/lib/server/password";
import { findLiveToken } from "@/lib/server/tokens";

/**
 * Redeem an invitation or a reset link by setting a password.
 *
 * Deliberately UNAUTHENTICATED — the whole point is that the person cannot sign
 * in yet. The token is the credential, which is why it is 32 random bytes,
 * stored only as a hash, single-use and short-lived.
 *
 * Order matters. The token is deleted BEFORE the password is written, so a
 * request that races itself finds nothing on the second pass. Writing first and
 * deleting after would leave a window where one link sets two passwords.
 *
 * GET describes a token without spending it, so the page can say "set your
 * password, Priya" rather than presenting a bare form to somebody who does not
 * know whether their link is still good.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEAD = "That link has expired or has already been used.";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const record = token ? await findLiveToken(token) : null;
  if (!record)
    return NextResponse.json(
      { ok: false, message: DEAD },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );

  return NextResponse.json(
    {
      ok: true,
      purpose: record.purpose,
      email: record.email,
      displayName: record.displayName,
      expiresAt: record.expiresAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let body: { token?: string; password?: string; confirmPassword?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "That request could not be read." }, { status: 400 });
  }

  const record = body.token ? await findLiveToken(body.token) : null;
  if (!record)
    return NextResponse.json({ ok: false, message: DEAD }, { status: 404 });

  const password = body.password ?? "";
  const issue = passwordProblem(password);
  if (issue)
    return NextResponse.json({ ok: false, field: "password", message: issue }, { status: 400 });
  if (password !== (body.confirmPassword ?? ""))
    return NextResponse.json(
      { ok: false, field: "confirmPassword", message: "The two passwords do not match." },
      { status: 400 },
    );

  /* Spent first. See the note above — this is what makes the link single-use
     even against a double submit. */
  await identityStore.deleteToken(record.tokenHash);

  try {
    const passwordHash = await hashPassword(password);
    const existing = await identityStore.findAccountByEmail(record.email);

    if (existing) {
      /* A reset also ends every live session for that account — see
         `setPassword`. The old credential may be the reason for the reset. */
      await identityStore.setPassword(existing.id, passwordHash);
    } else {
      await identityStore.createAccountForEmployee({
        organisationId: record.organisationId,
        email: record.email,
        displayName: record.displayName,
        employeeId: record.employeeId,
        passwordHash,
        /* Invitations always create an ORDINARY account. The workspace role is
           whatever an administrator granted the employee; the auth archetype
           governs route access and must not be inheritable from a link. An
           endpoint that accepted an archetype here would be an escalation. */
        archetype: "employee",
      });
    }

    /* No session is issued. Redeeming proves you hold the link, not that you
       are the person — they sign in with the password they just chose, which
       is the step that actually authenticates. */
    return NextResponse.json({ ok: true, email: record.email });
  } catch (err) {
    if (err instanceof UniqueViolation)
      return NextResponse.json(
        { ok: false, message: "An account already exists for that address. Sign in instead." },
        { status: 409 },
      );
    console.error("[auth] redeem failed", err);
    return NextResponse.json(
      { ok: false, message: "The password could not be set. Try again." },
      { status: 500 },
    );
  }
}
