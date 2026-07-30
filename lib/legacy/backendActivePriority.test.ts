import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

/**
 * The engine's definition of "active work" matches the app's.
 *
 * Every workload, capacity and priority figure must describe the same set of
 * tasks. They cannot if each caller writes its own status list — and four did,
 * across two codebases.
 */

const BACKEND = "/Users/risheeray/Documents/cowork-old-backend";
const RULE = join(BACKEND, "services/activePriority.js");
const WORKLOAD = join(BACKEND, "routes/task_routes/workloadroutes.js");
const TREE = join(BACKEND, "routes/task_routes/taskTree.routes.js");
const FORWARD = join(BACKEND, "services/taskForward.service.js");

const have = () => {
  try {
    return statSync(RULE).isFile();
  } catch {
    return false;
  }
};
const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const rule = () => createRequire(import.meta.url)(RULE);

/* ── The rule itself ──────────────────────────────────────────────────────── */

test("an unsettled budget is not active work", (t) => {
  if (!have()) return t.skip("backend not present");
  const { isActivePriorityTask } = rule();
  assert.equal(isActivePriorityTask({ status: "open" }), true);
  assert.equal(
    isActivePriorityTask({
      status: "open",
      budgetNegotiation: { state: "ACCEPTED" },
    }),
    true,
  );
  for (const state of ["WAITING_FOR_ASSIGNEE", "WAITING_FOR_ASSIGNOR"]) {
    assert.equal(
      isActivePriorityTask({ status: "open", budgetNegotiation: { state } }),
      false,
      state,
    );
  }
});

test("finished work is not active, by status or by review outcome", (t) => {
  if (!have()) return t.skip("backend not present");
  const { isActivePriorityTask } = rule();
  assert.equal(isActivePriorityTask({ status: "done" }), false);
  assert.equal(isActivePriorityTask({ status: "cancelled" }), false);
  assert.equal(
    isActivePriorityTask({ status: "open", completionStatus: "ceo_approved" }),
    false,
  );
});

test("a fixed-deadline task is active with no budget to agree", (t) => {
  if (!have()) return t.skip("backend not present");
  /* Requiring an acceptance that can never come would empty the workload for
     everybody on that model. */
  const { isActivePriorityTask, isBudgetSettled } = rule();
  assert.equal(isBudgetSettled({}), true);
  assert.equal(isActivePriorityTask({ status: "in_progress" }), true);
});

/* ── Waiting stays visible ────────────────────────────────────────────────── */

test("a negotiating task is excluded from workload but still awaiting", (t) => {
  if (!have()) return t.skip("backend not present");
  /* The distinction the whole audit turns on: not workload, but not hidden —
     it is waiting on somebody, which is what pending-approval surfaces exist
     to show. */
  const { isActivePriorityTask, isAwaitingDecision } = rule();
  const task = {
    status: "open",
    budgetNegotiation: { state: "WAITING_FOR_ASSIGNOR" },
  };
  assert.equal(isActivePriorityTask(task), false);
  assert.equal(isAwaitingDecision(task), true);
});

test("every held state is reported as awaiting", (t) => {
  if (!have()) return t.skip("backend not present");
  const { isAwaitingDecision } = rule();
  for (const status of [
    "pending_deadline_approval",
    "pending_department_approval",
    "pending_tl_hours",
  ]) {
    assert.equal(isAwaitingDecision({ status }), true, status);
  }
});

/* ── Every surface uses it ────────────────────────────────────────────────── */

test("both workload surfaces filter through the shared rule", (t) => {
  if (!have()) return t.skip("backend not present");
  /* The team summary and the per-employee calendar. One without it would
     report a different capacity than the other. */
  assert.equal(
    (code(WORKLOAD).match(/\.filter\(isActivePriorityTask\)/g) ?? []).length,
    2,
  );
});

test("no surface keeps its own copy of the definition", (t) => {
  if (!have()) return t.skip("backend not present");
  for (const path of [WORKLOAD, TREE]) {
    assert.equal(
      /function isActivePriorityTask/.test(code(path)),
      false,
      `${path} defines its own`,
    );
  }
});

test("the fifth create path ranks by the shared rule, not by counting", (t) => {
  if (!have()) return t.skip("backend not present");
  /* `taskTree.routes.js` had the same count+1 fault the other four had, plus it
     counted tasks still in negotiation. */
  const src = code(TREE);
  assert.match(src, /nextActiveRankFor\(db, assigneeIds\[0\]\)/);
  assert.equal(/existing\.size \+ 1/.test(src), false, "still ranks by counting");
});

test("the shared ranker skips tasks whose budget is unsettled", (t) => {
  if (!have()) return t.skip("backend not present");
  /* Otherwise a task nobody agreed the hours for inflates the next rank and
     leaves a gap that never closes. */
  const src = code(FORWARD);
  const fn = src.slice(src.indexOf("async function nextActiveRankFor("));
  assert.match(fn.slice(0, 1400), /if \(!isBudgetSettled\(t\)\) return;/);
});

test("the two codebases state the same rule", (t) => {
  if (!have()) return t.skip("backend not present");
  /* Parallel by intent: a figure computed in the engine and one computed in the
     app must describe the same tasks. */
  const backend = code(RULE);
  const frontend = code("lib/rules/tasks/activeQueue.ts");
  assert.match(backend, /state === "ACCEPTED"/);
  assert.match(frontend, /budgetState === "ACCEPTED"/);
  assert.match(backend, /export|module\.exports/);
  assert.match(frontend, /export function isActivePriorityTask\(/);
});
