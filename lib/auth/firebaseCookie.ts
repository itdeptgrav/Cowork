/**
 * Mirroring the Firebase ID token into a cookie, so the Edge can see it.
 *
 * **Why this exists.** The Firebase SDK keeps its token in IndexedDB, which is
 * reachable from JavaScript and from nowhere else. Middleware runs on the Edge,
 * before any JavaScript, and sees only cookies and headers. So a token the
 * browser holds is invisible to the gate that has to check it.
 *
 * The usual answer is a Firebase *session cookie*, minted by the Admin SDK —
 * which needs `LEGACY_FIREBASE_SERVICE_ACCOUNT`. We do not have it, and waiting
 * on a credential to check who somebody is would block the whole migration. So
 * the client mirrors its own ID token into a cookie and the Edge verifies it
 * against Google's published keys.
 *
 * **What that costs, stated plainly.** This cookie cannot be `httpOnly` — the
 * client has to write it. So it is readable by any script on the origin, which
 * an `httpOnly` session cookie would not be.
 *
 * It is not a *new* exposure: the same token already sits in IndexedDB, equally
 * readable by the same scripts, because that is where the Firebase SDK puts it.
 * Anything able to read this cookie could already have read the token. What
 * would be a real regression is XSS turning into a *durable* compromise — and
 * the short lifetime below is the answer to that: Firebase ID tokens expire in
 * an hour and this cookie is written to expire with them.
 *
 * When the service account arrives, the better shape is an `httpOnly` session
 * cookie minted server-side, and this module is the only thing that changes.
 */

/** Distinct from the scrypt session's cookie, which still exists. */
export const FIREBASE_COOKIE = "cowork_fb";

/**
 * How long the COOKIE survives — which is not how long the TOKEN inside it is
 * good for, and conflating the two is what signed people out overnight.
 *
 * **It was an hour, matching the token, and that was the bug.** Close the
 * browser, come back after lunch, and the cookie is gone — so middleware, which
 * runs before any JavaScript, sees no credential and redirects to the sign-in
 * page. Meanwhile Firebase's REFRESH token is sitting in IndexedDB, perfectly
 * valid, and would have restored the session in milliseconds. The person is
 * asked to type a password to recover a session that never actually ended.
 *
 * The cookie has two jobs and only one of them is about liveness:
 *
 *  1. Carry a live ID token, so the Edge can verify a signed-in request without
 *     a round trip. Firebase refreshes hourly and `onIdTokenChanged` rewrites
 *     this each time, so while a tab is open it stays fresh on its own.
 *  2. Say **"this browser has a session worth restoring"** — which remains true
 *     long after the token inside has expired, and is exactly what the Edge
 *     needs to know to let the client try.
 *
 * Thirty days is the ceiling on the second. Beyond it the browser drops the
 * cookie and the person signs in again, which is a reasonable outer bound for
 * an unattended machine. Nothing here weakens the first job: `proxy.ts` still
 * verifies the signature and the audience on every request, and an expired
 * token buys nothing except the chance to refresh — see `EXPIRY_GRACE_SECONDS`.
 */
export const FIREBASE_COOKIE_MAX_AGE = 30 * 24 * 3600;

/**
 * How far past `exp` the Edge will still let a request through to the client.
 *
 * **Not a relaxation of the signature check — that never moves.** The token
 * must still be signed by Google, for this project, for a real subject. What
 * this decides is what to do with an authentic token that has merely aged out,
 * and the answer is: let the application load so the SDK can mint a fresh one,
 * rather than bouncing somebody who is signed in to a form that will sign them
 * in as themselves.
 *
 * That is safe because the Edge is the first gate, not the only one. Every call
 * that touches data mints a token through the SDK and is verified again by the
 * engine; the shell resolves the session on load and, if it cannot, redirects
 * and clears this cookie itself. What an expired token cannot do is read
 * anything.
 *
 * Bounded rather than unlimited so an ancient cookie found on a shared machine
 * is not a skeleton key: past this, it is treated as no cookie at all.
 */
export const EXPIRY_GRACE_SECONDS = 30 * 24 * 3600;

/**
 * Write the token where the Edge can read it.
 *
 * `SameSite=Lax` rather than `Strict`: `Strict` withholds the cookie on a
 * top-level navigation *into* the site, so following a link to `/home` from
 * anywhere else would arrive without it and bounce to sign-in with the person
 * already signed in.
 */
export function writeFirebaseCookie(token: string): void {
  if (typeof document === "undefined") return;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${FIREBASE_COOKIE}=${token}; Path=/; Max-Age=${FIREBASE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

export function clearFirebaseCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${FIREBASE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * The token from a `Cookie` header value.
 *
 * Written for the Edge, where there is a header string rather than a parsed
 * jar. Splitting on `;` and taking the first `=` is enough: a JWT contains no
 * `;` and its `=` padding is stripped by base64url.
 */
export function readFirebaseCookie(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === FIREBASE_COOKIE) {
      const value = part.slice(eq + 1).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}
