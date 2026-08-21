"use client";

import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import {
  type Auth,
  type User,
  EmailAuthProvider,
  browserLocalPersistence,
  getAuth,
  reauthenticateWithCredential,
  setPersistence,
  onAuthStateChanged,
  onIdTokenChanged,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from "firebase/auth";
import { type Firestore, getFirestore } from "firebase/firestore";
import { type LegacyConfig, readConfig } from "./config.ts";
import { PUBLIC_ENV } from "./publicEnv.ts";

/**
 * The one place Firebase is imported.
 *
 * **No component may import `firebase/*` directly.** Not a style preference: the
 * legacy frontend imports Firebase in 61 files and writes to Firestore from 29
 * of them, which is precisely why its business rules are advisory — anything the
 * browser can reach, the browser can bypass. Keeping the import to one module is
 * what makes "every write goes through a server that checks it" enforceable
 * rather than aspirational.
 *
 * It exports **auth and Firestore**, matching `cowork-old-frontend`. That was
 * once auth-only, on a plan to proxy every read through a server. The settled
 * architecture is the old app's: Firebase for authentication, Firestore for
 * live reads and writes, the Express backend for everything it already serves.
 * Reads are direct because that is what the existing product does, and a
 * re-skin does not get to change it.
 *
 * The single import site still matters. One Firebase app means one auth state;
 * two would mean a token refresh on one leaving the other stale.
 *
 * Why Firebase at all, when this project already has a session system: the
 * legacy `verifyCoworkToken` middleware accepts nothing but a Firebase ID token.
 * Signing in to the legacy engine means holding one. The existing scrypt session
 * remains in place and untouched — see `auth.ts` for how the two coexist.
 */

let cached: { app: FirebaseApp; auth: Auth; db: Firestore } | null = null;

/**
 * The legacy Firebase app, created once.
 *
 * `getApps()` is checked because Next's fast refresh re-runs module bodies, and
 * a second `initializeApp` with the same name throws.
 */
export function legacyFirebase(
  env: Record<string, string | undefined> = PUBLIC_ENV,
): { app: FirebaseApp; auth: Auth; db: Firestore; config: LegacyConfig } {
  const config = readConfig(env);
  if (!cached) {
    const existing = getApps().find((a) => a.name === LEGACY_APP_NAME);
    const app = existing ?? initializeApp(config.firebase, LEGACY_APP_NAME);
    const auth = getAuth(app);
    /**
     * **Stated rather than inherited: a session survives closing the browser.**
     *
     * `browserLocalPersistence` is the SDK's default, so this changes nothing
     * today — which is exactly why it is worth writing down. The alternative,
     * `browserSessionPersistence`, keeps the refresh token in `sessionStorage`
     * and throws it away when the tab closes, and switching to it is a one-word
     * edit that would look like tidying up and would sign the whole company out
     * every evening. Presence, drafts and timers all assume the person comes
     * back to the session they left.
     *
     * Not awaited: it resolves against the persistence layer and any sign-in
     * issued before it lands is re-persisted by the SDK itself. A rejection
     * means the browser has no durable storage — private mode, or storage
     * disabled — where the fallback is an in-memory session, and there is
     * nothing better to do than let it be one.
     */
    void setPersistence(auth, browserLocalPersistence).catch(() => {});
    cached = { app, auth, db: getFirestore(app) };
  }
  return { ...cached, config };
}

/**
 * A named app rather than the default one.
 *
 * The new project may one day hold its own Firebase project for something
 * unrelated. A named app means the legacy connection cannot be picked up by
 * accident, and cannot pick up somebody else's default.
 */
const LEGACY_APP_NAME = "cowork-legacy";

/**
 * The current Firebase ID token, or null when nobody is signed in.
 *
 * Not cached here. The SDK already refreshes on its own schedule and returns a
 * live token; caching a second copy is how a request goes out with a token that
 * expired thirty seconds ago.
 */
export async function idToken(): Promise<string | null> {
  const { auth } = legacyFirebase();
  const user = auth.currentUser;
  if (!user) return null;
  return withTimeout(user.getIdToken(), TOKEN_TIMEOUT_MS, "getIdToken");
}

/**
 * How long a token refresh may take before it is treated as failed.
 *
 * `getIdToken()` is not a local read when the cached token has expired: the SDK
 * calls Google's token endpoint with the persisted refresh token. That call has
 * no timeout of its own, so on a revoked or unreachable refresh it can stay
 * pending indefinitely — and everything waiting on the session waits with it.
 *
 * This is one of the reasons the app could sit on "Signing you in…" in a normal
 * browser and not in incognito: incognito has no persisted refresh token to
 * fail on. Ten seconds is far longer than a healthy refresh and short enough
 * that somebody is told what is happening rather than watching a spinner.
 */
export const TOKEN_TIMEOUT_MS = 10_000;

/**
 * Reject rather than hang.
 *
 * The rejection matters more than the duration: every caller of `idToken()`
 * already handles a failure — `readIdentityPayload` clears the cookie and
 * reports "not authenticated", the repository's `getToken` catches to null — so
 * a bounded failure is a path the code already knows how to walk. An unbounded
 * pending promise is the one shape nothing downstream can respond to.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} did not answer within ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    /* The losing promise keeps running — there is no cancelling a fetch the
       SDK owns — but the timer must not keep the event loop alive behind it. */
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The signed-in Firebase user, or null. */
export function currentUser(): User | null {
  return legacyFirebase().auth.currentUser;
}

/**
 * Sign in against the legacy Firebase project.
 *
 * Email and password, matching the legacy client exactly. Nothing is stored
 * here — the SDK owns the session, and duplicating it in localStorage is how the
 * two get out of step.
 */
export async function signIn(
  email: string,
  password: string,
): Promise<User> {
  const { auth } = legacyFirebase();
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

/**
 * Sign in with a Firebase custom token, minted server-side by the CMS backend.
 *
 * The SSO handoff from the CMS onboarding page: the CMS already knows who
 * somebody is and holds the Firebase Admin service account, so it mints a
 * custom token for their already-linked CoWork account and this exchanges it
 * for a real session, the same way `signIn` does for a typed password.
 */
export async function signInWithToken(customToken: string): Promise<User> {
  const { auth } = legacyFirebase();
  const credential = await signInWithCustomToken(auth, customToken);
  return credential.user;
}

export async function signOut(): Promise<void> {
  await fbSignOut(legacyFirebase().auth);
}

/** Why a re-authentication attempt failed, in terms a person can act on. */
export type ReauthFailure =
  | "wrong-password"
  | "too-many-attempts"
  | "no-session"
  | "unavailable";

/**
 * Prove the signed-in person knows their current password.
 *
 * Firebase checks it; the password is never sent to our own server. This runs
 * before a password change so the wrong-password case is answered immediately
 * and locally, rather than after a round trip — but it is **not** the security
 * boundary. The engine verifies the current password again on
 * `POST /cowork/change-password`, because anything the browser checks, the
 * browser can skip.
 *
 * Returns a discriminated result rather than throwing: "you typed the wrong
 * password" is an ordinary outcome of this operation, not an exception.
 */
export async function reauthenticate(
  currentPassword: string,
): Promise<{ ok: true } | { ok: false; reason: ReauthFailure }> {
  const user = currentUser();
  /* No email means a custom-token session (the CMS SSO handoff), which has no
     password to re-check — such a session cannot prove one and must not be
     told it typed the wrong thing. */
  if (!user?.email) return { ok: false, reason: "no-session" };

  try {
    await reauthenticateWithCredential(
      user,
      EmailAuthProvider.credential(user.email, currentPassword),
    );
    return { ok: true };
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "";
    if (
      code === "auth/wrong-password" ||
      code === "auth/invalid-credential" ||
      code === "auth/invalid-login-credentials"
    )
      return { ok: false, reason: "wrong-password" };
    if (code === "auth/too-many-requests")
      return { ok: false, reason: "too-many-attempts" };
    if (code === "auth/user-token-expired" || code === "auth/user-mismatch")
      return { ok: false, reason: "no-session" };
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * Subscribe to sign-in state.
 *
 * Returns the unsubscribe function, so a React effect can return it directly.
 */
export function watchAuth(
  handler: (user: User | null) => void,
): () => void {
  return onAuthStateChanged(legacyFirebase().auth, handler);
}

/**
 * Subscribe to ID-TOKEN changes, not just sign-in state.
 *
 * Fires on the same events as `watchAuth` PLUS every silent token refresh — the
 * SDK renews the one-hour token on its own, and only this callback is told. It
 * is how the mirrored auth cookie is kept in step with the live token, so the
 * Edge middleware never sees an expired copy and bounces a signed-in person.
 */
export function watchIdToken(
  handler: (user: User | null) => void,
): () => void {
  return onIdTokenChanged(legacyFirebase().auth, handler);
}

/**
 * The Firestore instance, for ported hooks and live listeners.
 *
 * Named `firebaseDb` to match `cowork-old-frontend/lib/coworkFirebase`, so a
 * copied hook needs its import path changed and nothing else. Renaming it would
 * mean editing the body of every ported file, which is the one kind of change a
 * behavioural re-skin cannot afford.
 */
export function legacyDb(): Firestore {
  return legacyFirebase().db;
}
