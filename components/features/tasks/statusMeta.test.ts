import assert from "node:assert/strict";
import { test } from "node:test";
import { nextAction, windowOnOffer } from "./statusMeta.ts";
import type { Approval } from "../../../lib/domain/index.ts";
import type { TaskView } from "../../../lib/repositories/types.ts";

/**
 * What a pending task tells the person who raised it.
 *
 * The behaviour under test is a transparency one, and it is easy to regress
 * without noticing: every one of these cases used to render the identical
 * string "Awaiting approval". That is true of every pending task in the
 * product, so it told the creator nothing they could act on — not who to chase,
 * not how far through the chain the work had got. Both facts were already in
 * the approval records; only the label withheld them.
 *
 * These build the view by hand rather than through the repository, which cannot
 * be imported here — its `@/` aliases do not resolve under type stripping. What
 * matters is the mapping from records to words, and that is all this file
 * touches.
 */

function approval(over: Partial<Approval>): Approval {
  return {
    id: "ap-1",
    taskId: "t-1",
    submissionId: null,
    kind: "cross_department",
    stage: 1,
    side: null,
    approverId: "e-05",
    approverName: "Hanne Vermeer",
    decision: "pending",
    reason: null,
    decidedAt: null,
    ...over,
  };
}

function view(approvals: Approval[]): TaskView {
  return {
    task: { id: "t-1", status: "pending_approval" },
    assignments: [],
    approvals,
    pendingApprovals: approvals.filter((a) => a.decision === "pending"),
  } as unknown as TaskView;
}

test("a pending task names the decision outstanding and who owes it", () => {
  const action = nextAction(
    view([
      approval({
        id: "a1",
        stage: 1,
        side: "sender",
        approverName: "Maya Ferreira",
      }),
      approval({
        id: "a2",
        stage: 2,
        side: "receiver",
        approverId: "e-03",
        approverName: "Renata Alves",
        decision: "waiting",
      }),
    ]),
    "e-02",
  );
  assert.equal(action.label, "Awaiting department approval from Maya Ferreira");
  assert.equal(action.actor, "them");
});

test("the stage advances as approvals land", () => {
  const action = nextAction(
    view([
      approval({
        id: "a1",
        stage: 1,
        approverName: "Maya Ferreira",
        decision: "approved",
      }),
      approval({
        id: "a2",
        stage: 2,
        approverName: "Renata Alves",
        decision: "pending",
      }),
    ]),
    "e-02",
  );
  assert.equal(action.label, "Awaiting department approval from Renata Alves");
});

test("each kind of decision is named in the reader's terms", () => {
  /* The position in the chain is not the interesting fact — which decision is
     outstanding is. "2 of 2" read as though one person were asked twice. */
  const kinds: [Approval["kind"], string][] = [
    ["assignment", "Awaiting acceptance from Maya Ferreira"],
        /* Reworded deliberately: "effort estimate" is the engine's term for what
       the reader experiences as a time budget, and this stage is what holds a
       cross-department task after both approvals have cleared. */
    ["effort_estimate", "Awaiting a time budget from Maya Ferreira"],
    ["self_assignment", "Awaiting sign-off from Maya Ferreira"],
  ];
  for (const [kind, expected] of kinds) {
    const action = nextAction(
      view([approval({ kind, approverName: "Maya Ferreira" })]),
      "e-02",
    );
    assert.equal(action.label, expected);
  }
});

test("the approver is asked to act, not told to wait", () => {
  const action = nextAction(
    view([approval({ approverId: "e-01", approverName: "Maya Ferreira" })]),
    "e-01",
  );
  assert.equal(action.actor, "you");
  assert.equal(action.label, "Approve or reject");
});

test("a task with no approval records still says something true", () => {
  /* Defensive: a pending task whose records have not been written must not
     render "Awaiting undefined". */
  const action = nextAction(view([]), "e-02");
  assert.equal(action.label, "Awaiting approval");
});

/* ── The offered window outranks "propose your own" ───────────────────────── */

/**
 * U1. The defect was precedence, not wording.
 *
 * `nextAction` reached its `state === "unset"` branch before it ever checked
 * whether a window had been offered, so a receiver whose manager had proposed
 * four hours was told "Propose a deadline" in every list, board card and
 * dashboard tile — while the task itself offered "Accept 4h / Not enough time".
 * The product named the second step and hid the first.
 *
 * Legacy's order (`page.js:8818`): the card tests `senderSecs > 0 &&
 * !senderTimerRejected` FIRST, and "Propose your own duration" appears only
 * when there is no offer or the offer was refused.
 */

