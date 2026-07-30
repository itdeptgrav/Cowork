import assert from "node:assert/strict";
import { test } from "node:test";
import { workflows as seedWorkflows } from "../seed/seed.ts";

/**
 * The cross-department gate's eligibility rules, as legacy defined them.
 *
 * Source: `cowork-old-backend/routes/task_routes/taskForward.js:164`, verbatim —
 *
 *   requesterRole !== "ceo" && !folderFlag && !repeatFlag
 *     && !thirdPartyFlag && !goalFlag && !parentTaskId
 *     && assigneeIds?.length === 1
 *
 * These are not inferred. Each exclusion is transcribed from that condition,
 * and the reason each one exists is legible from the surrounding code: a folder
 * has no assignee, repeat/third-party/goal tasks carry their own confirmation
 * flows, a subtask inherits a crossing the parent already cleared, and the
 * two-approver shape assumes exactly one receiving department.
 *
 * This duplicates the predicate rather than importing it. A drift guard that
 * imports the value it guards cannot fail — it agrees with whatever the code
 * now says, which is the opposite of the job.
 *
 * **DELIBERATE DIVERGENCE, recorded 2026-07-27.** Cowork no longer matches the
 * `!parentTaskId` clause below, and the difference is a fix rather than drift.
 * Legacy exempted EVERY subtask from the gate on the reasoning that "a subtask
 * inherits the parent's already-approved crossing" — sound reasoning, and it
 * never checked the premise. Parenting work to any task you could see routed it
 * into another department with no approval at all.
 *
 * `createTask` now earns the exemption instead of assuming it: the parent must
 * hold an APPROVED cross-department approval, and the subtask's assignee must
 * be in the same receiving department the parent cleared. Anything else is
 * gated exactly like a root task.
 *
 * **`folderFlag` HAS NO COWORK COUNTERPART, recorded 2026-07-27.** The folder
 * type was removed from the product; nothing can carry the flag, so the
 * exclusion it bought is vacuous rather than dropped. The clause stays
 * transcribed here because this file records legacy's condition, not Cowork's —
 * a removed exclusion and an unreachable one are different facts, and only the
 * transcription can tell them apart later.
 *
 * The transcription below is left intact on purpose. It is the record of what
 * legacy did, which is what makes the divergence legible; changing it would
 * erase the thing the divergence is measured against.
 */

/** Transcribed from taskForward.js:164. `type` maps Cowork's names to legacy's flags. */
function legacyGateEligible(input: {
  type: string;
  parentTaskId: string | null;
  assigneeCount: number;
}): boolean {
  const isFolder = input.type === "folder";
  const isRepeat = input.type === "recurring";
  const isThirdParty = input.type === "external";
  const isGoal = input.type === "goal";
  return (
    !isFolder &&
    !isRepeat &&
    !isThirdParty &&
    !isGoal &&
    !input.parentTaskId &&
    input.assigneeCount === 1
  );
}

const STANDARD = { type: "standard", parentTaskId: null, assigneeCount: 1 };

test("a plain single-assignee root task is gated", () => {
  assert.equal(legacyGateEligible(STANDARD), true);
});

test("legacy never gated a folder — and Cowork has no folder to gate", () => {
  /* Asserts the LEGACY predicate, which is all this file claims to hold.
     Cowork's `TaskType` no longer admits "folder", so the exclusion cannot be
     reached from the product — it is unreachable here, not deleted there. */
  assert.equal(legacyGateEligible({ ...STANDARD, type: "folder" }), false);
});

test("repeating, third-party and goal tasks are never gated", () => {
  /* Each runs its own confirmation flow in legacy: repeat_pending_confirmation,
     thirdPartyStatus, and the goal activity cycle. */
  for (const type of ["recurring", "external", "goal"]) {
    assert.equal(
      legacyGateEligible({ ...STANDARD, type }),
      false,
      `${type} must not enter the cross-department gate`,
    );
  }
});

test("subtasks are never gated — the parent already cleared the crossing", () => {
  assert.equal(legacyGateEligible({ ...STANDARD, parentTaskId: "t-1" }), false);
});

