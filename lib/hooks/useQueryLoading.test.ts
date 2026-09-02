import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The loading-vs-stale decision in `useQuery`, guarded where it broke.
 *
 * **The bug.** `useQuery` keeps its last good answer on screen while
 * revalidating, so a mutation — which invalidates every query — does not blank
 * the page. But it kept that answer on ANY change, including a deps change to a
 * different query. Switching the task scope from "mine" (which, for a person
 * with no personal tasks, is a successful result of zero rows) to "team" showed
 * the empty "mine" result AS the "team" result: `isLoading` stayed false and
 * the table rendered "No tasks here" over 33 team tasks that were still
 * loading, until they landed.
 *
 * The fix keeps stale data only when the DEPS are unchanged — a version or
 * nonce bump, the same logical query — and reports loading when the deps
 * changed. The hook cannot be React-rendered under `node --test`, so the guard
 * is asserted at the source and the decision itself is modelled below from the
 * exact same inputs the hook derives it from.
 */

const SRC = readFileSync("lib/hooks/useRepository.ts", "utf8");

test("stale data is kept only for the SAME query, not any prior one", () => {
  /* The load-bearing line. Without the `depsKey` comparison the revalidating
     branch fires on a scope switch and shows another query's answer. */
  assert.match(
    SRC,
    /settled\.error === null &&\s*\n\s*settled\.depsKey === depsKey/,
    "the revalidating branch no longer checks the deps match",
  );
  /* And the key is split so a deps change is distinguishable from a version
     bump in the first place. */
  assert.match(SRC, /const depsKey = JSON\.stringify\(deps\);/);
  assert.match(SRC, /const key = depsKey \+ `#\$\{nonce\}#\$\{version\}`;/);
});

/* ── The decision table, from the same three inputs the hook uses ─────────── */

type Settled = { depsKey: string; error: string | null; data: unknown } | null;

/** A faithful copy of the hook's state derivation — the branch the fix changed. */
function status(
  key: string,
  depsKey: string,
  settled: Settled,
): "ready" | "loading" | "error" {
  const settledKey =
    settled === null ? null : `${settled.depsKey}#0#0`;
  const fresh = settled && settledKey === key ? settled : null;
  if (fresh) return fresh.error !== null ? "error" : "ready";
  if (settled && settled.error === null && settled.depsKey === depsKey) {
    return "ready"; // revalidating the same query
  }
  return "loading";
}

test("switching scope to a not-yet-loaded query shows loading, not empty", () => {
  /* The reported case. "mine" settled successfully with an empty list; the key
     is now "team". The old result must NOT be shown as the team's. */
  const mineSettled: Settled = { depsKey: '["mine"]', error: null, data: [] };
  const teamKey = '["team"]#0#0';
  assert.equal(
    status(teamKey, '["team"]', mineSettled),
    "loading",
    "an empty mine result is being shown as an empty team",
  );
});

test("a mutation on the SAME scope keeps the list on screen", () => {
  /* The behaviour the stale-keep exists for: a write bumps the version, the
     deps are identical, and the page must not blank. Here the settled key is
     one version behind the current key but the deps match. */
  const teamSettled: Settled = {
    depsKey: '["team"]',
    error: null,
    data: [1, 2, 3],
  };
  const nextVersionKey = '["team"]#0#1'; // same deps, version bumped
  assert.equal(status(nextVersionKey, '["team"]', teamSettled), "ready");
});

test("the very first load, with nothing settled, is loading", () => {
  assert.equal(status('["team"]#0#0', '["team"]', null), "loading");
});

test("a fresh result for the current key is ready", () => {
  const settled: Settled = { depsKey: '["team"]', error: null, data: [1] };
  assert.equal(status('["team"]#0#0', '["team"]', settled), "ready");
});