function budgetTask(over: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    type: "standard",
    status: "assigned",
    deadline: {
      mode: "timer",
      dueAt: null,
      currentWindowSecs: 4 * 3600,
      assignorWindowRejection: null,
      state: "unset",
      ...((over.deadline as object) ?? {}),
    },
    ...over,
  };
}

function assignedView(task: unknown, assigneeId: string) {
  return {
    task,
    assignments: [{ employeeId: assigneeId }],
    approvals: [],
    pendingApprovals: [],
  } as unknown as Parameters<typeof nextAction>[0];
}

test("an offered window is what the assignee is told to do", () => {
  const action = nextAction(assignedView(budgetTask(), "e-02"), "e-02");
  assert.equal(action.label, "Accept or discuss the time");
  assert.equal(action.actor, "you");
  assert.match(
    action.href ?? "",
    /^\/tasks\/t-1$/,
    "points at the task, not the deadline tab",
  );
});

test("the assignor is told who it is waiting on", () => {
  const action = nextAction(assignedView(budgetTask(), "e-02"), "e-01");
  assert.equal(action.label, "Awaiting the assignee");
  assert.equal(action.actor, "them");
});

test("once refused, the assignee is asked to propose their own", () => {
  /* Legacy's fallback exactly: the offer is gone, so proposing is now the
     step. Status is untouched by the refusal, which is why this cannot key on
     status alone. */
  const task = budgetTask({
    deadline: {
      mode: "timer",
      dueAt: null,
      currentWindowSecs: 4 * 3600,
      state: "unset",
      assignorWindowRejection: {
        byId: "e-02",
        byName: "Tobias",
        reason: "not enough",
        at: "2026-07-27T00:00:00.000Z",
      },
    },
  });
  assert.equal(windowOnOffer(task as never), false);
  assert.equal(
    nextAction(assignedView(task, "e-02"), "e-02").label,
    "Propose a deadline",
  );
});

test("a fixed-deadline task never offers a window", () => {
  const task = budgetTask({
    deadline: {
      mode: "fixed",
      dueAt: null,
      currentWindowSecs: 0,
      state: "unset",
      assignorWindowRejection: null,
    },
  });
  assert.equal(windowOnOffer(task as never), false);
});

test("a self-assigned task never offers a window", () => {
  /* Legacy: `!task.isSelfAssigned`. You do not negotiate with yourself. */
  assert.equal(
    windowOnOffer(budgetTask({ type: "self_assigned" }) as never),
    false,
  );
});

test("an accepted window stops being an offer", () => {
  const task = budgetTask({
    deadline: {
      mode: "timer",
      dueAt: "2026-08-01T12:00:00.000Z",
      currentWindowSecs: 4 * 3600,
      state: "agreed",
      assignorWindowRejection: null,
    },
  });
  assert.equal(windowOnOffer(task as never), false);
  assert.equal(
    nextAction(assignedView(task, "e-02"), "e-02").label,
    "Confirm receipt",
    "the next step after agreeing the time is confirming the task",
  );
});

/* ── Approver visibility ──────────────────────────────────────────────────── */

/**
 * "When Maya is the required cross-department approver, Maya must see the
 * approval request before the receiver gets access."
 *
 * The defect: `listTasks({ scope: "all" })` narrows, for anyone without
 * organisation-scoped `task.view`, to tasks assigned to them, in their
 * hierarchy, or created by them. A cross-department task is none of those for
 * its approver — and because the assignee is deliberately held back until the
 * chain clears, it has no assignment rows to reach anyone through either. So
 * the request was raised, the approver was notified, and the task was invisible
 * to them everywhere.
 *
 * The repository cannot be imported here (its `@/` aliases do not resolve under
 * type stripping), so this pins the ORDERING rule the fix restores: a viewer
 * holding a pending approval is a viewer with standing to see the task, and
 * that standing arrives before the assignee's does.
 */

function crossDeptView(over: Record<string, unknown> = {}) {
  return {
    task: { id: "t-1", status: "pending_approval", type: "standard" },
    /* No assignment rows: the receiver is held back until the chain clears. */
    assignments: [],
    pendingAssignees: [{ id: "e-02", displayName: "Tobias Lund" }],
    approvals: [
      {
        id: "ap-1",
        approverId: "e-01",
        approverName: "Maya Ferreira",
        decision: "pending",
        kind: "cross_department",
        side: "receiver",
        stage: 1,
      },
    ],
    pendingApprovals: [
      {
        id: "ap-1",
        approverId: "e-01",
        approverName: "Maya Ferreira",
        decision: "pending",
        kind: "cross_department",
        side: "receiver",
        stage: 1,
      },
    ],
    ...over,
  } as unknown as Parameters<typeof nextAction>[0];
}

