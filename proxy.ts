import { NextResponse, type NextRequest } from "next/server";
import { FIREBASE_COOKIE, readFirebaseCookie } from "@/lib/auth/firebaseCookie";
import { decode, checkClaims, verifyIdToken } from "@/lib/auth/firebaseToken";

/**
 * The route gate.
 *
 * Runs on the Edge before any page renders, so an unauthenticated request never
 * reaches a component that would have fetched somebody's data. A client-side
 * redirect cannot do that: by the time React decides to send you away, the page
 * has already mounted and its queries have already run.
 *
 * **What this can and cannot check.** The Edge runtime has Web Crypto but no
 * `node:crypto` and no access to the identity store, so this verifies the
 * cookie's SIGNATURE and nothing else. It is a cheap first gate that turns away
 * anyone without a validly-signed token; it deliberately does not decide
 * authorisation. The session record, its expiry, the account's status and the
 * archetype are all resolved server-side in `currentSession`, and `/admin` is
 * gated there — see `app/admin/layout.tsx`.
 *
 * Stating that split matters: a middleware that appeared to authorise, while
 * only checking a signature, would be trusted for more than it can carry.
 */

const PUBLIC_PATHS = new Set(["/signin", "/signup", "/reset-password"]);

/**
 * The legacy-migration operator surfaces, open in development only.
 *
 * `/legacy/*` diagnoses the connection to the existing Cowork engine: the
 * health checks, the sign-in that obtains a Firebase token, and the directory
 * read back through it. They are unreachable behind this app's own sign-in
 * during the migration, because the person setting the connection up does not
 * necessarily have an account in the app they are connecting *from*, and the
 * health page in particular has to render when everything else is broken.
 *
 * **Development only, and it opens nothing.** In production these routes are
 * gated exactly like the rest. Even here they display no data on their own:
 * every one of them requires a separate sign-in to the legacy Firebase project
 * before the engine returns a single record, and that gate is untouched.
 *
 * The check is against `NODE_ENV`, which Next fixes at build time — a
 * production build cannot take this branch whatever the runtime environment
 * says.
 */
function isLegacyOperatorSurface(pathname: string): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    (pathname === "/legacy" || pathname.startsWith("/legacy/"))
  );
}

/** Routes that exist for people who are not signed in yet. */
function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/join/") ||
    pathname.startsWith("/meetings/guest/") ||
    pathname === "/privacy" ||
    /* The offline page must render without a session, and for a reason beyond
       the usual one: the service worker precaches it, and a precache fetch
       carries no credentials. Gated, it would cache the sign-in redirect and
       every offline navigation would land there instead — a page that itself
       needs the network to be useful. */
    pathname === "/offline" ||
    isLegacyOperatorSurface(pathname)
  );
}

/**
 * Whether the request carries a live, **genuinely signed** Firebase ID token.
 *
 * ## This used to check claims only, and that was an authentication bypass
 *
 * The previous implementation decoded the token and checked issuer, audience
 * and expiry — all of which are attacker-controlled, because a JWT's payload is
 * base64, not a secret. The cookie is written by client JavaScript and is
 * therefore not `httpOnly`, so anyone could mint one:
 *
 * ```
 * header  {"alg":"RS256","kid":"fake"}
 * payload {"iss":"https://securetoken.google.com/<project>","aud":"<project>",
 *          "sub":"anyone","exp":<now+3600>}
 * sig     not-a-real-signature
 * ```
 *
 * Verified against the running app: that cookie returned **200 on `/team`**.
 * The whole workspace shell rendered for a request carrying a forged
 * credential.
 *
 * The old comment justified this as a "cheap first gate" that never claims to
 * authorise, with real authority established later when the legacy engine
 * verifies the token properly. That reasoning protects the *data* — and it did:
 * the engine rejects a forged token, so no record is returned. It does not
 * protect the *application*, and a gate whose entire job is to turn away
 * unauthenticated requests must not accept a credential anyone can type.
 *
 * ## The latency objection, and why it does not hold
 *
 * Verifying needs Google's public certificates. `fetchCertificates` caches them
 * for as long as Google's own `Cache-Control` allows — hours — so this is one
 * fetch per cache period for the whole deployment, not one per navigation. That
 * is a fair price for the difference between checking a credential and reading
 * one.
 *
 * ## Failure is closed
 *
 * If the certificates cannot be fetched, verification fails and the request is
 * treated as unauthenticated. A transient failure signing everybody out is
 * worse than an inconvenience — but it is much better than the alternative,
 * where an outage at Google turns the gate off.
 */
