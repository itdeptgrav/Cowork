import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { checkClaims } from "./firebaseToken.ts";
import {
  EXPIRY_GRACE_SECONDS,
  FIREBASE_COOKIE_MAX_AGE,
} from "./firebaseCookie.ts";

/**
 * **A session ends when somebody signs out, and at no other time.**
 *
 * Reported as: signed in, came back a few hours later, asked to sign in again —
 * repeatedly, without ever having signed out. Three separate things produced
 * it, and the first two are the same mistake in different places: treating the
 * one-hour ID TOKEN as if it were the session.
 *
 *  1. The mirrored cookie was written with `Max-Age=3600`. Close the browser,
 *     come back after lunch, and there is no cookie at all — so the Edge, which
 *     runs before any JavaScript, saw an anonymous request and redirected. The
 *     refresh token was in IndexedDB the whole time, valid, one call away from
 *     restoring the session.
 *  2. The gate treated an EXPIRED token as signed-out. Only the client can
 *     refresh — the refresh token is not readable from the Edge — so the gate
 *     was answering a question it had no way to answer, and answering it wrong.
 *  3. Persistence was left to the SDK's default rather than stated, one word
 *     away from becoming `sessionStorage` and signing everybody out nightly.
 *
 * What has NOT changed: the signature check. An unsigned or wrong-project token
 * is refused in every state — see `forgedToken.test.ts`.
 */

const PROJECT = "grav-cms-38f45";
const HOUR = 3600;

const claims = (expSecondsFromNow: number, nowSeconds: number) =>
  checkClaims({
    payload: {
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: PROJECT,
      sub: "GR0045",
      exp: nowSeconds + expSecondsFromNow,
    },
    projectId: PROJECT,
    nowSeconds,
  });

test("the cookie outlives the token it carries", () => {
  /* The token is good for an hour; the cookie's job is to say "this browser has
     a session worth restoring", which stays true for as long as the refresh
     token does. An hour-long cookie made every gap longer than an hour look
     like a sign-out. */
  assert.ok(
    FIREBASE_COOKIE_MAX_AGE > HOUR,
    "the cookie expires with the token again — a closed browser loses the session",
  );
  assert.ok(
    FIREBASE_COOKIE_MAX_AGE >= 7 * 24 * HOUR,
    "a week away from the desk should not require a password",
  );
});

test("an expired token is still evidence of a session, within a bound", () => {
  /* `checkClaims` is the pure part: expiry is reported as its own reason, which
     is what lets the gate tell "aged out" from "not this project". */
  const now = 1_760_000_000;
  assert.equal(claims(HOUR, now).ok, true);

  const old = claims(-HOUR, now);
  assert.equal(old.ok, false);
  assert.equal(old.ok === false && old.reason, "expired");

  /* With the grace applied, the same token reads as authentic-but-old rather
     than as a stranger. */
  assert.equal(
    checkClaims({
      payload: {
        iss: `https://securetoken.google.com/${PROJECT}`,
        aud: PROJECT,
        sub: "GR0045",
        exp: now - HOUR,
      },
      projectId: PROJECT,
      nowSeconds: now,
      leewaySeconds: EXPIRY_GRACE_SECONDS,
    }).ok,
    true,
  );

  /* And the grace is bounded, so a cookie found on a shared machine months
     later is not a key. */
  assert.equal(
    checkClaims({
      payload: {
        iss: `https://securetoken.google.com/${PROJECT}`,
        aud: PROJECT,
        sub: "GR0045",
        exp: now - EXPIRY_GRACE_SECONDS - HOUR,
      },
      projectId: PROJECT,
      nowSeconds: now,
      leewaySeconds: EXPIRY_GRACE_SECONDS,
    }).ok,
    false,
  );
});

test("the wrong project is refused however recent it is", () => {
  /* The grace applies to the CLOCK and to nothing else. */
  const now = 1_760_000_000;
  const wrong = checkClaims({
    payload: {
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: "someone-elses-project",
      sub: "GR0045",
      exp: now + HOUR,
    },
    projectId: PROJECT,
    nowSeconds: now,
    leewaySeconds: EXPIRY_GRACE_SECONDS,
  });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.ok === false && wrong.reason, "wrong_audience");
});

test("the gate lets a stale session through instead of bouncing it", () => {
  const proxy = readFileSync("proxy.ts", "utf8");
  /* Three verdicts, not two. */
  assert.match(proxy, /type SessionState = "live" \| "stale" \| "none";/);
  /* Only the clock earns the second one — anything else is fatal. */
  assert.match(proxy, /if \(!fresh\.ok && fresh\.reason !== "expired"\) return "none";/);
  /* The signature is checked for both. */
  assert.match(proxy, /leewaySeconds: fresh\.ok \? undefined : EXPIRY_GRACE_SECONDS,/);
  assert.match(proxy, /if \(!result\.ok\) return "none";/);

  /* A stale cookie proceeds… */
  assert.match(proxy, /const mayProceed = state !== "none";/);
  assert.match(proxy, /if \(!mayProceed\) \{/);
  /* …but is NOT bounced off the sign-in form, or somebody whose stored session
     turns out to be dead would be volleyed between the two for ever. */
  assert.match(proxy, /const signedIn = state === "live";/);
  assert.match(
    proxy,
    /if \(signedIn && \(pathname === "\/signin" \|\| pathname === "\/signup"\)\)/,
  );
});

test("the session survives closing the browser, and says so", () => {
  /* `browserLocalPersistence` is the SDK's default, which is exactly why it is
     written down: the one-word change to `browserSessionPersistence` looks like
     tidying and would sign the whole company out every evening. */
  const firebase = readFileSync("lib/legacy/firebase.ts", "utf8")
    /* The comment names the alternative in order to warn about it; the code is
       what is being asserted. */
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(firebase, /setPersistence\(auth, browserLocalPersistence\)/);
  assert.ok(
    !/browserSessionPersistence/.test(firebase),
    "the session is stored per-tab again — closing the browser signs everybody out",
  );
});

test("the cookie is kept fresh while a tab is open, and cleared on sign-out", () => {
  /* The other half: a live tab must not age out either. `onIdTokenChanged`
     fires on every silent refresh, and the visibility handler covers a tab that
     was left alone past the refresh window. */
  const provider = readFileSync(
    "components/features/auth/SessionProvider.tsx",
    "utf8",
  );
  assert.match(provider, /watchIdToken\(refresh\)/);
  assert.match(provider, /visibilitychange/);
  assert.match(provider, /\.getIdToken\(\)\s*\.then\(writeFirebaseCookie\)/);
  /* And signing out is still the one thing that ends it. */
  assert.match(provider, /clearFirebaseCookie\(\)/);
});
