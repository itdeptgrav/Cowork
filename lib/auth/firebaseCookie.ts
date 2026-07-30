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
 * Seconds a mirrored token is allowed to live.
 *
 * An hour, matching Firebase's own token lifetime. The SDK refreshes ahead of
 * expiry and rewrites this, so a live session never lapses; a browser closed
 * mid-session leaves nothing usable behind for long.
 */
export const FIREBASE_COOKIE_MAX_AGE = 3600;

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
