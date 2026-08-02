import assert from "node:assert/strict";
import { test } from "node:test";
import { toTaskView } from "./taskMap.ts";
import type { Employee } from "../../domain/index.ts";
import { ROLE_MANAGER } from "../../auth/systemRoles.ts";

/**
 * Who may put a budget on a task waiting for one.
 *
 * **The assignee's manager, and nobody else.** Department plays no part: a
 * department approval answers "may this cross-department work happen at all",
 * and a time budget answers "how many hours does this person get for it". Only
 * the second is a decision about an individual's work, so it follows the
 * reporting line — `department-tl-set-hours` now refuses anyone but
 * `_getPrimaryManagerApprover(assignee)`.
 *
 * These drive the real mapper rather than reading its source, because the fault
 * being pinned is which approvals come out of it.
 */

function employee(
  over: Partial<Employee> & { id: string; isTeamLead?: boolean },
): Employee {
  return {
    displayName: `Person ${over.id}`,
    departmentId: null,
    departmentName: null,
    /* A directory record gains ROLE_MANAGER from `directoryRoleIdsFor`, which
       is built with `hasDirectReports: false` — so on these records the role
       means legacy `role === "tl"` and nothing else. */
    roleIds: over.isTeamLead ? [ROLE_MANAGER] : [],
    ...over,
  } as Employee;
}

const DESIGN = "design";
const IT = "it";

/** The assignee, their department's TL, a TL elsewhere, and a non-TL colleague. */
const PEOPLE = new Map<string, Employee>([
  ["ASSIGNEE", employee({ id: "ASSIGNEE", departmentId: DESIGN })],
  ["DESIGN_TL", employee({ id: "DESIGN_TL", departmentId: DESIGN, isTeamLead: true })],
  ["IT_TL", employee({ id: "IT_TL", departmentId: IT, isTeamLead: true })],
  ["DESIGN_PEER", employee({ id: "DESIGN_PEER", departmentId: DESIGN })],
  ["SENDER", employee({ id: "SENDER", departmentId: IT })],
  /* A department with nobody leading it — a real situation. */
  ["NO_LEAD", employee({ id: "NO_LEAD", departmentId: "warehouse" })],
]);

function view(input: {
  status: string;
  viewerId: string;
  role?: string;
  pendingAssigneeId?: string | null;
  assigneeIds?: string[];
  approvals?: { approverId: string; side: string; status: string }[];
  /** The assignee's manager, as the repository resolves them. */
  budgetOwner?: string | null;
}) {
  const legacy = {
    id: "T900",
    title: "vb",
    status: input.status,
    reviewState: "unknown",
    isTerminal: false,
    assigneeIds: input.assigneeIds ?? [],
    pendingAssigneeId: input.pendingAssigneeId ?? null,
    createdById: "SENDER",
    priority: null,
    order: null,
    createdAtMs: 0,
    assigneePriorities: {},
    confirmedByIds: [],
    departmentApprovals: (input.approvals ?? []).map((a) => ({
      approverId: a.approverId,
      approverName: a.approverId,
      side: a.side,
      status: a.status,
      respondedAt: null,
      rejectionReason: null,
    })),
    departmentApproverIds: [],
    requirements: [],
    tags: [],
    senderWindowSecs: 0,
    agreedWindowSecs: null,
    startedAtMs: null,
    dueAtMs: null,
    /* `toTaskView` reads `.length` off this unguarded, and it is right to:
       `readLegacyTask` normalises an absent `subtaskIds` to `[]`, so the real
       path can never hand it undefined. This fixture bypasses that reader and
       casts `as never`, which is what stopped the type checker saying so. */
    subtaskIds: [],
  };
  return toTaskView({
    legacy: legacy as never,
    employeesById: PEOPLE,
    viewerId: input.viewerId,
    nowMs: 0,
    viewerLegacyRole: input.role ?? "employee",
    budgetOwner: input.budgetOwner ? (PEOPLE.get(input.budgetOwner) ?? null) : null,
  });
}

const budgetOf = (v: ReturnType<typeof view>) =>
  v.pendingApprovals.filter((a) => a.kind === "effort_estimate");

/* ── 1 · Cross-department ─────────────────────────────────────────────────── */

test("a cross-department task at the budget stage offers it to the assignee's manager", () => {
  /* T631's shape: both approvals cleared, the person still parked in
     `pendingAssigneeId`, nothing assigned until hours arrive. */
  const v = view({
    status: "pending_tl_hours",
    viewerId: "DESIGN_TL",
    pendingAssigneeId: "ASSIGNEE",
    budgetOwner: "DESIGN_TL",
    approvals: [
      { approverId: "SENDER", side: "sender", status: "approved" },
      { approverId: "IT_TL", side: "receiver", status: "approved" },
    ],
  });
  const budget = budgetOf(v);
  assert.equal(budget.length, 1);
  assert.equal(budget[0].approverId, "DESIGN_TL");
  assert.equal(budget[0].id, "T900#effort-estimate");
});

test("clearing the receiving gate does not confer the budget", () => {
  /* The previous model handed it to whoever led the receiving department. They
     answer "may this work happen", which is a different question from "how many
     hours does this person get" and is often a different person. */
  const v = view({
    status: "pending_tl_hours",
    viewerId: "IT_TL",
    pendingAssigneeId: "ASSIGNEE",
    budgetOwner: "DESIGN_TL",
    approvals: [{ approverId: "IT_TL", side: "receiver", status: "approved" }],
  });
  assert.equal(budgetOf(v).length, 0);
});

