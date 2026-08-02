import assert from "node:assert/strict";
import { test } from "node:test";
import {
  committedEffort,
  MAX_REMEMBERED,
  noticeKey,
  rememberSeen,
  unseenNotices,
  type AssignmentNotice,
} from "./newAssignments.ts";

function notice(over: Partial<AssignmentNotice> = {}): AssignmentNotice {
  return {
    taskId: "T1",
    title: "Write the report",
    reference: "TSK-1",
    assignedAt: "2026-08-02T09:00:00.000Z",
    assignedByName: "Ray",
    dueAt: null,
    rank: 3,
    description: null,
    requirementCount: 0,
    effortSecs: null,
    deadlineMode: "fixed",
    projectName: null,
    isSubtask: false,
    action: null,
    ...over,
  };
}

test("an unseen assignment is shown", () => {
  assert.equal(unseenNotices([notice()], []).length, 1);
});

test("a seen assignment is not shown again", () => {
  const n = notice();
  assert.deepEqual(unseenNotices([n], [noticeKey(n)]), []);
});

test("being re-assigned to the same task later announces itself again", () => {
  /* Keyed on taskId AND assignedAt: the second assignment is a genuinely new
     event, and keying on taskId alone would swallow it silently. */
  const first = notice({ assignedAt: "2026-08-01T09:00:00.000Z" });
  const again = notice({ assignedAt: "2026-08-02T09:00:00.000Z" });
  assert.equal(unseenNotices([again], [noticeKey(first)]).length, 1);
});

test("the newest assignment comes first", () => {
  const older = notice({ taskId: "T1", assignedAt: "2026-08-01T09:00:00.000Z" });
  const newer = notice({ taskId: "T2", assignedAt: "2026-08-02T09:00:00.000Z" });
  assert.deepEqual(
    unseenNotices([older, newer], []).map((n) => n.taskId),
    ["T2", "T1"],
  );
});

test("the input list is never mutated", () => {
  const list = [
    notice({ taskId: "T1", assignedAt: "2026-08-01T09:00:00.000Z" }),
    notice({ taskId: "T2", assignedAt: "2026-08-02T09:00:00.000Z" }),
  ];
  const before = list.map((n) => n.taskId);
  unseenNotices(list, []);
  assert.deepEqual(list.map((n) => n.taskId), before);
});

test("remembering is idempotent — showing the same notice twice stores one key", () => {
  const n = notice();
  const once = rememberSeen([], [n]);
  assert.deepEqual(rememberSeen(once, [n]), once);
});

test("the remembered set is bounded, dropping the oldest keys first", () => {
  const many = Array.from({ length: MAX_REMEMBERED + 10 }, (_, i) => `T${i}:t`);
  const next = rememberSeen(many, [notice({ taskId: "NEW" })]);
  assert.equal(next.length, MAX_REMEMBERED);
  assert.equal(next.includes(noticeKey(notice({ taskId: "NEW" }))), true, "the new key survives");
  assert.equal(next.includes("T0:t"), false, "the oldest key was dropped");
});

test("nothing outstanding means nothing to show", () => {
  assert.deepEqual(unseenNotices([], ["T1:x"]), []);
});

test("committed effort totals only the tasks that actually carry an estimate", () => {
  /* Reported as a pair so a caller can say "4h across 2 of 3" — a bare total
     over a partially-estimated set reads as the whole commitment and is not. */
  const summary = committedEffort([
    notice({ taskId: "A", effortSecs: 3600 }),
    notice({ taskId: "B", effortSecs: 10_800 }),
    notice({ taskId: "C", effortSecs: null }),
  ]);
  assert.deepEqual(summary, { totalSecs: 14_400, withEstimate: 2, total: 3 });
});

test("committed effort over nothing estimated is zero, not a false total", () => {
  const summary = committedEffort([notice({ effortSecs: null })]);
  assert.deepEqual(summary, { totalSecs: 0, withEstimate: 0, total: 1 });
});
