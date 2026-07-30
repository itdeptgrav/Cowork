import assert from "node:assert/strict";
import test from "node:test";

import { readTask } from "../../legacy/tasks.ts";
import { toTaskView } from "./taskMap.ts";
import { nextAction } from "../../../components/features/tasks/statusMeta.ts";

/**
 * Why an assignee had no action to take.
 *
 * `nextAction` decides whose move it is with
 * `view.assignments.some(a => a.employeeId === viewerId)`. `toTaskView` returned
 * `assignments: []` unconditionally, so that predicate was **false for
 * everybody** — including the assignee. Every branch fell to its bystander
 * side: "Awaiting deadline", "Awaiting confirmation", "Not started".
 *
 * The task was never stuck. The person who could move it was never recognised.
 */

const SOUMYA = "GR0067";
const RAKESH = "GR0045";

const base = {
  id: "T900",
  taskId: "T900",
  title: "Execution probe",
  assigneeIds: [SOUMYA],
  assignedBy: RAKESH,
  status: "open",
};

const viewOf = (doc: Record<string, unknown>, viewerId: string) =>
  toTaskView({
    legacy: readTask({ ...base, ...doc } as never)!,
    employeesById: new Map(),
    viewerId,
    nowMs: 0,
  });

/* ── 1 · The assignee is recognised ────────────────────────────────────── */

test("the assignee has an assignment record", () => {
  const v = viewOf({}, SOUMYA);
  assert.equal(v.assignments.length, 1);
  assert.equal(v.assignments[0].employeeId, SOUMYA);
  assert.equal(v.assignments[0].taskId, "T900");
});

test("the assignee is offered the action; the owner is not", () => {
  /* The bug, stated as the two views of one task. */
  const mine = nextAction(viewOf({}, SOUMYA), SOUMYA);
  assert.equal(mine.actor, "you");

  const theirs = nextAction(viewOf({}, RAKESH), RAKESH);
  assert.equal(theirs.actor, "them");
});

test("an unrelated employee is never offered the action", () => {
  const other = nextAction(viewOf({}, "GR0002"), "GR0002");
  assert.equal(other.actor, "them");
});

/* ── 2 · The lifecycle the engine actually runs ────────────────────────── */

test("with no deadline the assignee's move is to propose one", () => {
  /* Legacy forces `dueDate: null` at creation — "deadline is always set by
     employee after assignment" (`taskForward.js:138`). So the first move is a
     proposal, not a start. "Awaiting deadline" was the correct LABEL shown to
     the wrong PERSON. */
  const action = nextAction(viewOf({}, SOUMYA), SOUMYA);
  assert.equal(action.label, "Propose a deadline");
  assert.equal(action.actor, "you");
  assert.match(action.href ?? "", /\/deadline$/);
});

test("with a deadline agreed the assignee's move is to confirm receipt", () => {
  const action = nextAction(viewOf({ fixedDeadline: 1790000000000 }, SOUMYA), SOUMYA);
  assert.equal(action.label, "Confirm receipt");
  assert.equal(action.actor, "you");
});

test("once confirmed the assignee is working, and the next move is to submit", () => {
  /* **A gap worth recording rather than papering over.**
     `confirmTaskReceipt` leaves `status: "confirmed"`, and `toTaskStatus` maps
     that to `in_progress` — deliberately, because the old task page groups
     `confirmed` with `in_progress` in its In Progress tab (`page.js:6053`).

     The consequence is that the domain's own `confirmed` status is
     UNREACHABLE from legacy data, so `nextAction`'s "Start work" branch never
     fires. The engine's `markTaskStarted` endpoint is connected as
     `startTask()`, but no screen currently offers it: confirming receipt is
     what puts a legacy task into work.

     Asserted as it is, so the gap is visible and a later change to the mapping
     fails here rather than silently altering what an assignee is asked to
     do. */
  const action = nextAction(
    viewOf({ fixedDeadline: 1790000000000, status: "confirmed" }, SOUMYA),
    SOUMYA,
  );
  assert.equal(action.actor, "you");
  assert.equal(action.label, "Submit when ready");
});

/* ── 3 · Execution state is read, not invented ─────────────────────────── */

test("startedAt is null until the engine records it", () => {
  assert.equal(viewOf({}, SOUMYA).assignments[0].startedAt, null);
});

test("startedAt is carried through once the engine sets it", () => {
  /* `markTaskStarted` writes it; the live lifecycle probe confirmed the field
     and its shape. */
  const v = viewOf({ startedAt: 1785293435652 }, SOUMYA);
  assert.equal(
    v.assignments[0].startedAt,
    new Date(1785293435652).toISOString(),
  );
});

test("confirmation is recorded by presence, not by a fabricated timestamp", () => {
  /* Legacy records WHO confirmed (`confirmedBy[]`), never when. */
  const unconfirmed = viewOf({}, SOUMYA);
  assert.equal(unconfirmed.assignments[0].confirmedAt, null);

  const confirmed = viewOf({ confirmedBy: [SOUMYA] }, SOUMYA);
  assert.notEqual(confirmed.assignments[0].confirmedAt, null);
});

test("rank on the assignment is the person's own", () => {
  const v = viewOf(
    { assigneeIds: [SOUMYA, "GR0108"], priority: 9, assigneePriorities: { [SOUMYA]: 2, GR0108: 9 } },
    SOUMYA,
  );
  const mine = v.assignments.find((a) => a.employeeId === SOUMYA)!;
  assert.equal(mine.rank, 2);
});

/* ── 4 · Multi-assignee tasks recognise each person ────────────────────── */

test("every assignee gets a record, and each sees their own action", () => {
  const v = viewOf({ assigneeIds: [SOUMYA, "GR0108"] }, SOUMYA);
  assert.equal(v.assignments.length, 2);
  assert.equal(nextAction(v, SOUMYA).actor, "you");
  assert.equal(nextAction(viewOf({ assigneeIds: [SOUMYA, "GR0108"] }, "GR0108"), "GR0108").actor, "you");
});

test("a task with no assignees produces no assignment records", () => {
  /* A department-gated task is created with empty `assigneeIds` — nobody may
     act on it yet, and nobody is offered an action. */
  const v = viewOf({ assigneeIds: [] }, SOUMYA);
  assert.deepEqual(v.assignments, []);
  assert.equal(nextAction(v, SOUMYA).actor, "them");
});