/* ── 2 · Same department / no gate ────────────────────────────────────────── */

test("a same-department task uses exactly the same rule", () => {
  /* No approvals at all. Department never enters the test, so there is nothing
     for a same-department task to take a different path through. */
  const v = view({
    status: "pending_tl_hours",
    viewerId: "DESIGN_TL",
    assigneeIds: ["ASSIGNEE"],
    budgetOwner: "DESIGN_TL",
    approvals: [],
  });
  assert.equal(budgetOf(v).length, 1);
});

test("a manager in another department is still the right person", () => {
  /* The point of the change. `SENDER` sits in IT and manages an assignee in
     Designing; the department model refused them and the reporting model does
     not, because they are who manages the person doing the work. */
  const v = view({
    status: "pending_tl_hours",
    viewerId: "SENDER",
    pendingAssigneeId: "ASSIGNEE",
    budgetOwner: "SENDER",
  });
  assert.equal(budgetOf(v).length, 1);
  assert.equal(budgetOf(v)[0].approverId, "SENDER");
});

/* ── 3 · Wrong user ───────────────────────────────────────────────────────── */

test("a department lead who does not manage the assignee is refused", () => {
  const v = view({
    status: "pending_tl_hours",
    viewerId: "IT_TL",
    pendingAssigneeId: "ASSIGNEE",
    budgetOwner: "DESIGN_TL",
  });
  assert.equal(budgetOf(v).length, 0);
});

test("a colleague is refused", () => {
  const v = view({
    status: "pending_tl_hours",
    viewerId: "DESIGN_PEER",
    pendingAssigneeId: "ASSIGNEE",
    budgetOwner: "DESIGN_TL",
  });
  assert.equal(budgetOf(v).length, 0);
});

test("the assignee cannot set their own budget unless they manage themselves", () => {
  const v = view({
    status: "pending_tl_hours",
    viewerId: "ASSIGNEE",
    pendingAssigneeId: "ASSIGNEE",
    budgetOwner: "DESIGN_TL",
  });
  assert.equal(budgetOf(v).length, 0);
});

test("an assignee with no manager recorded leaves nobody able to act", () => {
  /* Honest dead end rather than a fallback: the endpoint refuses everybody in
     this state, so offering the form to anyone would be a lie. */
  const v = view({
    status: "pending_tl_hours",
    viewerId: "DESIGN_TL",
    pendingAssigneeId: "ASSIGNEE",
    budgetOwner: null,
  });
  assert.equal(budgetOf(v).length, 0);
  assert.equal(v.budgetOwner, null);
});

/* ── 4 · The correct user gets an actionable stage ────────────────────────── */

test("the offered stage is an effort estimate, not an approve or reject", () => {
  const v = view({
    status: "pending_tl_hours",
    viewerId: "DESIGN_TL",
    pendingAssigneeId: "ASSIGNEE",
    budgetOwner: "DESIGN_TL",
  });
  const [budget] = budgetOf(v);
  assert.equal(budget.kind, "effort_estimate");
  assert.equal(budget.decision, "pending");
  assert.equal(v.pendingApprovals.every((a) => a.kind !== "cross_department"), true);
});

test("the manager is named to viewers who cannot act", () => {
  /* So the timeline says who to chase instead of showing an anonymous step. */
  const v = view({
    status: "pending_tl_hours",
    viewerId: "DESIGN_PEER",
    pendingAssigneeId: "ASSIGNEE",
    budgetOwner: "DESIGN_TL",
  });
  assert.equal(budgetOf(v).length, 0);
  assert.equal(v.budgetOwner?.id, "DESIGN_TL");
});

test("the assignee is still held while the budget is outstanding", () => {
  const v = view({
    status: "pending_tl_hours",
    viewerId: "DESIGN_TL",
    pendingAssigneeId: "ASSIGNEE",
    assigneeIds: [],
    budgetOwner: "DESIGN_TL",
  });
  assert.equal(v.task.status, "pending_approval");
  assert.deepEqual(v.task.pendingAssigneeIds, ["ASSIGNEE"]);
  assert.equal(v.assignees.length, 0);
});

/* ── 5 · Everything else is untouched ─────────────────────────────────────── */

test("a task with a timer never reaches the budget stage", () => {
  for (const status of ["open", "in_progress", "done", "pending_department_approval"]) {
    const v = view({
      status, viewerId: "DESIGN_TL", assigneeIds: ["ASSIGNEE"],
      budgetOwner: "DESIGN_TL",
    });
    assert.equal(budgetOf(v).length, 0, `${status} produced a budget stage`);
  }
});

test("an open department gate still offers its own approval and no budget", () => {
  /* Department approval is untouched by any of this. */
  const v = view({
    status: "pending_department_approval",
    viewerId: "IT_TL",
    pendingAssigneeId: "ASSIGNEE",
    approvals: [
      { approverId: "IT_TL", side: "sender", status: "pending" },
      { approverId: "DESIGN_TL", side: "receiver", status: "waiting" },
    ],
  });
  assert.equal(v.pendingApprovals.length, 1);
  assert.equal(v.pendingApprovals[0].kind, "cross_department");
  assert.equal(v.pendingApprovals[0].approverId, "IT_TL");
});
