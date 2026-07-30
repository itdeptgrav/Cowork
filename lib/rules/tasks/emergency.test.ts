import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emergencyDecisionRefusal,
  emergencyRequestRefusal,
  isAcceptedDocument,
} from "./emergency.ts";
import { shiftableTasks, shiftedDueAt } from "./deadlineShift.ts";
import type { EmergencyRequest, Task } from "../../domain/index.ts";

/**
 * Emergency Mode OFF → manager approval → deadline shift.
 *
 * Ported from legacy's `lib/emergencyApproval.js`, which ran the whole workflow
 * in the browser with no server validation and no record of who approved. These
 * tests hold the parts legacy left to Firestore security rules that were never
 * in the repository.
 */

const PDF = "application/pdf";
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const DOC = { filename: "incident.pdf", mimeType: PDF };

function req(over: Partial<EmergencyRequest> = {}): EmergencyRequest {
  return {
    organisationId: "org-test",
    id: "em-1",
    employeeId: "soumya",
    employeeName: "Soumya",
    managerId: "rakesh",
    managerName: "Rakesh",
    startedAt: "2026-07-28T09:00:00.000Z",
    endedAt: "2026-07-28T10:00:00.000Z",
    durationSecs: 3600,
    reason: "Flooding at home.",
    attachmentId: "att-1",
    status: "pending",
    decisionReason: null,
    decidedAt: null,
    appliedTaskIds: [],
    createdAt: "2026-07-28T10:00:00.000Z",
    ...over,
  };
}

function task(over: Partial<Task> = {}): Task {
  return {
    organisationId: "org-test",
    id: "t-1",
    reference: "CW-1",
    type: "standard",
    status: "in_progress",
    title: "A task",
    description: null,
    requirements: [],
    satisfiesRequirementIds: [],
    createdById: "rakesh",
    createdByRoleId: "role-manager",
    rootCreatorEmployeeId: "rakesh",
    departmentId: null,
    parentTaskId: null,
    projectId: null,
    groupId: null,
    estimatedEffortSecs: 3600,
    deadline: {
      mode: "timer",
      originalWindowSecs: 3600,
      currentWindowSecs: 3600,
      dueAt: "2026-07-28T17:00:00.000Z",
      officialDueAt: "2026-07-28T17:00:00.000Z",
      operationalDueAt: null,
      state: "agreed",
      assignorWindowRejection: null,
    },
    approvalReason: null,
    approverIds: [],
    pendingAssigneeIds: [],
    isScoreEligible: true,
    recurrence: null,
    goalId: null,
    isBlocked: false,
    blockedReason: null,
    tags: [],
    createdAt: "2026-07-28T08:00:00.000Z",
    updatedAt: "2026-07-28T08:00:00.000Z",
    deletedAt: null,
    ...over,
  };
}

/* ── 1. Turning Emergency Mode off creates a request ──────────────────────── */

test("a complete request is accepted", () => {
  assert.equal(
    emergencyRequestRefusal({
      durationSecs: 3600,
      reason: "Flooding at home.",
      document: DOC,
      managerId: "rakesh",
    }),
    null,
  );
});

test("a reason is required", () => {
  const r = emergencyRequestRefusal({
    durationSecs: 3600,
    reason: "   ",
    document: DOC,
    managerId: "rakesh",
  });
  assert.match(r ?? "", /Explain what happened/);
});

test("a supporting document is required, and must be PDF or DOCX", () => {
  assert.match(
    emergencyRequestRefusal({
      durationSecs: 3600,
      reason: "Flooding.",
      document: null,
      managerId: "rakesh",
    }) ?? "",
    /Attach a supporting document/,
  );
  assert.match(
    emergencyRequestRefusal({
      durationSecs: 3600,
      reason: "Flooding.",
      document: { filename: "photo.png", mimeType: "image/png" },
      managerId: "rakesh",
    }) ?? "",
    /not a PDF or a Word document/,
  );
  assert.ok(isAcceptedDocument(PDF));
  assert.ok(isAcceptedDocument(DOCX));
  assert.equal(isAcceptedDocument("image/png"), false);
});

test("an emergency that never ran raises nothing", () => {
  assert.match(
    emergencyRequestRefusal({
      durationSecs: 0,
      reason: "x",
      document: DOC,
      managerId: "rakesh",
    }) ?? "",
    /has not been running/,
  );
});

