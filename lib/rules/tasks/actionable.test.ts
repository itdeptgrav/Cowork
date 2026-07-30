import assert from "node:assert/strict";
import { test } from "node:test";
import { actionableFor, windowOnOffer } from "./actionable.ts";

/**
 * What belongs in the action inbox.
 *
 * The rule these pin down is the one the tab got wrong: it populated from
 * `nextAction(...).actor === "you"`, which is true of every task you are
 * carrying, so an inbox for stuck work filled with work that was merely yours.
 *
 * The REMOVE cases are the point. Each one is a task where the viewer's own
 * next move exists and nothing is waiting on it — the exact shape that has to
 * keep returning null, and the exact shape a future "just show me everything
 * assigned to me" change would quietly reintroduce.
 */

const ME = "e-01";
const THEM = "e-02";

/* eslint-disable @typescript-eslint/no-explicit-any */
function view(over: {
  status?: string;
  deadlineState?: string;
  mode?: string;
  dueAt?: string | null;
  windowSecs?: number | null;
  rejection?: unknown;
  type?: string;
  assignedTo?: string | null;
  createdById?: string;
  isBlocked?: boolean;
  pendingApprovals?: { approverId: string; kind: string }[];
  reviewChain?: string[];
  currentStage?: number;
  deletedAt?: string | null;
}): any {
  const assignedTo = over.assignedTo === undefined ? ME : over.assignedTo;
  return {
    task: {
      id: "t-1",
      status: over.status ?? "in_progress",
      type: over.type ?? "standard",
      createdById: over.createdById ?? THEM,
      isBlocked: over.isBlocked ?? false,
      deletedAt: over.deletedAt ?? null,
      deadline: {
        state: over.deadlineState ?? "agreed",
        mode: over.mode ?? "fixed",
        dueAt: over.dueAt === undefined ? "2026-08-01T00:00:00.000Z" : over.dueAt,
        currentWindowSecs: over.windowSecs ?? null,
        assignorWindowRejection: over.rejection ?? null,
      },
    },
    assignments: assignedTo ? [{ employeeId: assignedTo }] : [],
    assignees: [],
    pendingAssignees: [],
    owner: null,
    pendingApprovals: over.pendingApprovals ?? [],
    latestSubmission: over.reviewChain
      ? { reviewChain: over.reviewChain, currentStage: over.currentStage ?? 1 }
      : null,
  };
}

/* ── REMOVE — work, not a decision ───────────────────────────────────────── */

test("an in-progress task of mine is NOT actionable", () => {
  /* "Onboarding flow — activation pass", "Score breakdown — component
     drill-in", "Document permissions matrix" — all three of the rows the inbox
     was reported for. Their next action is "Submit when ready", which nothing
     is waiting on. */
  assert.equal(actionableFor(view({ status: "in_progress" }), ME), null);
});

test("a confirmed task of mine is NOT actionable", () => {
  /* "Start work" is an invitation, not an obligation to anybody else. */
  assert.equal(actionableFor(view({ status: "confirmed" }), ME), null);
});

test("an overdue in-progress task is still NOT actionable", () => {
  /* Overdue is urgent and still not a decision — it belongs in Tasks, where
     the overdue chip already carries it. Letting urgency in here is how the
     inbox would refill one exception at a time. */
  assert.equal(
    actionableFor(view({ status: "in_progress", dueAt: "2020-01-01T00:00:00.000Z" }), ME),
    null,
  );
});

test("somebody else's pending approval is NOT mine", () => {
  assert.equal(
    actionableFor(
      view({
        status: "pending_approval",
        pendingApprovals: [{ approverId: THEM, kind: "cross_department" }],
      }),
      ME,
    ),
    null,
  );
});

test("a review stage that is not yet mine is NOT actionable", () => {
  /* I am second in the chain; stage 1 is somebody else's. Listing it would ask
     people to act out of order. */
  assert.equal(
    actionableFor(
      view({ status: "in_review", reviewChain: [THEM, ME], currentStage: 1 }),
      ME,
    ),
    null,
  );
});

test("a closed task holds no obligation", () => {
  for (const status of ["completed", "cancelled", "assignment_rejected"]) {
    assert.equal(
      actionableFor(
        view({
          status,
          pendingApprovals: [{ approverId: ME, kind: "cross_department" }],
        }),
        ME,
      ),
      null,
      `${status} should never be actionable`,
    );
  }
});

/* ── KEEP — a decision, or the work cannot move ──────────────────────────── */

