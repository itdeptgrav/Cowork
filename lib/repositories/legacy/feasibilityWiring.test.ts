import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The repository fetches; the rule decides.
 *
 * The whole risk in wiring this was that the repository would grow its own
 * version of the queue simulation or its own idea of active workload. These
 * pin that it did not.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const REPO = "lib/repositories/legacy/index.ts";
const RULE = "lib/rules/tasks/deadlineFeasibility.ts";

function method(): string {
  /* Bounded by the NEXT method, not by a character count. It was `at + 3200`,
     and adding four lines to the preview pushed its last assertion out of the
     window — the test failed while the thing it guards was untouched. A slice
     that reports a fault when the code above it grows is not a guard. */
  const src = code(REPO);
  const at = src.indexOf("async previewDeadlineFeasibility(");
  assert.ok(at > 0, `${REPO} no longer has previewDeadlineFeasibility`);
  const end = src.indexOf("\n  async ", at + 1);
  assert.ok(end > at, "could not find the end of previewDeadlineFeasibility");
  return src.slice(at, end);
}

test("the queue is the EVALUATED employee's, never the viewer's", () => {
  /* A sales manager previewing for a production employee is asking about the
     production employee's week. The query is by assignee, so the caller's
     identity cannot leak into the answer. */
  const fn = method();
  assert.match(fn, /array-contains", employeeId/);
  assert.equal(
    /this\.#ctx\.employeeId/.test(fn),
    false,
    "the viewer's identity reached the workload query",
  );
});

test("the repository does no simulation of its own", () => {
  /* One place knows about queue movement, chaining and buffers. */
  const fn = method();
  assert.match(fn, /calculateDeadlineFeasibility\(\{/);
  for (const own of ["splice(", "chainDeadlines(", "bufferSeconds", "simulatedPosition"]) {
    assert.equal(fn.includes(own), false, `the repository computes "${own}" itself`);
  }
});

test("workload filtering is left to the shared rule", () => {
  /*
   * No second definition of active — the repository still does not test a
   * status or a budget state itself; that decision lives in the rule.
   *
   * **Which rule changed, deliberately.** This used to assert the rule calls
   * `isActivePriorityTask` — the same "settled budget only" predicate the
   * dashboards and counters use. Reused here, it meant two pending subtasks
   * for one person previewed the identical completion time: neither had a
   * settled budget, so each excluded the other from its own chain and
   * computed "now + my own window" independently. `isLiveCandidate` is the
   * fix — no acceptance or settlement requirement, so a proposed-but-pending
   * sibling still takes a real place in the preview using its proposed
   * window, which is the best estimate available before it is negotiated.
   * `isActivePriorityTask` keeps its old meaning everywhere else (dashboards,
   * counters, the accepted chain) — only THIS preview's filter moved.
   */
  const fn = method();
  assert.equal(
    /status !== "completed"|=== "ACCEPTED"/.test(fn),
    false,
    "the repository filters workload itself",
  );
  assert.match(code(RULE), /isLiveCandidate\(/);
  assert.equal(
    /isActivePriorityTask\(/.test(code(RULE)),
    false,
    "reverted to the settled-only filter, which is what produced two identical completion times for pending siblings",
  );
});

test("only a SETTLED budget contributes time", () => {
  /* Planning against a proposed window would promise time nobody agreed. */
  assert.match(method(), /senderTimerWindowSecs: resolveTimeBudget\(t\)/);
});

test("priority comes from production's own source", () => {
  /* `assigneePriorities` then `priority` — the rule resolves it with `rankOf`,
     the same function the real queue sorts on. */
  const fn = method();
  assert.match(fn, /assigneePriorities: t\.assigneePriorities/);
  assert.match(fn, /priority: t\.priority/);
  assert.match(code(RULE), /rankOf\(a, employeeId\)/);
});

test("the calendar is production's, including this person's leave", () => {
  const fn = method();
  assert.match(fn, /this\.getOfficePolicy\(\)/);
  assert.match(fn, /this\.listBlockedDates\(employeeId, from, to\)/);
  assert.match(fn, /addWorkingSecs\(anchorMs, windowSecs, policy\.schedule/);
});

test("a failed blocked-date read degrades rather than failing the preview", () => {
  /* Optimistic by at most the holidays in the window, rather than wrong in
     kind — and far better than no answer at all. */
  assert.match(method(), /\.catch\(\(\) => \[\]\)/);
});

test("the trace uses the map form, so a skipped day says WHY", () => {
  /* `explainAddWorkingSecs` takes a Map rather than a Set precisely so it can
     name the holiday instead of only reporting "closed". */
  const fn = method();
  assert.match(fn, /blockedInfo/);
  assert.match(fn, /\{ type: b\.kind, name: b\.label \}/);
  assert.match(fn, /\)\.steps,/);
});

test("nothing is written", () => {
  /* A preview that mutated would be a very expensive way to ask a question. */
  const fn = method();
  for (const write of ["setDoc(", "updateDoc(", "addDoc(", "writeBatch(", "deleteDoc("]) {
    assert.equal(fn.includes(write), false, `the preview performs "${write}"`);
  }
  assert.equal(
    /notifyRepositoryChanged\(\)/.test(fn),
    false,
    "a read-only preview invalidated caches",
  );
});
