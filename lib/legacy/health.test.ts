import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHECK_ORDER,
  NO_PROBES,
  interpret,
  missingVariables,
  missingWriteVariables,
  shouldBlockData,
  type Probes,
} from "./health.ts";

const FULL_ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_LEGACY_API_URL: "https://api.example.com",
  NEXT_PUBLIC_FIREBASE_API_KEY: "k",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "d",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "p",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "s",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "m",
  NEXT_PUBLIC_FIREBASE_APP_ID: "a",
};

const ALL_GOOD: Probes = {
  firebaseInitialised: true,
  firebaseSignedIn: true,
  apiReachable: true,
  apiAuthenticated: true,
  firestoreReachable: true,
};

const check = (r: ReturnType<typeof interpret>, id: string) =>
  r.checks.find((c) => c.id === id)!;

/* ── Missing variables ────────────────────────────────────────────────────── */

test("every missing variable is listed, not just the first", () => {
  /* Somebody setting up a deployment wants the whole list; configRefusal's
     one-at-a-time answer is for a different question. */
  assert.equal(missingVariables(FULL_ENV).length, 0);
  assert.equal(missingVariables({}).length, 7);
  assert.deepEqual(
    missingVariables({ ...FULL_ENV, NEXT_PUBLIC_FIREBASE_APP_ID: undefined }),
    ["NEXT_PUBLIC_FIREBASE_APP_ID"],
  );
});

test("a variable set to whitespace counts as missing", () => {
  /* A trailing "=" in an env file produces an empty string, which is the most
     common way a variable looks set and is not. */
  assert.deepEqual(
    missingVariables({ ...FULL_ENV, NEXT_PUBLIC_LEGACY_API_URL: "   " }),
    ["NEXT_PUBLIC_LEGACY_API_URL"],
  );
});

test("write-only credentials are reported separately", () => {
  /* Reads working while writes are unconfigured is a legitimate intermediate
     state during this migration, not a failure. */
  assert.deepEqual(missingWriteVariables({}), ["LEGACY_FIREBASE_SERVICE_ACCOUNT"]);
  assert.deepEqual(
    missingWriteVariables({ LEGACY_FIREBASE_SERVICE_ACCOUNT: "{...}" }),
    [],
  );
});

/* ── Not configured ───────────────────────────────────────────────────────── */

test("no configuration reports NOT CONFIGURED, not FAILED", () => {
  /* A deployment that was never set up has not failed at anything. Calling it
     a failure sends somebody looking for a broken backend. */
  const r = interpret({ env: {}, probes: NO_PROBES });
  assert.equal(r.overall, "not_configured");
  assert.equal(r.summary, "Legacy backend not configured.");
  assert.equal(r.missing.length, 7);
});

test("unconfigured checks are SKIPPED, never silently passed", () => {
  /* A check that could not run is not a check that passed. */
  const r = interpret({ env: {}, probes: ALL_GOOD });
  for (const id of CHECK_ORDER.slice(1)) {
    assert.equal(check(r, id).state, "skipped", `${id} must not be judged`);
  }
  assert.equal(check(r, "config").state, "fail");
});

