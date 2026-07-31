import "server-only";
import { currentSession } from "./session";
import { readFirebaseCookie } from "@/lib/auth/firebaseCookie";

/**
 * Who a mail request is for — resolved by EITHER auth system the product runs on.
 *
 * **The gap this closes.** The Gmail routes authenticated with `currentSession()`
 * alone — the server-side session issued by `/api/auth/signup`. But every real
 * employee signs in through Firebase (`SignInForm`), and nothing issues a
 * `cowork_session` on that path, so `currentSession()` was null for the whole
 * company. The routes returned `401 "Not authenticated."` and the Connect button
 * hid itself — a mailbox nobody could reach, on the auth system nobody uses.
 *
 * This resolves the caller by the token every employee actually holds:
 *
 *  · `cowork_session` first, so a prototype/server-session caller is unchanged.
 *  · else the Firebase ID token cookie, handed to the LEGACY engine's
 *    `/cowork/me` — the same call that bootstraps the session in the browser. It
 *    is the authority on the workspace `employeeId`, and it VERIFIES the token
 *    (an invalid one 401s), so trusting its answer is trusting the same signature
 *    check `middleware.ts` makes. The server never derives the id from claims it
 *    did not verify, and never trusts an id the client supplied.
 */
export interface MailPrincipal {
  /** Keys the stored Gmail connection. */
  employeeId: string;
  /**
   * Binds the OAuth `state`, so a callback cannot be replayed against another
   * account. The server session has a distinct account id; on the Firebase path
   * the verified `employeeId` is the only identity there is, and the signed,
   * expiring state is what makes it unforgeable regardless.
   */
  stateKey: string;
  /** The sender's name for an outgoing "From", where the identity carries one. */
  displayName: string | null;
}

function legacyApiBase(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_LEGACY_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "";
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed || null;
}

export async function mailPrincipal(
  request: Request,
): Promise<MailPrincipal | null> {
  const session = await currentSession();
  if (session)
    return {
      employeeId: session.employeeId,
      stateKey: session.accountId,
      displayName: session.displayName ?? null,
    };

  const token = readFirebaseCookie(request.headers.get("cookie"));
  if (!token) return null;

  const base = legacyApiBase();
  if (!base) return null;

  try {
    const r = await fetch(`${base}/cowork/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const me = (await r.json()) as {
      employeeId?: unknown;
      name?: unknown;
      displayName?: unknown;
      data?: { employeeId?: unknown; name?: unknown };
    };
    const employeeId = String(me.employeeId ?? me.data?.employeeId ?? "").trim();
    if (!employeeId) return null;
    const nameRaw = me.name ?? me.displayName ?? me.data?.name ?? null;
    const displayName =
      typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : null;
    return { employeeId, stateKey: employeeId, displayName };
  } catch {
    /* The engine being unreachable is a "cannot resolve", not a "not you". The
       route turns a null into its own 401/503; here we only report that we could
       not name the caller. */
    return null;
  }
}