test("the required approver is asked to act, before anyone is assigned", () => {
  const action = nextAction(crossDeptView(), "e-01");
  assert.equal(action.actor, "you");
  assert.equal(action.label, "Approve or reject");
});

test("the held-back receiver has no action while the chain is open", () => {
  /* Tobias is in `pendingAssignees`, not `assignments` — he must not be told to
     confirm, start or accept a window on work two departments have not agreed
     to send him. */
  const action = nextAction(crossDeptView(), "e-02");
  assert.notEqual(action.actor, "you");
});

test("the creator is told who it is waiting on, and cannot act", () => {
  const action = nextAction(crossDeptView(), "e-05");
  assert.equal(action.actor, "them");
  assert.equal(
    action.label,
    "Awaiting department approval from Maya Ferreira",
  );
});

/* ── Presence ─────────────────────────────────────────────────────────────── */

/**
 * The offline restriction, at the "your move" layer.
 *
 * Ported from `app/coworking/tasks/page.js:8571`, where the whole action banner
 * is replaced while the assignee is away. The reason it belongs in `nextAction`
 * rather than only in the banner is the `actor` field: it feeds "Needs action"
 * counts and the dashboard's your-move lists, and a person on a two-hour
 * emergency should not accrue a growing pile of things the product insists are
 * waiting on them and would then refuse to let them do.
 */

function presenceView(status: string, viewerId: string): TaskView {
  return {
    task: {
      id: "t-9",
      status,
      deadline: { state: "agreed", dueAt: "2026-08-01T00:00:00.000Z", mode: "fixed" },
      createdById: "e-99",
      type: "assigned",
    },
    assignments: [{ employeeId: viewerId }],
    approvals: [],
    pendingApprovals: [],
    isBlocked: false,
    reworkCount: 0,
  } as unknown as TaskView;
}

test("an unknown presence changes nothing — unknown is not away", () => {
  /* The default. Every existing caller passes no mode at all, and must keep
     behaving exactly as it did. */
  const v = presenceView("in_progress", "e-01");
  assert.deepEqual(nextAction(v, "e-01"), nextAction(v, "e-01", null));
  assert.equal(nextAction(v, "e-01").actor, "you");
});

test("being online is the only mode that leaves the action alone", () => {
  const v = presenceView("in_progress", "e-01");
  assert.equal(nextAction(v, "e-01", "online").label, "Submit when ready");
  assert.equal(nextAction(v, "e-01", "online").actor, "you");
});

test("away from your own work, it stops being your move", () => {
  /* `actor` is the load-bearing part, not the label — it is what keeps the task
     out of the counts while somebody is away. */
  const v = presenceView("in_progress", "e-01");
  for (const mode of ["offline", "break", "emergency"] as const) {
    const action = nextAction(v, "e-01", mode);
    assert.equal(action.actor, "them", `${mode} still reads as your move`);
    assert.equal(action.href, undefined, `${mode} still offers a way to act`);
  }
});

test("the refusal outranks whatever the task would otherwise ask", () => {
  /* Legacy replaces the whole banner rather than editing the label inside it,
     so it does not matter what stage the work is at — confirm, start, submit —
     the answer while you are away is the same sentence. */
  for (const status of ["assigned", "confirmed", "in_progress"]) {
    const action = nextAction(presenceView(status, "e-01"), "e-01", "offline");
    assert.match(action.label, /Offline/);
  }
});

test("somebody else's task is unaffected by MY presence", () => {
  /* `isAssignee &&` in legacy's condition. A manager reviewing a submission
     while offline is not blocked, and blocking them would stall other people's
     work every time a reviewer stepped away from their desk. */
  const theirs = presenceView("in_progress", "e-02");
  assert.equal(nextAction(theirs, "e-01", "offline").label, "In progress");
});

test("a closed task is not reopened as a presence problem", () => {
  /* Nothing is asked of anybody on a completed task, and "go online to
     continue" against finished work would be a false instruction. */
  const done = presenceView("completed", "e-01");
  assert.equal(nextAction(done, "e-01", "offline").label, "Complete");
  assert.equal(nextAction(done, "e-01", "offline").actor, "nobody");
});