test("the configuration failure names the variables", () => {
  const r = interpret({ env: {}, probes: NO_PROBES });
  const c = check(r, "config");
  assert.match(c.detail, /NEXT_PUBLIC_LEGACY_API_URL/);
  assert.match(c.detail, /Missing 7 variables/);
  assert.match(c.remedy ?? "", /legacy frontend's own environment/);
});

test("one missing variable is described in the singular", () => {
  const r = interpret({
    env: { ...FULL_ENV, NEXT_PUBLIC_FIREBASE_APP_ID: undefined },
    probes: NO_PROBES,
  });
  assert.match(check(r, "config").detail, /Missing 1 variable:/);
});

/* ── Connected ────────────────────────────────────────────────────────────── */

test("everything passing reports CONNECTED", () => {
  /* Firestore is always skipped now — Firebase is for authentication only, so
     there is no Firestore access to check. A skip must not hold the verdict
     back, or the page would never report CONNECTED at all. */
  const r = interpret({ env: FULL_ENV, probes: ALL_GOOD });
  assert.equal(r.overall, "connected");
  assert.equal(
    r.checks.filter((c) => c.id !== "firestore").every((c) => c.state === "pass"),
    true,
  );
  assert.equal(shouldBlockData(r), false);
});

/* ── Individual failures ──────────────────────────────────────────────────── */

test("not signed in is stated plainly, not as a broken connection", () => {
  /* The SDK is working and nobody has signed in. Those are different problems
     and only one of them needs an engineer. */
  const r = interpret({
    env: FULL_ENV,
    probes: { ...ALL_GOOD, firebaseSignedIn: false, apiAuthenticated: null },
  });
  const c = check(r, "firebase_auth");
  assert.equal(c.state, "fail");
  assert.match(c.detail, /reachable, but nobody is signed in/);
  assert.match(c.remedy ?? "", /Sign in with a legacy Cowork account/);
});

test("an unreachable API reports the transport error and what to check", () => {
  const r = interpret({
    env: FULL_ENV,
    probes: {
      ...ALL_GOOD,
      apiReachable: false,
      apiError: { message: "Could not reach the Cowork server.", status: 0, kind: "network" },
      apiAuthenticated: null,
    },
  });
  const c = check(r, "api_reachable");
  assert.equal(c.state, "fail");
  assert.match(c.detail, /Could not reach/);
  assert.match(c.remedy ?? "", /CORS/);
});

test("a 403 from /cowork/me quotes the engine's own explanation", () => {
  /* The token is valid; the account simply has no cowork_employees record.
     Quoting the engine means the page and the network say the same thing. */
  const r = interpret({
    env: FULL_ENV,
    probes: {
      ...ALL_GOOD,
      apiAuthenticated: false,
      apiAuthError: { message: "Employee not found in Firestore. Ask your CEO.", status: 403, kind: "permission" },
    },
  });
  const c = check(r, "api_authenticated");
  assert.equal(c.state, "fail");
  assert.match(c.remedy ?? "", /no cowork_employees record/);
});

test("a non-403 auth failure points at the project mismatch instead", () => {
  const r = interpret({
    env: FULL_ENV,
    probes: {
      ...ALL_GOOD,
      apiAuthenticated: false,
      apiAuthError: { message: "Missing token", status: 401, kind: "auth" },
    },
  });
  assert.match(check(r, "api_authenticated").remedy ?? "", /project matches/);
});

test("Firestore is reported as not applicable, not as a missing credential", () => {
  /* It was once "needs a service account". Under the settled architecture the
     frontend uses Firebase for authentication only and business data comes from
     the Cowork backend, so there is no Firestore access to have — and no
     credential that would change that. */
  const r = interpret({ env: FULL_ENV, probes: ALL_GOOD });
  const c = check(r, "firestore");
  assert.equal(c.state, "skipped");
  assert.match(c.detail, /Not applicable/);
  assert.match(c.detail, /authentication only/);
});

test("a skipped check does not fail the overall verdict", () => {
  /* Otherwise a deployment with working reads could never report CONNECTED
     until writes were configured, and the page would cry wolf. */
  const r = interpret({
    env: FULL_ENV,
    probes: { ...ALL_GOOD, firestoreReachable: null },
  });
  assert.equal(r.overall, "connected");
});

test("the summary names the first real failure, not a count alone", () => {
  const r = interpret({
    env: FULL_ENV,
    probes: {
      ...ALL_GOOD,
      firebaseInitialised: false,
      firebaseError: "Invalid API key",
    },
  });
  assert.equal(r.overall, "failed");
  assert.match(r.summary, /1 check failed/);
  assert.match(r.summary, /Invalid API key/);
  assert.equal(shouldBlockData(r), true);
});

test("checks appear in dependency order", () => {
  /* Each is meaningless if the one before it failed; reporting them out of
     order shows the second symptom as if it were an independent problem. */
  const r = interpret({ env: FULL_ENV, probes: ALL_GOOD });
  assert.deepEqual(r.checks.map((c) => c.id), [...CHECK_ORDER]);
});

test("data is blocked whenever the connection is not clean", () => {
  /* The brief's rule: never silently show empty data. */
  assert.equal(shouldBlockData(interpret({ env: {}, probes: NO_PROBES })), true);
  assert.equal(
    shouldBlockData(interpret({ env: FULL_ENV, probes: { ...ALL_GOOD, apiReachable: false } })),
    true,
  );
});

test("something answering is not the same as the RIGHT thing answering", () => {
  /* Found live during setup: macOS AirPlay Receiver squats on port 5000 and
     returns a bare 403 to everything. Without this the health page reports a
     healthy backend while pointed at a printer-sharing service. */
  const r = interpret({
    env: FULL_ENV,
    probes: {
      ...ALL_GOOD,
      apiReachable: true,
      apiLooksLegacy: false,
      apiServerHeader: "AirTunes/950.7.1",
    },
  });
  const c = check(r, "api_reachable");
  assert.equal(c.state, "fail");
  assert.match(c.detail, /not the Cowork backend/);
  assert.match(c.detail, /AirTunes/);
  assert.match(c.remedy ?? "", /AirPlay Receiver/);
  assert.equal(r.overall, "failed");
});

test("an unidentified impostor still fails, without naming it", () => {
  const r = interpret({
    env: FULL_ENV,
    probes: { ...ALL_GOOD, apiReachable: true, apiLooksLegacy: false },
  });
  assert.equal(check(r, "api_reachable").state, "fail");
  assert.match(check(r, "api_reachable").detail, /did not respond like/);
});

test("a backend that identifies itself passes", () => {
  const r = interpret({
    env: FULL_ENV,
    probes: { ...ALL_GOOD, apiReachable: true, apiLooksLegacy: true },
  });
  assert.equal(check(r, "api_reachable").state, "pass");
  assert.match(check(r, "api_reachable").detail, /identified itself/);
});
