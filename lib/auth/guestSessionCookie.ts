/**
 * The external-share guest session cookie's name and lifetime, in a module
 * with NO imports — matching `sessionCookie.ts`'s own reasoning: this name is
 * needed by both a Route Handler (`app/api/share/accept/route.ts`, which sets
 * it) and a server component (`app/share/view/[kind]/[id]/page.tsx`, which
 * reads it), and a bare constant has nothing to drag into either bundle.
 *
 * httpOnly, unlike `FIREBASE_COOKIE` — there is no client-side code that
 * needs to read this one. The view page reads it SERVER-SIDE via
 * `next/headers` and hands the plaintext down to the guest viewer as a prop,
 * the same way `app/meetings/guest/[token]/page.tsx` hands its URL token down
 * to `GuestMeetingArea`. It never becomes a document.cookie value a script on
 * the page could read.
 */
export const GUEST_SESSION_COOKIE = "cowork_guest_session";

/** Ninety days, matching `SESSION_LIFETIME_MS` in the backend's
    `shareInvite.service.js` — the cookie must not outlive the credential it
    carries. */
export const GUEST_SESSION_COOKIE_MAX_AGE = 90 * 24 * 60 * 60;