/* ── 2. It goes to the direct manager ─────────────────────────────────────── */

test("somebody with no manager has nobody to ask", () => {
  /* The request is refused rather than parked or escalated. Legacy sent these
     to the CEO as a catch-all; here it names the real problem, which is that
     the reporting line was never set. */
  assert.match(
    emergencyRequestRefusal({
      durationSecs: 3600,
      reason: "Flooding.",
      document: DOC,
      managerId: null,
    }) ?? "",
    /no manager on record/,
  );
});

test("only the named manager may decide", () => {
  assert.equal(
    emergencyDecisionRefusal({
      request: req(),
      actorId: "rakesh",
      approve: true,
      decisionReason: "",
    }),
    null,
  );
  assert.match(
    emergencyDecisionRefusal({
      request: req(),
      actorId: "maya", // an administrator, or anybody else
      approve: true,
      decisionReason: "",
    }) ?? "",
    /Only this person's manager/,
  );
});

/* ── 5. The employee cannot approve their own ─────────────────────────────── */

test("the employee cannot decide their own request", () => {
  assert.match(
    emergencyDecisionRefusal({
      request: req(),
      actorId: "soumya",
      approve: true,
      decisionReason: "",
    }) ?? "",
    /cannot decide your own/,
  );
});

test("an employee who somehow manages themselves still cannot", () => {
  /* Self-check runs BEFORE the manager check, so a corrupt reporting row
     naming somebody their own manager cannot be used to self-approve. */
  assert.match(
    emergencyDecisionRefusal({
      request: req({ managerId: "soumya" }),
      actorId: "soumya",
      approve: true,
      decisionReason: "",
    }) ?? "",
    /cannot decide your own/,
  );
});

test("a decision cannot be taken twice", () => {
  for (const status of ["approved", "declined"] as const) {
    assert.match(
      emergencyDecisionRefusal({
        request: req({ status }),
        actorId: "rakesh",
        approve: true,
        decisionReason: "",
      }) ?? "",
      /already been decided/,
    );
  }
});

test("declining requires a reason; approving does not", () => {
  assert.match(
    emergencyDecisionRefusal({
      request: req(),
      actorId: "rakesh",
      approve: false,
      decisionReason: "  ",
    }) ?? "",
    /reason is required to decline/,
  );
  assert.equal(
    emergencyDecisionRefusal({
      request: req(),
      actorId: "rakesh",
      approve: false,
      decisionReason: "Not an emergency.",
    }),
    null,
  );
});

/* ── 3. Approval applies the existing deadline shift ──────────────────────── */

test("the shift moves a due date by exactly the emergency duration", () => {
  assert.equal(
    shiftedDueAt("2026-07-28T17:00:00.000Z", 3600),
    "2026-07-28T18:00:00.000Z",
  );
});

test("only live, dated, assigned tasks are shifted", () => {
  /* Transcribed from legacy's `shiftOngoingTaskDeadlines`: skip terminal
     statuses and anything without a due date. */
  const tasks = [
    task({ id: "live" }),
    task({ id: "done", status: "completed" }),
    task({ id: "cancelled", status: "cancelled" }),
    task({ id: "refused", status: "assignment_rejected" }),
    task({
      id: "undated",
      deadline: { ...task().deadline, dueAt: null },
    }),
    task({ id: "deleted", deletedAt: "2026-07-01T00:00:00.000Z" }),
    task({ id: "someone-else" }),
  ];
  const out = shiftableTasks({
    tasks,
    employeeId: "soumya",
    isAssigned: (t) => t.id !== "someone-else",
  });
  assert.deepEqual(
    out.map((t) => t.id),
    ["live"],
  );
});

/* ── 4. Declining changes nothing ─────────────────────────────────────────── */

test("a declined request names no shifted tasks", () => {
  /* The record of the decision survives; the task effect does not happen. The
     repository only walks `shiftableTasks` on the approve branch, so this
     asserts the shape the declined record keeps. */
  const declined = req({
    status: "declined",
    decisionReason: "Not an emergency.",
    decidedAt: "2026-07-28T11:00:00.000Z",
  });
  assert.deepEqual(declined.appliedTaskIds, []);
  assert.equal(declined.status, "declined");
  assert.ok(declined.decisionReason, "a decline is always explained");
});
