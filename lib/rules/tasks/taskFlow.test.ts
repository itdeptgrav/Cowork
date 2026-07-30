import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { taskFlow } from "./taskFlow.ts";
import type { Approval, Task } from "../../domain/index.ts";

/**
 * Where a task is, and whose turn it is.
 *
 * The fault these pin: a cross-department task showed "Pending approval" and
 * nothing else, while the task record already held who was deciding, which side
 * they were on, who had cleared and who was next. This turns that state into a
 * sequence. It decides nothing — every assertion below is about what is SHOWN.
 *
 * The gated fixture is the shape of a real held task (T629): empty
 * `assigneeIds`, the target parked in `pendingAssigneeId`, and a two-entry gate
 * with the receiver `waiting` behind the sender.
 */

function task(over: Partial<Task> = {}): Task {
  return {
    id: "T629",
    title: "vb",
    status: "pending_approval",
    createdById: "GR0000",
    createdAt: "2026-07-29T10:30:00.000Z",
    pendingAssigneeIds: [],
    ...over,
  } as Task;
}

function approval(over: Partial<Approval> = {}): Approval {
  return {
    id: "T629#approval-0",
    taskId: "T629",
    submissionId: null,
    kind: "assignment",
    stage: 0,
    side: "sender",
    approverId: "GR0000",
    approverName: "Rishee Ray",
    decision: "pending",
    reason: null,
    decidedAt: null,
    ...over,
  } as Approval;
}

const NAMES: Record<string, string> = {
  GR0000: "Rishee Ray",
  GR0004: "Nabin Kumar",
  GR0081: "Priya Sharma",
};
const nameOf = (id: string) => NAMES[id] ?? null;

/** The real held task. */
const GATED = {
  task: task({ pendingAssigneeIds: ["GR0004"] }),
  assigneeIds: [],
  approvals: [
    approval({ stage: 0, side: "sender", approverId: "GR0000", decision: "pending" }),
    approval({
      id: "T629#approval-1", stage: 1, side: "receiver",
      approverId: "GR0081", approverName: "Priya Sharma", decision: "waiting",
    }),
  ],
  nameOf,
};

/* ── The three questions ──────────────────────────────────────────────────── */

test("a held task names whose turn it is", () => {
  /* The whole point. "Pending approval" does not say this and the data did. */
  assert.equal(taskFlow(GATED).whoseTurn, "Rishee Ray");
});

test("it says what happens after that approval", () => {
  const flow = taskFlow(GATED);
  assert.match(flow.whatNext, /Priya Sharma/);
});

test("it says why it is waiting, in terms of the reason for the gate", () => {
  const why = taskFlow(GATED).whyWaiting;
  assert.ok(why);
  assert.match(why, /crossing departments/i);
  assert.match(why, /Rishee Ray/);
});

/* ── The sequence ─────────────────────────────────────────────────────────── */

test("the flow reads created → approve → approve → assignment", () => {
  const stages = taskFlow(GATED).stages;
  assert.deepEqual(
    stages.map((s) => s.key),
    ["created", "approval-0", "approval-1", "assignment"],
  );
  assert.deepEqual(
    stages.map((s) => s.state),
    ["done", "current", "upcoming", "upcoming"],
  );
});

test("the eventual assignee is named on the flow before they own it", () => {
  /* They are who the work is FOR — a diagram that ends at "approval" hides the
     point of the task. */
  const assignment = taskFlow(GATED).stages.at(-1)!;
  assert.equal(assignment.person, "Nabin Kumar");
  assert.equal(assignment.note, "Starts after approval");
  assert.equal(assignment.state, "upcoming", "not theirs until the gate clears");
});

test("a waiting approver is not shown as owing an action", () => {
  /* `waiting` and `pending` are different stages. Collapsing them would send
     two people to a screen where only one has a button. */
  const stages = taskFlow(GATED).stages;
  assert.equal(stages.filter((s) => s.state === "current").length, 1);
  assert.match(stages[2].note!, /previous approval/i);
});

test("the sending and receiving sides are labelled", () => {
  const stages = taskFlow(GATED).stages;
  assert.equal(stages[1].role, "Sending department");
  assert.equal(stages[2].role, "Receiving department");
});