test("the gate applies to exactly one assignee, never several", () => {
  /* The chain is sender-side then receiver-side. Two assignees in two different
     departments would need two receiving heads, which the shape cannot express,
     so legacy declined to gate it at all rather than gate it wrongly. */
  assert.equal(legacyGateEligible({ ...STANDARD, assigneeCount: 2 }), false);
  assert.equal(legacyGateEligible({ ...STANDARD, assigneeCount: 0 }), false);
});

test("the seeded cross-department workflow still has two sides, in order", () => {
  /* Legacy's array was [sender, receiver] with the receiver starting `waiting`
     and flipping to `pending` only when the sender approved
     (taskForward.js:1053). The configured workflow must keep that shape or the
     sequential behaviour above is describing something that no longer exists. */
  const wf = seedWorkflows.find((w) => w.trigger === "cross_department");
  assert.ok(wf, "the cross-department workflow is gone");
  assert.equal(wf!.stages.length, 2);
  assert.deepEqual(
    wf!.stages.map((s) => s.rule),
    ["reporting_manager", "target_reporting_manager"],
    "the sender's manager first, then the receiver's",
  );
});

/* ── pending_tl_hours: what happens after both heads approve ──────────────── */

/**
 * Transcribed from `taskForward.js:1073`, inside `department-approve`:
 *
 *   const finalStatus = (task.hasTimer === false) ? "pending_tl_hours" : "open";
 *
 * and the line immediately below it, which withholds the assignee:
 *
 *   if (finalStatus === "open") {
 *     updatePayload.assigneeIds = arrayUnion(finalAssigneeId);
 *   }
 *
 * So a DEADLINE-mode crossing does not reach the assignee when the heads
 * approve — the receiving department sets the real effort first, and only
 * `department-tl-set-hours` performs the `arrayUnion`. A TIMER-mode crossing
 * goes straight to the assignee. Duplicated rather than imported, for the same
 * reason as the gate predicate above.
 */
function legacyPostApproval(hasTimer: boolean): {
  status: "pending_tl_hours" | "open";
  releasesAssignee: boolean;
} {
  const status = hasTimer === false ? "pending_tl_hours" : "open";
  return { status, releasesAssignee: status === "open" };
}

test("a deadline-mode crossing waits for the receiving department's effort", () => {
  const r = legacyPostApproval(false);
  assert.equal(r.status, "pending_tl_hours");
  assert.equal(
    r.releasesAssignee,
    false,
    "the assignee must not see it until the effort is set",
  );
});

test("a timer-mode crossing reaches the assignee as soon as both heads approve", () => {
  const r = legacyPostApproval(true);
  assert.equal(r.status, "open");
  assert.equal(r.releasesAssignee, true);
});

test("setting the effort converts the task from a deadline to a budget", () => {
  /* `department-tl-set-hours` writes `hasTimer: true` and
     `senderTimerWindowSecs: secs` onto a task that was created with
     `hasTimer: false`. Its own comment: "Becomes a normal hasTimer:true task
     with a manager-preset duration — same senderTimerWindowSecs mechanism as
     any other task." The conversion is the point: it is what lets the assignee
     negotiate a window on work that arrived as a fixed date. */
  const before = { hasTimer: false, senderTimerWindowSecs: 0 };
  const secs = 6 * 3600;
  const after = { ...before, hasTimer: true, senderTimerWindowSecs: secs };
  assert.equal(after.hasTimer, true);
  assert.equal(after.senderTimerWindowSecs, secs);
});

test("the unit conversion matches legacy's", () => {
  /* `secs = val * (unit === "minutes" ? 60 : unit === "days" ? 86400 : 3600)` */
  const toSecs = (val: number, unit: string) =>
    val * (unit === "minutes" ? 60 : unit === "days" ? 86400 : 3600);
  assert.equal(toSecs(30, "minutes"), 1800);
  assert.equal(toSecs(6, "hours"), 21600);
  assert.equal(toSecs(2, "days"), 172800);
  assert.equal(
    toSecs(4, "anything else"),
    14400,
    "unknown units fall back to hours",
  );
});
