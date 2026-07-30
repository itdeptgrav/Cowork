import { LEGACY_ENV } from "./config.ts";
import type { LegacyError } from "./envelope";

/**
 * Whether the adapter can actually reach the legacy system.
 *
 * **Separates the probing from the verdict.** `interpret()` is pure and takes
 * already-run probe results, so every rule about what counts as healthy — and
 * every message somebody reads at three in the morning — is testable without a
 * network, a browser or a live backend.
 *
 * The design rule throughout: **a check that cannot run is not a check that
 * passed, and it is not a check that failed either.** Three outcomes, not two.
 * Reporting "Firestore ✓" because we never asked is how a health page becomes
 * something nobody trusts.
 */

export type CheckState = "pass" | "fail" | "skipped";

export interface CheckResult {
  id: CheckId;
  label: string;
  state: CheckState;
  /** Exactly why. Never "something went wrong". */
  detail: string;
  /** What to do about it, when there is something to do. */
  remedy?: string;
}

export type CheckId =
  | "config"
  | "firebase_init"
  | "firebase_auth"
  | "api_reachable"
  | "api_authenticated"
  | "firestore";

export const CHECK_LABELS: Record<CheckId, string> = {
  config: "Environment configured",
  firebase_init: "Firebase initialised",
  firebase_auth: "Firebase authentication available",
  api_reachable: "Backend API reachable",
  api_authenticated: "Backend accepts our token",
  firestore: "Firestore accessible",
};

/**
 * The order checks are shown and evaluated in.
 *
 * Dependency order, deliberately: each one is meaningless if the one before it
 * failed. Testing whether the backend accepts a token before knowing Firebase
 * can issue one produces a confusing failure — the *second* symptom of the
 * first problem, reported as if it were independent.
 */
export const CHECK_ORDER: readonly CheckId[] = [
  "config",
  "firebase_init",
  "firebase_auth",
  "api_reachable",
  "api_authenticated",
  "firestore",
];

export type OverallState = "connected" | "failed" | "not_configured";

export interface HealthReport {
  overall: OverallState;
  /** One line summarising the verdict. */
  summary: string;
  checks: CheckResult[];
  /** Environment variables that are required and absent. */
  missing: string[];
}

/* ── Configuration ────────────────────────────────────────────────────────── */

/**
 * Every required variable that is absent.
 *
 * The full list, unlike `configRefusal` which names only the first. Somebody
 * setting up a deployment wants the whole list; somebody hitting a runtime
 * error wants the next thing to fix. Different questions, different answers.
 */
export function missingVariables(
  env: Record<string, string | undefined>,
): string[] {
  const required = [LEGACY_ENV.apiUrl, ...Object.values(LEGACY_ENV.firebase)];
  return required.filter((name) => !env[name]?.trim());
}

/**
 * Variables that are absent but only needed for writes.
 *
 * Reported separately because a deployment with reads working and writes not
 * configured is a legitimate intermediate state during this migration — not a
 * failure, and not something to hide either.
 */
export function missingWriteVariables(
  env: Record<string, string | undefined>,
): string[] {
  return env[LEGACY_ENV.serviceAccount]?.trim()
    ? []
    : [LEGACY_ENV.serviceAccount];
}

/* ── Probes ───────────────────────────────────────────────────────────────── */

/**
 * What the caller must find out, however it can.
 *
 * Injected rather than imported so `interpret()` stays pure. `null` means the
 * probe did not run — which is different from running and failing, and the
 * report says so.
 */
export interface Probes {
  firebaseInitialised: boolean | null;
  /** True when the SDK has a signed-in user. */
  firebaseSignedIn: boolean | null;
  /** Firebase error message, when initialisation or auth threw. */
  firebaseError?: string | null;
  apiReachable: boolean | null;
  apiError?: LegacyError | null;
  /**
   * Whether the thing that answered is actually the legacy Cowork backend.
   *
   * **Something answering is not the same as the right thing answering.** On
   * macOS, port 5000 is AirPlay Receiver, which returns a bare `403` to every
   * request — so a naive reachability check reports a healthy backend while
   * pointing at a printer-sharing service. Identified by the response
   * signature: unauthenticated `/cowork/me` returns `401 {"error":"Missing
   * token"}` from `coworkAuth.js`.
   */
  apiLooksLegacy?: boolean | null;
  /** The `Server` header of whatever replied, when it is not ours. */
  apiServerHeader?: string | null;
  /** Whether `GET /cowork/me` succeeded with the current token. */
  apiAuthenticated: boolean | null;
  apiAuthError?: LegacyError | null;
  firestoreReachable: boolean | null;
  firestoreError?: string | null;
}

export const NO_PROBES: Probes = {
  firebaseInitialised: null,
  firebaseSignedIn: null,
  apiReachable: null,
  apiAuthenticated: null,
  firestoreReachable: null,
};

/* ── The verdict ──────────────────────────────────────────────────────────── */

/**
 * Turn probe results into a report.
 *
 * Pure. The one place that decides what "CONNECTED" means.
 */
