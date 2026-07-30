import { NextResponse } from "next/server";
import { currentSession, mayOpenAdmin } from "@/lib/server/session";
import { identityStore, normaliseEmail } from "@/lib/server/store";
import { issueToken, type TokenPurpose } from "@/lib/server/tokens";

/**
 * Issue an invitation or a password-reset link for somebody else.
 *
 * The most dangerous endpoint in the product: it mints a credential for another
 * person. Three gates, in this order, and none of them is the client's word:
 *
 *  1. There must be a session, resolved server-side.
 *  2. The caller's archetype must be one that may administer. The BROWSER never
 *     supplies this — it comes from the account record.
 *  3. Nobody may target an account whose archetype outranks their own. This is
 *     the administrative floor the domain already enforces for role edits, and
 *     it matters more here: without it, People Operations could mint a reset
 *     link for the system administrator and take the organisation.
 *
 * The purpose is DERIVED, not accepted. A caller that could ask for "invite"
 * against an existing account would be asking to overwrite a live credential.
 */

export const runtime = "nodejs";

const RANK: Record<string, number> = {
  employee: 10,
  manager: 30,
  skip_level: 50,
  people_ops: 70,
  system_admin: 100,
};

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session)
    return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });
  if (!mayOpenAdmin(session.archetype))
    return NextResponse.json(
      { ok: false, message: "Your role cannot issue sign-in links." },
      { status: 403 },
    );

  let body: { email?: string; employeeId?: string; displayName?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "That request could not be read." }, { status: 400 });
  }

  const email = normaliseEmail(body.email ?? "");
  const employeeId = (body.employeeId ?? "").trim();
  const displayName = (body.displayName ?? "").trim();
  if (!email || !employeeId)
    return NextResponse.json(
      { ok: false, message: "An email address and an employee are required." },
      { status: 400 },
    );

  const existing = await identityStore.findAccountByEmail(email);

  /* The administrative floor. `>=` rather than `>`: two administrators must not
     be able to reset each other, which is the loop that makes the floor
     meaningless. Comparing an account to itself is allowed — resetting your own
     password is not an escalation. */
  if (
    existing &&
    existing.id !== session.accountId &&
    (RANK[existing.archetype] ?? 0) >= (RANK[session.archetype] ?? 0)
  )
    return NextResponse.json(
      {
        ok: false,
        message:
          "That person's role is at or above your own. You cannot issue a sign-in link for them.",
      },
      { status: 403 },
    );

  if (existing && existing.employeeId !== employeeId)
    return NextResponse.json(
      {
        ok: false,
        message:
          "That email address already belongs to a different account in this workspace.",
      },
      { status: 409 },
    );

  const purpose: TokenPurpose = existing ? "reset" : "invite";

  /* Supersede rather than accumulate. Two live links for one address means the
     older one still works after somebody re-issued because the first went
     astray — which is the case you re-issue FOR. */
  await identityStore.deleteTokensForEmail(email);

  const { plaintext, record } = issueToken({
    purpose,
    email,
    employeeId,
    displayName: displayName || existing?.displayName || email,
    organisationId: session.organisationId,
    createdByAccountId: session.accountId,
  });
  await identityStore.createToken(record);

  const origin = new URL(request.url).origin;
  return NextResponse.json({
    ok: true,
    purpose,
    /* The plaintext exists here and nowhere else. Only a hash was stored, so
       this response is the single opportunity to read it — which is why the UI
       makes the administrator copy it before dismissing. */
    link: `${origin}/reset-password?token=${plaintext}`,
    expiresAt: record.expiresAt,
  });
}
