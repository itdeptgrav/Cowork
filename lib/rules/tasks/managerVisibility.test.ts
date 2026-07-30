import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  canManagerViewTask,
  reportingSubtree,
} from "./managerVisibility.ts";
import type { ReportingTree } from "../../legacy/hierarchy.ts";

/**
 * A manager sees their reportees' work at every stage.
 *
 * The bug: a cross-department task was visible to the receiving manager ONLY
 * because the engine surfaces every `pending_department_approval` task
 * org-wide to its approvers. Approving changes the status, that query stops
 * matching, and the task vanished — at the moment the reportee began work.
 *
 * Visibility was never reporting-based; it was approval-based, and approving is
 * the one action guaranteed to end it.
 */

/* Rakesh manages Pramod. Umung is elsewhere entirely. */
const TREE: ReportingTree = {
  byEmployee: new Map([
    ["RAKESH", { employeeId: "RAKESH", directReportIds: ["PRAMOD"] }],
    ["PRAMOD", { employeeId: "PRAMOD", directReportIds: ["JUNIOR"] }],
    ["JUNIOR", { employeeId: "JUNIOR", directReportIds: [] }],
    ["UMUNG", { employeeId: "UMUNG", directReportIds: [] }],
  ] as never),
  rootIds: ["RAKESH", "UMUNG"],
};

const task = (over: Partial<{ assigneeIds: string[]; pendingAssigneeIds: string[] }>) => ({
  assigneeIds: [],
  pendingAssigneeIds: [],
  ...over,
});

/* ── The lifecycle, stage by stage ────────────────────────────────────────── */

test("before approval, while the person is only PENDING, the manager sees it", () => {
  /* A gated task keeps the person in `pendingAssigneeIds` and out of
     `assigneeIds`. That is exactly the stage the receiving manager most needs
     it — waiting for the handover would hide the task through the whole
     approval it is their job to make. */
  assert.equal(
    canManagerViewTask("RAKESH", task({ pendingAssigneeIds: ["PRAMOD"] }), TREE),
    true,
  );
});

test("after approval, once assigned, the manager still sees it", () => {
  /* The reported disappearance. Nothing about approving changes the reporting
     line, so nothing about it may change visibility. */
  assert.equal(
    canManagerViewTask("RAKESH", task({ assigneeIds: ["PRAMOD"] }), TREE),
    true,
  );
});

test("visibility does not consult workflow state at all", () => {
  /* Structural rather than enumerated: the rule takes no status, no approval
     and no actor, so no stage can affect it. */
  const src = readFileSync("lib/rules/tasks/managerVisibility.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  for (const leak of [
    "status", "approval", "pendingApprover", "assignedBy", "lastActor",
    "budgetNegotiation", "completionStatus",
  ]) {
    assert.equal(src.includes(leak), false, `visibility reads "${leak}"`);
  }
});

/* ── Reach ────────────────────────────────────────────────────────────────── */

test("reach goes all the way down, not one level", () => {
  /* A manager oversees their reports' reports too. */
  assert.equal(
    canManagerViewTask("RAKESH", task({ assigneeIds: ["JUNIOR"] }), TREE),
    true,
  );
});

test("a manager's own work is in their team view", () => {
  assert.equal(
    canManagerViewTask("RAKESH", task({ assigneeIds: ["RAKESH"] }), TREE),
    true,
  );
});

test("one reportee among several assignees is enough", () => {
  assert.equal(
    canManagerViewTask("RAKESH", task({ assigneeIds: ["UMUNG", "PRAMOD"] }), TREE),
    true,
  );
});

/* ── The boundary ─────────────────────────────────────────────────────────── */

test("an unrelated manager sees nothing", () => {
  assert.equal(
    canManagerViewTask("UMUNG", task({ assigneeIds: ["PRAMOD"] }), TREE),
    false,
  );
});

test("looking upward is not reach", () => {
  /* A reportee does not see their manager's work by reporting to them. */
  assert.equal(
    canManagerViewTask("PRAMOD", task({ assigneeIds: ["RAKESH"] }), TREE),
    false,
  );
});

test("no viewer means no visibility", () => {
  assert.equal(canManagerViewTask(null, task({ assigneeIds: ["PRAMOD"] }), TREE), false);
});

test("a task with nobody on it is nobody's to oversee", () => {
  assert.equal(canManagerViewTask("RAKESH", task({}), TREE), false);
});

/* ── Bad data must not hang the page ──────────────────────────────────────── */

test("a reporting cycle terminates", () => {
  /* A reports to B reports to A is wrong, but it must be wrong rather than
     infinite. */
  const cyclic: ReportingTree = {
    byEmployee: new Map([
      ["A", { employeeId: "A", directReportIds: ["B"] }],
      ["B", { employeeId: "B", directReportIds: ["A"] }],
    ] as never),
    rootIds: ["A"],
  };
  assert.deepEqual([...reportingSubtree(cyclic, "A")].sort(), ["A", "B"]);
});

test("somebody absent from the tree still sees their own work", () => {
  /* A directory gap must cost a manager their team view, not their own tasks. */
  assert.deepEqual([...reportingSubtree(TREE, "GHOST")], ["GHOST"]);
});
