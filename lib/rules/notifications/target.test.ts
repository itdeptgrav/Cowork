import assert from "node:assert/strict";
import { test } from "node:test";
import { notificationHref, notificationTarget } from "./target.ts";

/**
 * Where a notification points.
 *
 * These pin the defect they were written for: the engine writes its ids into
 * `data`, the mapper set `sourceType: null` regardless, and so the "Open" link
 * on every notification in production could never render.
 */

test("a task notification points at the task", () => {
  const t = notificationTarget("task_assigned", { taskId: "T623" });
  assert.deepEqual(t, { sourceType: "task", sourceId: "T623" });
  assert.equal(notificationHref(t), "/tasks/T623");
});

test("a meeting notification points at the meeting", () => {
  const t = notificationTarget("meet_started", { meetId: "M12" });
  assert.deepEqual(t, { sourceType: "meeting", sourceId: "M12" });
  assert.equal(notificationHref(t), "/meetings/M12");
});

test("a priority reorder points at whatever is now on top", () => {
  /* It carries no taskId at all — the employee whose queue moved is the
     RECIPIENT, so linking to them would send somebody to their own page. */
  const t = notificationTarget("priority_reordered", {
    employeeId: "GR0045",
    taskIds: ["T9", "T4"],
    topTaskId: "T9",
  });
  assert.deepEqual(t, { sourceType: "task", sourceId: "T9" });
});

test("a task id wins over any other id in the same payload", () => {
  const t = notificationTarget("task_chat", {
    taskId: "T1",
    groupId: "G1",
    meetId: "M1",
  });
  assert.equal(t?.sourceId, "T1");
});

test("group and conversation notifications reach their own pages", () => {
  assert.equal(
    notificationHref(notificationTarget("group_message", { groupId: "G7" })),
    "/groups/G7",
  );
  assert.equal(
    notificationHref(
      notificationTarget("direct_message", { conversationId: "C3" }),
    ),
    "/messages/C3",
  );
});

test("an emergency has no record of its own and goes to the decision surface", () => {
  assert.equal(
    notificationHref(notificationTarget("emergency_requested", {})),
    "/tasks?view=approvals",
  );
});

test("a score deduction opens the score, not the task it came from", () => {
  /* A bleach applied from a task carries that task's id. Opening the task
     would answer the wrong question — the entry, its reason and the recheck
     control are all on the score. */
  const t = notificationTarget("sop_bleach_applied", {
    employeeId: "GR0045",
    taskId: "T623",
    points: 0.5,
  });
  assert.equal(t?.sourceType, "score");
  assert.equal(notificationHref(t), "/score/c3");
});

test("every score event lands on the score", () => {
  for (const type of [
    "sop_goal_credit",
    "sop_recheck_requested",
    "sop_recheck_confirmed",
    "sop_recheck_rejected",
  ]) {
    assert.equal(
      notificationHref(notificationTarget(type, { employeeId: "GR0045" })),
      "/score/c3",
      type,
    );
  }
});

test("a payload with nothing to open produces no link, rather than a guess", () => {
  assert.equal(notificationTarget("password_reset", {}), null);
  assert.equal(notificationTarget("role_changed", { role: "tl" }), null);
  assert.equal(notificationHref(null), null);
});

test("an absent or unusable payload is not a crash", () => {
  assert.equal(notificationTarget("task_assigned", null), null);
  assert.equal(notificationTarget("task_assigned", undefined), null);
  assert.equal(notificationTarget("task_assigned", { taskId: "" }), null);
  assert.equal(notificationTarget("task_assigned", { taskId: "  " }), null);
  /* An object id would template as "[object Object]" into a URL. */
  assert.equal(notificationTarget("task_assigned", { taskId: {} }), null);
});

test("a numeric id still links — at least one legacy path writes one", () => {
  assert.equal(
    notificationHref(notificationTarget("task_assigned", { taskId: 42 })),
    "/tasks/42",
  );
});

test("an id needing encoding is encoded, not pasted into the path", () => {
  assert.equal(
    notificationHref(notificationTarget("task_assigned", { taskId: "a/b?c" })),
    "/tasks/a%2Fb%3Fc",
  );
});
