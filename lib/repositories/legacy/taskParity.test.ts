import assert from "node:assert/strict";
import test from "node:test";

import { readTask } from "../../legacy/tasks.ts";
import { toTaskStatus, toTaskView } from "./taskMap.ts";

/**
 * Task parity with `cowork-old-frontend`, pinned to the legacy source.
 *
 * Every assertion here cites the line in the old app it was read from. The
 * point is not that this mapping is self-consistent — it is that it agrees
 * with a 10,794-line page whose rules live in scattered predicates rather
 * than in any schema.
 *
 * **Traced, not inferred.** The old task page does NOT use
 * `useCoworkTaskList`; it runs its own listeners and its own tab predicates
 * (`app/coworking/tasks/page.js:6016-6040`). Reading the hook and assuming the
 * page matched it is what produced the mismatches below.
 */

/* `id` is the Firestore document id, attached by the loader
   (`index.ts:470` — `{...d.data(), id: d.id}`). The engine's own field is
   `taskId`; `readTask` returns null without `id`. */
const base = {
  id: "T1",
  taskId: "T1",
  title: "T",
  assigneeIds: ["E1"],
  assignedBy: "E2",
  status: "open",
};

const read = (doc: Record<string, unknown>) => readTask({ ...base, ...doc })!;

/* ── Status vocabulary ─────────────────────────────────────────────────── */

test("the engine's holding statuses are held, not live", () => {
  /* `taskForward.js:151-218` writes each of these at creation. All four used
     to fall through to `assigned`, which tells the assignee to start work on
     a task nobody has approved. */
  for (const status of [
    "pending_tl_approval",
    "pending_department_approval",
    "pending_tl_hours",
    "repeat_pending_confirmation",
  ]) {
    assert.equal(
      toTaskStatus(read({ status })),
      "pending_approval",
      `${status} must read as held`,
    );
  }
});

test("confirmed is in progress, as the old page groups it", () => {
  /* `page.js:6053` — the In Progress tab is `["in_progress", "confirmed"]`. */
  assert.equal(toTaskStatus(read({ status: "confirmed" })), "in_progress");
  assert.equal(toTaskStatus(read({ status: "in_progress" })), "in_progress");
});

test("the deadline-negotiation statuses stay in the Open tab", () => {
  /* `page.js:6052` — Open is `["open","pending_deadline_approval","deadline_approved"]`. */
  for (const status of ["open", "pending_deadline_approval", "deadline_approved"]) {
    assert.equal(toTaskStatus(read({ status })), "assigned");
  }
});

test("completionStatus still outranks status", () => {
  /* Legacy leaves `status` at `open` through a whole review cycle. */
  assert.equal(
    toTaskStatus(read({ status: "open", completionStatus: "submitted" })),
    "in_review",
  );
  assert.equal(
    toTaskStatus(read({ status: "open", completionStatus: "tl_final_approved" })),
    "completed",
  );
});

/* ── Per-person rank ───────────────────────────────────────────────────── */

test("rank is mine, not the first assignee's", () => {
  /* `taskForward.js:296-303` writes one rank per assignee. `page.js:1643`
     reads `assigneePriorities[me] ?? priority ?? 999`.

     Before this, a task shared with a colleague ordered MY list by THEIR
     queue position — the further down their list it sat, the further down
     mine it went, for no reason connected to my own work. */
  const view = toTaskView({
    legacy: read({
      assigneeIds: ["E1", "E9"],
      priority: 7,
      assigneePriorities: { E1: 2, E9: 7 },
    }),
    employeesById: new Map(),
    viewerId: "E1",
    nowMs: 0,
  });
  assert.equal(view.myRank, 2);
});

test("rank falls back to priority when the engine wrote no map", () => {
  const view = toTaskView({
    legacy: read({ assigneeIds: ["E1"], priority: 4 }),
    employeesById: new Map(),
    viewerId: "E1",
    nowMs: 0,
  });
  assert.equal(view.myRank, 4);
});

test("a non-assignee has no rank", () => {
  const view = toTaskView({
    legacy: read({ assigneeIds: ["E9"], assigneePriorities: { E9: 1 } }),
    employeesById: new Map(),
    viewerId: "E1",
    nowMs: 0,
  });
  assert.equal(view.myRank, null);
});

/* ── Fields the wire type was dropping ─────────────────────────────────── */

test("the scope fields survive the wire", () => {
  const t = read({
    assigneePriorities: { E1: 3 },
    tlHoursSetBy: "E5",
    isSelfAssigned: true,
    visibleTo: ["E7", ""],
    approverId: "E6",
  });
  assert.deepEqual(t.assigneePriorities, { E1: 3 });
  assert.equal(t.tlHoursSetBy, "E5");
  assert.equal(t.isSelfAssigned, true);
  /* Blank entries dropped — an empty id matches nobody and would widen a
     visibility check if it slipped into an includes(). */
  assert.deepEqual(t.visibleTo, ["E7"]);
  assert.equal(t.approverId, "E6");
});

test("absent scope fields are empty, never undefined", () => {
  const t = read({});
  assert.deepEqual(t.assigneePriorities, {});
  assert.equal(t.tlHoursSetBy, null);
  assert.equal(t.isSelfAssigned, false);
  assert.deepEqual(t.visibleTo, []);
});

/* ── The creator field the engine actually writes ──────────────────────── */

test("createdById resolves from assignedBy, which is what the engine writes", () => {
  /* `taskForward.service.js:279` writes `assignedBy`; there is no `createdBy`
     field on the document at all. The whole Created tab hangs off this. */
  assert.equal(read({ assignedBy: "E2" }).createdById, "E2");
});