test("stages follow the engine's order, not a sort of our own", () => {
  /* The engine's sequence IS the array order — sender clears, which flips the
     receiver from waiting to pending. Re-ordering would invent a sequence. */
  const flipped = taskFlow({ ...GATED, approvals: [...GATED.approvals].reverse() });
  assert.deepEqual(
    flipped.stages.map((s) => s.key),
    ["created", "approval-0", "approval-1", "assignment"],
  );
});

/* ── Honesty where the data is silent ─────────────────────────────────────── */

test("a gate with no recorded approvers says so rather than naming a guess", () => {
  /* The instruction: show "Waiting for department approval" instead of
     guessing. A wrong name on a workflow diagram sends somebody to ask the
     wrong person. */
  const flow = taskFlow({
    task: task({ pendingAssigneeIds: ["GR0004"] }),
    approvals: [],
    assigneeIds: [],
    nameOf,
  });
  const stage = flow.stages[1];
  assert.equal(stage.label, "Waiting for department approval");
  assert.equal(stage.person, null);
  assert.equal(flow.whoseTurn, null);
  assert.match(flow.whyWaiting!, /crossing departments/i);
});

test("an unresolvable approver falls back to their side, never a raw id", () => {
  /* "GR0081" on a diagram tells a reader nothing and reads as a bug. */
  const flow = taskFlow({
    ...GATED,
    nameOf: () => null,
  });
  const text = JSON.stringify(flow);
  assert.equal(/GR00\d\d/.test(text), false, "a raw employee id reached the UI");
});

/* ── The other states ─────────────────────────────────────────────────────── */

test("an in-progress task names its owner and the next step", () => {
  const flow = taskFlow({
    task: task({ status: "in_progress" }),
    approvals: [],
    assigneeIds: ["GR0004"],
    nameOf,
  });
  assert.equal(flow.whoseTurn, "Nabin Kumar");
  assert.match(flow.whatNext, /review/i);
  assert.equal(flow.whyWaiting, null, "work in progress is not waiting");
});

test("a task in review says what the reviewer can do", () => {
  const flow = taskFlow({
    task: task({ status: "in_review" }),
    approvals: [],
    assigneeIds: ["GR0004"],
    nameOf,
  });
  const review = flow.stages.find((s) => s.key === "review")!;
  assert.equal(review.state, "current");
  assert.match(review.note!, /Approve/);
  assert.match(flow.whyWaiting!, /waiting for a reviewer/i);
});

test("a reviewer is left unnamed rather than guessed from the reporting tree", () => {
  /* The chain resolves the reviewer at the point of action; it is not on the
     task record. Naming one here would be a guess. */
  const flow = taskFlow({
    task: task({ status: "in_review" }),
    approvals: [],
    assigneeIds: ["GR0004"],
    nameOf,
  });
  assert.equal(flow.stages.find((s) => s.key === "review")!.person, null);
});

test("a completed task shows the whole journey and asks nothing of anybody", () => {
  const flow = taskFlow({
    task: task({ status: "completed" }),
    approvals: [],
    assigneeIds: ["GR0004"],
    completedAt: "2026-07-29T18:00:00.000Z",
    nameOf,
  });
  assert.equal(flow.whoseTurn, null);
  assert.match(flow.whatNext, /complete/i);
  assert.equal(flow.stages.every((s) => s.state === "done"), true);
  assert.equal(flow.stages.at(-1)!.at, "2026-07-29T18:00:00.000Z");
});

test("an assigned task is waiting on acceptance, and says which", () => {
  const flow = taskFlow({
    task: task({ status: "assigned" }),
    approvals: [],
    assigneeIds: ["GR0004"],
    nameOf,
  });
  assert.equal(flow.whoseTurn, "Nabin Kumar");
  assert.match(flow.whyWaiting!, /not accepted/i);
});

test("a refusal stops the flow instead of showing steps that will not happen", () => {
  const flow = taskFlow({
    task: task({ pendingAssigneeIds: ["GR0004"] }),
    assigneeIds: [],
    approvals: [
      approval({ decision: "approved", decidedAt: "2026-07-29T11:00:00.000Z" }),
      approval({
        id: "T629#approval-1", stage: 1, side: "receiver", approverId: "GR0081",
        decision: "rejected", reason: "Team has no capacity this sprint",
      }),
    ],
    nameOf,
  });
  assert.equal(flow.whoseTurn, null, "a refused task owes nobody an action");
  assert.equal(flow.whyWaiting, "Team has no capacity this sprint");
  assert.equal(
    flow.stages.some((s) => s.state === "current"),
    false,
    "a step after a refusal implies it will still happen",
  );
});