async function hasLiveFirebaseToken(
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false;

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  /* No project configured means no way to check the audience, and an
     unverifiable token is not a valid one. */
  if (!projectId) return false;

  /* Claims first — it is free, and it rejects the expired and the
     wrong-audience without touching the network. */
  const decoded = decode(token);
  if (!decoded) return false;
  if (
    !checkClaims({
      payload: decoded.payload,
      projectId,
      nowSeconds: Math.floor(Date.now() / 1000),
    }).ok
  ) {
    return false;
  }

  /* Then the signature, which is the part that makes the claims mean
     anything. */
  try {
    const result = await verifyIdToken({ token, projectId });
    return result.ok;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const signedIn = await hasLiveFirebaseToken(
    request.cookies.get(FIREBASE_COOKIE)?.value ??
      readFirebaseCookie(request.headers.get("cookie")),
  );

  if (isPublic(pathname)) {
    /* Already signed in and asking for the sign-in page: send them to the
       workspace rather than showing a form that would sign them in as the
       person they already are. `/home` rather than their archetype's landing —
       middleware cannot read the archetype, and guessing would send an
       administrator to the wrong place. */
    /* `/reset-password` is deliberately NOT bounced for a signed-in visitor.
       Somebody may hold a link for a colleague, or be resetting their own
       password on a shared machine, and redirecting them to the workspace
       would silently discard a single-use token. */
    if (signedIn && (pathname === "/signin" || pathname === "/signup"))
      return NextResponse.redirect(new URL("/home", request.url));
    return NextResponse.next();
  }

  if (!signedIn) {
    const url = new URL("/signin", request.url);
    /* Carry where they were going, so signing in resumes it instead of dumping
       everyone on the same landing page. Only the path and query — never an
       absolute URL, which would make this an open redirect. */
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Everything except Next's own assets, the auth endpoints and the favicon.
   *
   * The auth endpoints are excluded because they are how you become
   * authenticated; running the gate over them would make signing in require
   * being signed in. Other `/api` routes are NOT excluded — they carry data and
   * are gated like any page.
   */
  /**
   * The push and install assets are excluded, and they have to be.
   *
   * Without it the gate matched `firebase-messaging-sw.js`, found no session on
   * the request and answered **307 to `/signin`** — verified against the running
   * dev server. `navigator.serviceWorker.register` treats a redirect as a
   * failure, so push registration could never have succeeded, and the symptom
   * is silent: the app works, the bell works, and only the phone stays quiet.
   *
   * `manifest.json` and the icons are here for the same reason and one more.
   * **iOS delivers web push only to a site installed to the Home Screen**, and
   * Safari will not offer the install unless it can fetch a valid manifest —
   * which it requests WITHOUT credentials, so a redirect to the sign-in page is
   * exactly what it would get. Gating them makes push unreachable on every
   * iPhone by a route nobody would think to look at.
   *
   * Excluding them opens nothing. They are static files of routing constants,
   * icons, and the project's own public Firebase config; none reads a session,
   * and the worker receives only what the sender already addressed to that
   * device's token.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth|uireferences|firebase-messaging-sw.js|manifest.json|icon-192.png|icon-512.png|apple-icon.png).*)",
  ],
};