export function interpret(input: {
  env: Record<string, string | undefined>;
  probes: Probes;
}): HealthReport {
  const missing = missingVariables(input.env);
  const configured = missing.length === 0;
  const p = input.probes;

  const checks: CheckResult[] = [];

  checks.push(
    configured
      ? {
          id: "config",
          label: CHECK_LABELS.config,
          state: "pass",
          detail: "All required variables are set.",
        }
      : {
          id: "config",
          label: CHECK_LABELS.config,
          state: "fail",
          detail: `Missing ${missing.length} variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
          remedy:
            "Copy these from the legacy frontend's own environment. See docs/legacy-environment-setup.md.",
        },
  );

  /* Everything below depends on configuration. Probing without it produces
     failures that describe the missing variables in worse words. */
  if (!configured) {
    for (const id of CHECK_ORDER.slice(1)) {
      checks.push({
        id,
        label: CHECK_LABELS[id],
        state: "skipped",
        detail: "Not checked — the environment is not configured.",
      });
    }
    return {
      overall: "not_configured",
      summary: "Legacy backend not configured.",
      checks,
      missing,
    };
  }

  checks.push(
    probeCheck("firebase_init", p.firebaseInitialised, {
      pass: "The Firebase app was created.",
      fail: p.firebaseError ?? "Firebase could not be initialised.",
      remedy: "Check the NEXT_PUBLIC_FIREBASE_* values match the legacy project.",
    }),
  );

  checks.push(
    p.firebaseSignedIn === null
      ? skipped("firebase_auth", "Not checked.")
      : p.firebaseSignedIn
        ? {
            id: "firebase_auth",
            label: CHECK_LABELS.firebase_auth,
            state: "pass",
            detail: "Signed in; an ID token is available.",
          }
        : {
            id: "firebase_auth",
            label: CHECK_LABELS.firebase_auth,
            state: "fail",
            /* Not a fault — the SDK is working and nobody has signed in. Said
               plainly so it is not mistaken for a broken connection. */
            detail: "Firebase is reachable, but nobody is signed in.",
            remedy: "Sign in with a legacy Cowork account to complete the checks.",
          },
  );

  if (p.apiReachable === true && p.apiLooksLegacy === false) {
    /* Something is listening and it is not Cowork. Reported as its own failure
       because the remedy is completely different from "the backend is down". */
    checks.push({
      id: "api_reachable",
      label: CHECK_LABELS.api_reachable,
      state: "fail",
      detail: p.apiServerHeader
        ? `Something answered, but it is not the Cowork backend — it identified itself as "${p.apiServerHeader}".`
        : "Something answered, but it did not respond like the Cowork backend.",
      remedy: `Check what ${LEGACY_ENV.apiUrl} points at. On macOS, port 5000 is taken by AirPlay Receiver (System Settings → General → AirDrop & Handoff), so a backend expected there may not be running at all.`,
    });
  } else {
    checks.push(
      probeCheck("api_reachable", p.apiReachable, {
        pass: "The legacy backend answered and identified itself.",
        fail: p.apiError?.message ?? "The legacy backend did not answer.",
        remedy: `Check ${LEGACY_ENV.apiUrl} points at a running backend and that CORS allows this origin.`,
      }),
    );
  }

  checks.push(
    p.apiAuthenticated === null
      ? skipped("api_authenticated", "Not checked — no token to present.")
      : p.apiAuthenticated
        ? {
            id: "api_authenticated",
            label: CHECK_LABELS.api_authenticated,
            state: "pass",
            detail: "GET /cowork/me returned an identity.",
          }
        : {
            id: "api_authenticated",
            label: CHECK_LABELS.api_authenticated,
            state: "fail",
            detail: p.apiAuthError?.message ?? "The backend rejected our token.",
            remedy:
              p.apiAuthError?.status === 403
                ? "The token is valid but this account has no cowork_employees record. The engine answers: \"Employee not found in Firestore. Ask your CEO.\""
                : "Confirm the Firebase project matches the one the backend verifies against.",
          },
  );

  checks.push(
    skipped(
      "firestore",
      "Not applicable. Firebase is used for authentication only, and business data comes from the Cowork backend — so there is no Firestore access to check from here.",
    ),
  );

  const failed = checks.filter((c) => c.state === "fail");
  const overall: OverallState = failed.length === 0 ? "connected" : "failed";

  return {
    overall,
    summary:
      overall === "connected"
        ? "Connected to the legacy Cowork system."
        : `${failed.length} check${failed.length === 1 ? "" : "s"} failed: ${failed[0].detail}`,
    checks,
    missing,
  };
}

function probeCheck(
  id: CheckId,
  value: boolean | null,
  text: { pass: string; fail: string; remedy?: string },
): CheckResult {
  if (value === null) return skipped(id, "Not checked.");
  return value
    ? { id, label: CHECK_LABELS[id], state: "pass", detail: text.pass }
    : {
        id,
        label: CHECK_LABELS[id],
        state: "fail",
        detail: text.fail,
        remedy: text.remedy,
      };
}

function skipped(id: CheckId, detail: string): CheckResult {
  return { id, label: CHECK_LABELS[id], state: "skipped", detail };
}

/**
 * Whether a report should stop the UI from showing data.
 *
 * The rule the brief asks for: **never silently show empty data.** Anything
 * other than a clean connection means a screen explains itself rather than
 * rendering an empty list that reads as "there is nothing here".
 */
export function shouldBlockData(report: HealthReport): boolean {
  return report.overall !== "connected";
}
