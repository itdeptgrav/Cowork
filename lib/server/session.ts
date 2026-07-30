import { canAccessAdminConsole } from "@/lib/rules/admin/access";
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { identityStore, type Account } from "./store";
import { SESSION_COOKIE } from "@/lib/auth/sessionCookie";

/**
 * Sessions.
 *
 * The cookie carries `<sessionId>.<hmac>` — an opaque id plus a signature over
 * it. Two deliberate properties:
 *
 *  · **The cookie holds no claims.** No role, no email, no expiry the client
 *    could read or edit. Everything the server acts on is looked up from the
 *    session record, so a stolen cookie cannot be *edited* into a better one —
 *    only replayed, which is what expiry and revocation are for.
 *  · **Sessions are records, so they can be revoked.** A stateless JWT cannot
 *    be withdrawn before it expires, which means "sign out everywhere" and
 *    "this account is suspended" are both unenforceable until it lapses. For an
 *    enterprise product where an administrator may need somebody out *now*,
 *    that is the wrong trade.
 *
 * The signature exists to make the id unguessable-and-unforgeable in one step:
 * without it, a valid-looking id is a lookup, and lookups on attacker-supplied
 * values are how enumeration starts. It is checked before the store is touched.
 */

export { SESSION_COOKIE };
const SESSION_DAYS = 14;

/**
 * The signing secret.
 *
 * In production it MUST come from the environment. The dev fallback is a fixed
 * string, and that is safe only because it is paired with the hard refusal
 * below: a production build without `COWORK_SESSION_SECRET` throws at first use
 * rather than quietly signing every session in the world with a value that is
 * in the repository.
 */
function secret(): Buffer {
  const fromEnv = process.env.COWORK_SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) return Buffer.from(fromEnv, "utf8");

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "COWORK_SESSION_SECRET is missing or shorter than 32 characters. " +
        "Set it to a random value — sessions cannot be signed safely without it.",
    );
  }
  return Buffer.from(
    "cowork-development-session-secret-not-for-production",
    "utf8",
  );
}

function sign(sessionId: string): string {
  return createHmac("sha256", secret()).update(sessionId).digest("base64url");
}

function verifyToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(id);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

/* ── Issuing ──────────────────────────────────────────────────────────────── */

export async function issueSession(
  account: Account,
  userAgent: string | null,
): Promise<void> {
  const id = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400_000);

  await identityStore.createSession({
    id,
    accountId: account.id,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    userAgent: userAgent?.slice(0, 200) ?? null,
  });
  /* Opportunistic, and cheap: without it the session list grows forever and
     every expired record stays queryable. */
  await identityStore.deleteExpiredSessions(now.toISOString());

  const jar = await cookies();
  jar.set(SESSION_COOKIE, `${id}.${sign(id)}`, {
    httpOnly: true,
    /* Not readable by script, so XSS cannot exfiltrate it. */
    sameSite: "lax",
    /* `lax` rather than `strict`: `strict` drops the cookie on any inbound
       navigation from another site, so a link to Cowork in an email would land
       on the sign-in page for an already-signed-in person. `lax` still refuses
       to send on cross-site POST, which is the CSRF case that matters. */
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const id = verifyToken(token);
    /* Delete the RECORD, not just the cookie. Clearing only the cookie leaves a
       live session that a copy of the token still opens — "sign out" that does
       not revoke is a checkbox, not a security control. */
    if (id) await identityStore.deleteSession(id);
  }
  jar.delete(SESSION_COOKIE);
}

/* ── Reading ──────────────────────────────────────────────────────────────── */

export interface SessionUser {
  accountId: string;
  organisationId: string;
  /**
   * Carried so the workspace can file the founder under their own organisation
   * when it provisions them. Without it the first administrator arrives with no
   * department at all, which reads as a broken record rather than a new one.
   */
  organisationName: string;
  employeeId: string;
  email: string;
  displayName: string;
  archetype: Account["archetype"];
}

/**
 * The signed-in account, or null.
 *
 * Every gate in the application funnels through here, so the checks are in one
 * place and in the right order: signature, then record, then expiry, then
 * account status. A suspended account with a live session is refused on the
 * next request rather than at the next signin.
 */
export async function currentSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const id = verifyToken(token);
  if (!id) return null;

  const record = await identityStore.findSession(id);
  if (!record) return null;

  if (record.expiresAt <= new Date().toISOString()) {
    await identityStore.deleteSession(id);
    return null;
  }

  const account = await identityStore.findAccountById(record.accountId);
  if (!account || account.status !== "active") return null;

  const org = await identityStore.findOrganisationById(account.organisationId);

  return {
    accountId: account.id,
    organisationId: account.organisationId,
    organisationName: org?.name ?? "",
    employeeId: account.employeeId,
    email: account.email,
    displayName: account.displayName,
    archetype: account.archetype,
  };
}

/* ── Where a signed-in person belongs ─────────────────────────────────────── */

/**
 * The landing route for an archetype, decided on the SERVER.
 *
 * The brief's requirement — "do not hardcode roles only on frontend" — is met
 * by this living behind the session and being returned by the signin endpoint
 * rather than computed from anything the browser holds. The client is told
 * where to go; it does not work it out.
 *
 * These are existing Cowork routes, not new dashboards: an administrator's home
 * is organisation administration, a manager's is live monitoring, and everyone
 * else's is the workspace itself.
 */
export function landingFor(archetype: Account["archetype"]): string {
  switch (archetype) {
    case "system_admin":
      return "/admin/organisation";
    case "people_ops":
      /* No longer an administrator, so no longer landed in the console. The
         workspace is where they now start; a directory surface outside
         `/admin` is the fix if they need one, not a second archetype in
         `canAccessAdminConsole`. */
      return "/home";
    case "manager":
    case "skip_level":
      return "/manager";
    case "employee":
    default:
      return "/home";
  }
}

/**
 * Which archetypes may open the administration area.
 *
 * Enforced in middleware for the route and by `can()` for every action inside
 * it. Two layers on purpose: the route gate stops a URL being typed, and the
 * capability check stops a request that got past it doing anything.
 */
export function mayOpenAdmin(archetype: Account["archetype"]): boolean {
  /* Delegated, not decided here. This used to read
     `system_admin || people_ops` while the settings repository separately
     inferred an administrator from `legacyRole === "ceo"` — two definitions in
     one codebase, and which one applied depended on whether the request came
     through a page or a repository call. */
  return canAccessAdminConsole({ archetype });
}

/**
 * **This is the ONLY thing an administrator gets that a manager does not.**
 *
 * Stated here because it is the load-bearing half of the role model: `/admin`
 * opens, and nothing else changes. An administrator's reach over people —
 * whose work they see on Team, whose tasks they may read, who they may
 * monitor — comes from `hierarchyIds`, which is computed from the reporting
 * tree and never consults an archetype.
 *
 * So a CEO with no direct reports sees no team, exactly as a TL with no direct
 * reports sees none. That is not a bug to be patched by special-casing the
 * administrator; it is the model working. The fix for an empty team is a
 * reporting line, not a role.
 *
 * If a future capability needs to bypass the hierarchy, it must say so
 * explicitly as its own capability with its own scope. Widening this predicate
 * would silently turn "may configure the system" into "may read everybody",
 * which are different powers and should be granted separately.
 */
export const ADMIN_GRANTS_NO_HIERARCHY_REACH = true;
