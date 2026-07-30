import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { toTask } from "./taskMap.ts";

/**
 * Whether a task counts toward a score.
 *
 * The adapter read `isGoldTask`, which is the C2 GOAL flag —
 * `pmpService.js:562` returns immediately from goal scoring unless it is set.
 * C1, the ordinary task-execution score every task gets, never consults it.
 *
 * The cost was total: `isGoldTask` is false on all 49 live tasks, so EVERY task
 * wore a "Not scored" chip while 47 carried a C1 record the engine had written.
 * T635 is one of them — `c1.isExcluded: false`, `c1Status: "open"`.
 */

function task(over: Record<string, unknown> = {}) {
  return toTask({
    id: "T635",
    taskId: "T635",
    title: "t",
    status: "confirmed",
    reviewState: "unknown",
    isTerminal: false,
    kind: "standard",
    assigneeIds: [],
    pendingAssigneeId: null,
    createdById: "GR0002",
    priority: null,
    order: null,
    createdAtMs: 0,
    assigneePriorities: {},
    confirmedByIds: [],
    departmentApprovals: [],
    departmentApproverIds: [],
    requirements: [],
    completionRequirementsFailed: [],
    reworkHistory: [],
    tags: [],
    senderWindowSecs: 0,
    agreedWindowSecs: null,
    startedAtMs: null,
    dueAtMs: null,
    isGoldTask: false,
    c1: null,
    ...over,
  } as never);
}

test("T635's real shape is score eligible", () => {
  /* Verbatim from production: an ordinary confirmed task with a C1 record the
     engine created and did not exclude. It showed "Not scored". */
  const t = task({
    status: "confirmed",
    kind: "standard",
    isGoldTask: false,
    c1: { isExcluded: false, status: "open" },
  });
  assert.equal(t.isScoreEligible, true);
});

test("an ordinary task with no C1 record yet is still eligible", () => {
  /* The record appears when the engine first scores it. Treating its absence as
     ineligible would be the same mistake in a new place — and would mark every
     brand-new task unscored. */
  assert.equal(task({ c1: null }).isScoreEligible, true);
});

test("the gold flag no longer decides anything", () => {
  /* It is false on every live task, so reading it marked the whole product
     unscored. It gates C2 goal points, which is a different channel. */
  assert.equal(task({ isGoldTask: false }).isScoreEligible, true);
  assert.equal(task({ isGoldTask: true }).isScoreEligible, true);
  const src = readFileSync("lib/repositories/legacy/taskMap.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(
    /isScoreEligible: legacy\.isGoldTask/.test(src),
    false,
    "the gold flag is back",
  );
});

/* ── What genuinely does not score ────────────────────────────────────────── */

test("a task the engine excluded is not eligible", () => {
  /* `isExcluded` is how the engine takes a task back out of the population —
     the one authoritative "no". */
  assert.equal(
    task({ c1: { isExcluded: true, status: "open" } }).isScoreEligible,
    false,
  );
});

test("a cancelled task is not eligible", () => {
  /* `c1Service.js:72` — "Cancelled tasks excluded." */
  assert.equal(task({ status: "cancelled" }).isScoreEligible, false);
});

test("recurring and third-party work do not score today", () => {
  /* OWNER DECISION O20, already recorded on the domain type. */
  assert.equal(task({ kind: "repeat" }).isScoreEligible, false);
  assert.equal(task({ kind: "third_party" }).isScoreEligible, false);
});

test("self-assigned and goal tasks still score", () => {
  /* Neither is on the engine's exclusion list, and excluding them would repeat
     the original fault in a smaller way. */
  assert.equal(task({ kind: "self_assigned" }).isScoreEligible, true);
  assert.equal(task({ kind: "goal" }).isScoreEligible, true);
});

test("missing scoring data never silently becomes 'not scored'", () => {
  /* The rule this whole fix turns on: absence is not exclusion. Only an
     explicit `isExcluded`, a cancellation, or an unscored KIND says no. */
  for (const over of [{ c1: null }, { c1: undefined }, { isGoldTask: undefined }]) {
    assert.equal(task(over).isScoreEligible, true, JSON.stringify(over));
  }
});