test("a cancelled task keeps its history and drops its future", () => {
  const flow = taskFlow({
    task: task({ status: "cancelled" }),
    approvals: [],
    assigneeIds: ["GR0004"],
    nameOf,
  });
  assert.equal(flow.stages.at(-1)!.label, "Cancelled");
  assert.equal(flow.stages.some((s) => s.state === "upcoming"), false);
  assert.equal(flow.whoseTurn, null);
});

/* ── Boundaries ───────────────────────────────────────────────────────────── */

test("exactly one stage is ever current", () => {
  /* Two "action required" markers means nobody knows whose turn it is, which is
     the fault this module exists to fix. */
  for (const status of [
    "pending_approval", "assigned", "confirmed", "in_progress",
    "in_review", "completed", "deadline_negotiation",
  ] as const) {
    const flow = taskFlow({
      task: task({ status }),
      approvals: [],
      assigneeIds: ["GR0004"],
      nameOf,
    });
    assert.ok(
      flow.stages.filter((s) => s.state === "current").length <= 1,
      `${status} has more than one current stage`,
    );
  }
});

test("what happens next is always answered", () => {
  for (const status of [
    "pending_approval", "assigned", "in_progress", "in_review",
    "completed", "cancelled", "assignment_rejected",
  ] as const) {
    const flow = taskFlow({
      task: task({ status }),
      approvals: [],
      assigneeIds: ["GR0004"],
      nameOf,
    });
    assert.ok(flow.whatNext.length > 0, `${status} does not say what is next`);
  }
});

test("no stage text exposes a field name or a status code", () => {
  /* It should read as a workflow, not a row from a database. */
  const flows = [
    taskFlow(GATED),
    taskFlow({ task: task({ status: "in_review" }), approvals: [], assigneeIds: ["GR0004"], nameOf }),
  ];
  for (const flow of flows) {
    for (const stage of flow.stages) {
      for (const jargon of ["_id", "assigneeIds", "pending_", "in_progress", "null"]) {
        assert.equal(
          `${stage.label} ${stage.note ?? ""}`.includes(jargon),
          false,
          `"${stage.label}" exposes "${jargon}"`,
        );
      }
    }
  }
});

