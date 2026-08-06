import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Nothing between knowing who you are and saying so may wait forever.
 *
 * `load()` learns the identity from `/cowork/me`, then does four things that
 * merely ENRICH the session: provisions the employee, restarts the task watch,
 * reads rule overrides, and widens the directory. Each was awaited without a
 * bound — and a Firestore read does not reject when it cannot reach the server,
 * it stays pending. So one unreachable call left the sign-in unfinished and the
 * app on "Signing you in…" indefinitely: nothing threw, so the retry ladder
 * never ran, and the watchdog reported `listenerFired: true` with
 * `firebaseHasUser: true` — a session that had everything it needed and never
 * committed it.
 */

const SRC = readFileSync("components/features/auth/SessionProvider.tsx", "utf8");

/** The enrichment span: identity known, session not yet committed. */
function enrichmentSpan(): string {
  const from = SRC.indexOf("const repo = getRepository();");
  const to = SRC.indexOf('status: "authenticated"', from);
  assert.ok(from > 0 && to > from, "could not locate the enrichment span");
  return SRC.slice(from, to);
}

/**
 * Cut out every `settledWithin( … )` call, braces balanced.
 *
 * Anything inside one is bounded BY it — including a whole async block wrapped
 * as a single logical step, which is how the directory widening is written. A
 * scan that only skipped the literal token `settledWithin` would flag the three
 * awaits nested inside that block and be wrong about all of them.
 */
function withoutBoundedCalls(span: string): string {
  let out = "";
  let i = 0;
  while (i < span.length) {
    const next = span.indexOf("settledWithin(", i);
    if (next === -1) {
      out += span.slice(i);
      break;
    }
    out += span.slice(i, next);
    let depth = 0;
    let j = next + "settledWithin".length;
    for (; j < span.length; j++) {
      if (span[j] === "(") depth++;
      else if (span[j] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    assert.equal(depth, 0, "unbalanced settledWithin( … ) — cannot scan");
    i = j + 1;
  }
  return out;
}

test("every await in the enrichment span is bounded", () => {
  /* `settledWithin` resolves null on timeout rather than rejecting, so a step
     that hangs is SKIPPED and the session still commits. */
  const unbounded = withoutBoundedCalls(enrichmentSpan());
  const awaits = unbounded.match(/await\s+[A-Za-z_$][\w$.]*\(/g) ?? [];
  assert.deepEqual(
    awaits,
    [],
    `unbounded await(s) before the session commits: ${awaits.join(", ")}`,
  );
});

test("the scan would CATCH an unbounded await — it is not vacuous", () => {
  /* Guards the guard. If `withoutBoundedCalls` ever over-matched and returned
     an empty string, the test above would pass on any source at all. */
  const planted = withoutBoundedCalls(
    'const repo = getRepository();\nawait settledWithin(a());\nawait repo.hangs();\n',
  );
  assert.match(planted, /await repo\.hangs\(/);
});

test("all four steps timing out still fits inside the watchdog", () => {
  /* Otherwise a completely unreachable Firestore trips the watchdog and shows a
     failure screen to somebody whose sign-in was about to succeed. */
  const step = Number(
    /SESSION_STEP_TIMEOUT_MS = ([\d_]+)/.exec(SRC)?.[1].replace(/_/g, "") ?? 0,
  );
  const watchdog = Number(
    /RESOLVE_WATCHDOG_MS = ([\d_]+)/.exec(SRC)?.[1].replace(/_/g, "") ?? 0,
  );
  assert.ok(step > 0 && watchdog > 0, "constants not found");

  const steps = (enrichmentSpan().match(/settledWithin\(/g) ?? []).length;
  assert.ok(steps >= 4, `expected the four enrichment steps, found ${steps}`);
  assert.ok(
    steps * step < watchdog,
    `${steps} x ${step}ms = ${steps * step}ms exceeds the ${watchdog}ms watchdog`,
  );
});

test("the identity read itself is still bounded upstream", () => {
  /* `idToken` times out at 10s and `legacyFetch` at 20s, so the step BEFORE the
     span cannot hang either. Named here so removing one is noticed. */
  const firebase = readFileSync("lib/legacy/firebase.ts", "utf8");
  assert.match(firebase, /TOKEN_TIMEOUT_MS/);
  const http = readFileSync("lib/legacy/http.ts", "utf8");
  assert.match(http, /LEGACY_TIMEOUT_MS/);
});