test("an approval addressed to me is actionable", () => {
  const r = actionableFor(
    view({
      status: "pending_approval",
      pendingApprovals: [{ approverId: ME, kind: "cross_department" }],
    }),
    ME,
  );
  assert.equal(r?.reason, "approval");
  assert.equal(r?.label, "Review");
});

test("an effort estimate names its own action", () => {
  const r = actionableFor(
    view({
      status: "pending_approval",
      pendingApprovals: [{ approverId: ME, kind: "effort_estimate" }],
    }),
    ME,
  );
  assert.equal(r?.label, "Set effort");
});

test("a submission at my stage is actionable", () => {
  const r = actionableFor(
    view({ status: "in_review", reviewChain: [ME, THEM], currentStage: 1 }),
    ME,
  );
  assert.equal(r?.reason, "review");
});

test("a proposed deadline is the creator's decision", () => {
  const r = actionableFor(
    view({ deadlineState: "proposed", createdById: ME, assignedTo: THEM }),
    ME,
  );
  assert.equal(r?.reason, "deadline");
  assert.equal(r?.label, "Decide deadline");
});

test("an extension request reads as an extension, not a deadline", () => {
  const r = actionableFor(
    view({
      deadlineState: "extension_pending",
      createdById: ME,
      assignedTo: THEM,
    }),
    ME,
  );
  assert.equal(r?.label, "Decide the extension");
});

test("a counter-proposal is the assignee's to answer", () => {
  const r = actionableFor(view({ deadlineState: "countered" }), ME);
  assert.equal(r?.reason, "deadline");
  assert.equal(r?.label, "Respond to counter");
});

test("an offered window is a decision, not an assignment", () => {
  const r = actionableFor(
    view({
      status: "assigned",
      mode: "timer",
      dueAt: null,
      windowSecs: 14400,
      deadlineState: "unset",
    }),
    ME,
  );
  assert.equal(r?.reason, "deadline");
  assert.equal(r?.label, "Accept or discuss the time");
});

test("an unset deadline needs a proposal from me", () => {
  const r = actionableFor(
    view({ status: "assigned", deadlineState: "unset", dueAt: null }),
    ME,
  );
  assert.equal(r?.label, "Propose a deadline");
});

test("an assigned task still needs confirming", () => {
  /* The sender cannot tell the work has landed until this happens, so it is a
     response somebody is waiting on rather than work I can get on with. */
  const r = actionableFor(view({ status: "assigned" }), ME);
  assert.equal(r?.reason, "intake");
  assert.equal(r?.label, "Confirm receipt");
});

test("a blocked task reaches the people who can unstick it", () => {
  const carrying = actionableFor(
    view({ status: "in_progress", isBlocked: true }),
    ME,
  );
  assert.equal(carrying?.reason, "blocked");

  const raised = actionableFor(
    view({ status: "in_progress", isBlocked: true, assignedTo: THEM, createdById: ME }),
    ME,
  );
  assert.equal(raised?.reason, "blocked");

  const bystander = actionableFor(
    view({
      status: "in_progress",
      isBlocked: true,
      assignedTo: THEM,
      createdById: THEM,
    }),
    ME,
  );
  assert.equal(bystander, null, "somebody who cannot act should not be asked to");
});

/* ── Ordering — one task, one section ────────────────────────────────────── */

test("an approval outranks a blocker on the same task", () => {
  /* Both are true; the approval is the concrete thing I can do about it, and a
     task must land in exactly one section or the inbox double-counts. */
  const r = actionableFor(
    view({
      status: "pending_approval",
      isBlocked: true,
      pendingApprovals: [{ approverId: ME, kind: "cross_department" }],
    }),
    ME,
  );
  assert.equal(r?.reason, "approval");
});

test("a deadline decision outranks intake on the same task", () => {
  const r = actionableFor(
    view({
      status: "assigned",
      mode: "timer",
      dueAt: null,
      windowSecs: 14400,
      deadlineState: "unset",
    }),
    ME,
  );
  assert.equal(r?.reason, "deadline");
});

/* ── The offer predicate, moved but unchanged ────────────────────────────── */

test("windowOnOffer still refuses a self-assigned task", () => {
  assert.equal(
    windowOnOffer(
      view({
        status: "assigned",
        mode: "timer",
        dueAt: null,
        windowSecs: 14400,
        type: "self_assigned",
      }).task,
    ),
    false,
  );
});

test("windowOnOffer still refuses a rejected window", () => {
  assert.equal(
    windowOnOffer(
      view({
        status: "assigned",
        mode: "timer",
        dueAt: null,
        windowSecs: 14400,
        rejection: { reason: "not enough" },
      }).task,
    ),
    false,
  );
});