test("this module mutates nothing and calls no repository", () => {
  /* The hard boundary: it explains the workflow, and must never advance it.
     Comments are stripped first — this file's own prose names these things. */
  const src = readFileSync("lib/rules/tasks/taskFlow.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/repositor/i.test(src), false, "presentation reached a repository");
  assert.equal(/\bawait\b/.test(src), false, "a workflow explanation should be pure");
  /* Matched as CALLS. A bare search for "approve" hits `decision === "approved"`,
     which is a read of the engine's outcome and exactly what this module is for
     — the third time this session that a substring matched the thing it was
     meant to permit. */
  for (const call of ["setDoc(", "updateDoc(", "addDoc(", "approve(", "reject(", "fetch("]) {
    assert.equal(src.includes(call), false, `it performs "${call}"`);
  }
});

/* ── The review stage ─────────────────────────────────────────────────────── */

test("a review names the reviewer and which stage of how many", () => {
  /* From the submission's recorded chain — the only place the sequence exists. */
  const flow = taskFlow({
    task: task({ status: "in_review" }),
    approvals: [],
    assigneeIds: ["GR0004"],
    review: { chain: ["GR0000", "GR0081"], currentStage: 0 },
    nameOf,
  });
  const review = flow.stages.find((s) => s.key === "review")!;
  assert.equal(review.person, "Rishee Ray");
  assert.equal(review.role, "Stage 1 of 2");
  assert.equal(flow.whoseTurn, "Rishee Ray");
});

test("a second-stage review points at the second reviewer, not the first", () => {
  const flow = taskFlow({
    task: task({ status: "in_review" }),
    approvals: [],
    assigneeIds: ["GR0004"],
    review: { chain: ["GR0000", "GR0081"], currentStage: 1 },
    nameOf,
  });
  const review = flow.stages.find((s) => s.key === "review")!;
  assert.equal(review.person, "Priya Sharma");
  assert.equal(review.role, "Stage 2 of 2");
});

test("a single-reviewer chain shows no stage count", () => {
  /* "Stage 1 of 1" is noise dressed as information. */
  const flow = taskFlow({
    task: task({ status: "in_review" }),
    approvals: [],
    assigneeIds: ["GR0004"],
    review: { chain: ["GR0000"], currentStage: 0 },
    nameOf,
  });
  assert.equal(flow.stages.find((s) => s.key === "review")!.role, null);
});

test("no recorded chain leaves the reviewer unnamed rather than guessed", () => {
  /* The legacy read path does not populate the submission today, so this is
     the production case — and the reporting tree is how a chain is BUILT, not
     evidence of who it named on this task. */
  const flow = taskFlow({
    task: task({ status: "in_review" }),
    approvals: [],
    assigneeIds: ["GR0004"],
    review: null,
    nameOf,
  });
  const review = flow.stages.find((s) => s.key === "review")!;
  assert.equal(review.person, null);
  assert.equal(review.role, null);
  assert.match(review.note!, /Approve/);
});

/* ── The budget stage ─────────────────────────────────────────────────────── */

test("a task waiting on its budget says so, even to somebody who cannot act", () => {
  /* `pendingApprovals` names only the person who may act, so everyone else
     would otherwise see a task held for no stated reason. `approvalReason` is
     viewer-independent and is what carries it. */
  const flow = taskFlow({
    task: task({
      status: "pending_approval",
      pendingAssigneeIds: ["GR0004"],
      approvalReason: "effort_estimate",
    } as never),
    approvals: [
      approval({ decision: "approved" }),
      approval({ id: "x", stage: 1, side: "receiver", decision: "approved" }),
    ],
    assigneeIds: [],
    nameOf,
  });
  const budget = flow.stages.find((s) => s.key === "budget");
  assert.ok(budget, "no budget stage");
  assert.equal(budget.state, "current");
  assert.equal(
    budget.person,
    null,
    "no owner was supplied and none is recorded, so nobody is named",
  );
  /* With no team lead resolvable, the honest answer is that nobody can act —
     not a vague wait. */
  assert.match(flow.whyWaiting!, /no manager recorded/i);
});

test("the budget stage names the person when they are the one who can act", () => {
  const flow = taskFlow({
    task: task({
      status: "pending_approval",
      pendingAssigneeIds: ["GR0004"],
      approvalReason: "effort_estimate",
    } as never),
    approvals: [
      approval({ id: "e", kind: "effort_estimate", approverId: "GR0081",
                 approverName: "Priya Sharma", decision: "pending" } as never),
    ],
    assigneeIds: [],
    nameOf,
  });
  const budget = flow.stages.find((s) => s.key === "budget")!;
  assert.equal(budget.person, "Priya Sharma");
  assert.equal(budget.role, "The assignee's manager");
});

test("the assignment stage waits on the budget, not on approval", () => {
  /* Both departments have already agreed; saying "starts after approval" would
     send the reader to chase a decision that has been made. */
  const flow = taskFlow({
    task: task({
      status: "pending_approval",
      pendingAssigneeIds: ["GR0004"],
      approvalReason: "effort_estimate",
    } as never),
    approvals: [approval({ decision: "approved" })],
    assigneeIds: [],
    nameOf,
  });
  const assignment = flow.stages.find((s) => s.key === "assignment")!;
  assert.equal(assignment.note, "Starts once the budget is set");
  assert.equal(assignment.state, "upcoming");
});

test("an ordinary gated task still explains the gate, not a budget", () => {
  const flow = taskFlow(GATED);
  assert.equal(flow.stages.some((s) => s.key === "budget"), false);
  assert.match(flow.whyWaiting!, /crossing departments/i);
});

test("the budget stage names the department's lead to viewers who cannot act", () => {
  /* The reported confusion: the stage was visible with no name and no action,
     so the reader could not tell who to chase. The lead is resolved from the
     directory for every viewer, not only the one who may act. */
  const flow = taskFlow({
    task: task({
      status: "pending_approval",
      pendingAssigneeIds: ["GR0004"],
      approvalReason: "effort_estimate",
    } as never),
    approvals: [approval({ decision: "approved" })],
    assigneeIds: [],
    budgetOwnerName: "Ananta Prasad Indrajit",
    nameOf,
  });
  const budget = flow.stages.find((s) => s.key === "budget")!;
  assert.equal(budget.person, "Ananta Prasad Indrajit");
  assert.equal(flow.whoseTurn, "Ananta Prasad Indrajit");
  assert.match(flow.whyWaiting!, /Ananta Prasad Indrajit/);
});
