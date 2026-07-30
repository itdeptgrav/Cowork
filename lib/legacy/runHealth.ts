"use client";

import { isConfigured } from "./config.ts";
import { legacyFetch } from "./http.ts";
import {
  type HealthReport,
  type Probes,
  NO_PROBES,
  interpret,
} from "./health.ts";
import { idToken, legacyFirebase } from "./firebase.ts";
import { PUBLIC_ENV } from "./publicEnv.ts";

/**
 * Actually run the health probes.
 *
 * The IO half of `health.ts`. Every verdict lives there, pure and tested; this
 * only finds out what is true and hands it over.
 *
 * **No probe is allowed to throw.** A health check that crashes is worse than
 * one that reports a failure — the page renders nothing and the person is left
 * guessing which check died. Each probe catches its own errors and turns them
 * into a `false` with a reason.
 */
export async function runHealthChecks(
  env: Record<string, string | undefined> = PUBLIC_ENV,
): Promise<HealthReport> {
  if (!isConfigured(env)) {
    return interpret({ env, probes: NO_PROBES });
  }

  const probes: Probes = { ...NO_PROBES };

  /* 1 — Firebase initialises. */
  try {
    const { auth } = legacyFirebase(env);
    probes.firebaseInitialised = true;
    probes.firebaseSignedIn = auth.currentUser !== null;
  } catch (e) {
    probes.firebaseInitialised = false;
    probes.firebaseError = e instanceof Error ? e.message : String(e);
    probes.firebaseSignedIn = false;
  }

  /* 2 — The backend answers at all.
     `/cowork/me` unauthenticated is the probe: it is guaranteed to exist, and a
     401 from it proves the backend is up and routing. Anything that is not a
     transport failure counts as reachable — a refusal is an answer. */
  const unauth = await legacyFetch<unknown>({ path: "/cowork/me" }, env);
  if (!unauth.ok && (unauth.error.kind === "network" || unauth.error.status === 0)) {
    probes.apiReachable = false;
    probes.apiError = unauth.error;
  } else {
    /* Something answered. Whether it is OURS is a separate question:
       `coworkAuth.js` replies to an unauthenticated /cowork/me with
       401 {"error":"Missing token"}, whereas macOS AirPlay — which squats on
       port 5000 — returns a bare 403 and would otherwise pass as healthy. */
    probes.apiReachable = true;
    probes.apiLooksLegacy =
      unauth.ok || (unauth.error.status === 401 && unauth.error.message.length > 0);
    if (!probes.apiLooksLegacy) {
      probes.apiServerHeader = await identifyServer(env);
    }
  }

  /* 3 — The backend accepts our token. Only meaningful if somebody is signed in
     and the backend is up; otherwise it stays unprobed rather than failing for
     a reason that belongs to an earlier check. */
  if (probes.apiReachable && probes.firebaseSignedIn) {
    const token = await idToken().catch(() => null);
    if (token) {
      const me = await legacyFetch<unknown>({ path: "/cowork/me", token }, env);
      probes.apiAuthenticated = me.ok;
      if (!me.ok) probes.apiAuthError = me.error;
    }
  }

  /* Firestore is deliberately NOT probed.
     The architecture allows Firebase from the frontend for authentication only,
     and forbids Next.js API routes — so there is no sanctioned path to
     Firestore from here, and nothing to check. Anything legacy keeps only in
     Firestore (break, timers, presence, monitoring) reaches this app when the
     old backend exposes an endpoint for it, and not before. */

  return interpret({ env, probes });
}

/**
 * Who is answering, when it is not us.
 *
 * Best-effort: a cross-origin response usually hides its headers from the
 * browser, so this often returns null and the report falls back to a generic
 * message. It costs one request and, when it works, turns "the backend is
 * unreachable" into "AirPlay is answering on that port" — which is the
 * difference between an hour of debugging and a glance.
 */
async function identifyServer(
  env: Record<string, string | undefined>,
): Promise<string | null> {
  try {
    const base = env.NEXT_PUBLIC_LEGACY_API_URL;
    if (!base) return null;
    const response = await fetch(base, { cache: "no-store" });
    return response.headers.get("server");
  } catch {
    return null;
  }
}
