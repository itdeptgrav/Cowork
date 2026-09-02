import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasOpenRequest,
  mayDecidePreAssignDeadline,
  mayRequestPreAssignDeadline,
  preAssignSummary,
  resolvePreAssignDecision,
  validateProposedDeadline,
} from "./preAssignDeadline.ts";
import type { PreAssignDeadlineRequest } from "@/lib/domain";
import type { TaskView } from "@/lib/repositories/types";

/* A view narrowed to the fields these rules read — cast so the test states
   exactly what matters and nothing it does not. `atGate` defaults true: a
   pending_tl_hours task maps to `approvalReason: "effort_estimate"`, which is
   the domain marker the rule reads. */
function view(input: {
  atGate?: boolean;
  createdById?: string;
  budgetOwnerId?: string | null;
  request?: PreAssignDeadlineRequest | null;
}): TaskView {
  return {
    task: {
      id: "T192",
      status: "pending_approval",
      approvalReason: (input.atGate ?? true) ? "effort_estimate" : null,
      createdById: input.createdById ?? "CREATOR",
      preAssignDeadline: input.request ?? null,
    },
    budgetOwner:
      input.budgetOwnerId === null || input.budgetOwnerId === undefined
        ? null
        : { id: input.budgetOwnerId },
  } as unknown as TaskView;
}

const openReq: PreAssignDeadlineRequest = {
  proposedDueAt: "2026-09-11T10:30:00.000Z",
  previousDueAt: "2026-09-10T08:30:00.000Z",
  requestedById: "MGR",
  requestedByName: "Rishee Ray",
  reason: "queue is full until the 11th",
  status: "pending",
  counterDueAt: null,
  decidedById: null,
  decidedByName: null,
  decisionReason: null,
};

/* ── Who may PROPOSE ──────────────────────────────────────────────────────── */

test("the receiver's manager may propose at the budget gate", () => {
  const v = view({ budgetOwnerId: "MGR" });
  assert.equal(mayRequestPreAssignDeadline(v, "MGR"), true);
});

test("nobody but the budget owner may propose", () => {
  const v = view({ budgetOwnerId: "MGR" });
  assert.equal(mayRequestPreAssignDeadline(v, "SOMEONE_ELSE"), false);
  assert.equal(mayRequestPreAssignDeadline(v, "CREATOR"), false);
  assert.equal(mayRequestPreAssignDeadline(v, null), false);
});

test("proposing is only for a task at the budget gate", () => {
  /* Off the gate (approvalReason not effort_estimate), the assignee's own
     extension flow owns deadline changes and this control is gone. */
  const v = view({ atGate: false, budgetOwnerId: "MGR" });
  assert.equal(mayRequestPreAssignDeadline(v, "MGR"), false);
});

test("a second request cannot open while one is pending", () => {
  const v = view({ budgetOwnerId: "MGR", request: openReq });
  assert.equal(mayRequestPreAssignDeadline(v, "MGR"), false);
});

test("a decided request frees the manager to ask again", () => {
  /* A rejected pushback is not a permanent bar — the queue may change. */
  const v = view({
    budgetOwnerId: "MGR",
    request: { ...openReq, status: "rejected" },
  });
  assert.equal(mayRequestPreAssignDeadline(v, "MGR"), true);
});

/* ── Who may DECIDE ───────────────────────────────────────────────────────── */

test("the creator decides an open request", () => {
  const v = view({ createdById: "CREATOR", request: openReq });
  assert.equal(mayDecidePreAssignDeadline(v, "CREATOR"), true);
});

test("the manager who asked cannot also decide it", () => {
  const v = view({ createdById: "CREATOR", request: openReq });
  assert.equal(mayDecidePreAssignDeadline(v, "MGR"), false);
});

test("there is nothing to decide without an open request", () => {
  assert.equal(mayDecidePreAssignDeadline(view({}), "CREATOR"), false);
  const decided = view({ request: { ...openReq, status: "approved" } });
  assert.equal(mayDecidePreAssignDeadline(decided, "CREATOR"), false);
});

/* ── The proposed date ────────────────────────────────────────────────────── */

const NOW = Date.parse("2026-09-01T00:00:00.000Z");
const CURRENT = "2026-09-10T08:30:00.000Z"; // 10 Sep, 2 PM IST

test("a later date with a reason is accepted", () => {
  const r = validateProposedDeadline({
    proposedDueAt: "2026-09-11T10:30:00.000Z", // 11 Sep, 4 PM IST
    currentDueAt: CURRENT,
    reason: "not enough runway",
    nowMs: NOW,
  });
  assert.equal(r.ok, true);
});

test("a reason is required", () => {
  const r = validateProposedDeadline({
    proposedDueAt: "2026-09-11T10:30:00.000Z",
    currentDueAt: CURRENT,
    reason: "   ",
    nowMs: NOW,
  });
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /why/i);
});

test("an EARLIER date is refused — this is for more time, not less", () => {
  const r = validateProposedDeadline({
    proposedDueAt: "2026-09-09T08:30:00.000Z",
    currentDueAt: CURRENT,
    reason: "…",
    nowMs: NOW,
  });
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /later/i);
});

test("a date in the past is refused", () => {
  const r = validateProposedDeadline({
    proposedDueAt: "2026-08-01T00:00:00.000Z",
    currentDueAt: null,
    reason: "…",
    nowMs: NOW,
  });
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /future/i);
});

test("an unparseable date is refused, not passed through", () => {
  const r = validateProposedDeadline({
    proposedDueAt: "next tuesday-ish",
    currentDueAt: CURRENT,
    reason: "…",
    nowMs: NOW,
  });
  assert.equal(r.ok, false);
});

/* ── The decision's effect ────────────────────────────────────────────────── */

test("approve moves the date to the proposed one", () => {
  const out = resolvePreAssignDecision(openReq, "approve");
  assert.equal(out.newDueAt, openReq.proposedDueAt);
  assert.equal(out.status, "approved");
});

test("reject moves nothing", () => {
  const out = resolvePreAssignDecision(openReq, "reject");
  assert.equal(out.newDueAt, null);
  assert.equal(out.status, "rejected");
});

test("counter does NOT move the date — it is a new offer to accept", () => {
  /* The date moves only when the manager accepts the counter, not when it is
     made. Moving it here would commit the creator to something unaccepted. */
  const out = resolvePreAssignDecision(openReq, "counter", "2026-09-11T05:00:00.000Z");
  assert.equal(out.newDueAt, null);
  assert.equal(out.status, "countered");
});

/* ── Small helpers ────────────────────────────────────────────────────────── */

test("hasOpenRequest is true only while pending", () => {
  assert.equal(hasOpenRequest(openReq), true);
  assert.equal(hasOpenRequest({ ...openReq, status: "approved" }), false);
  assert.equal(hasOpenRequest(null), false);
  assert.equal(hasOpenRequest(undefined), false);
});

test("the summary names who asked and why while pending", () => {
  const s = preAssignSummary(openReq);
  assert.match(s!, /Rishee Ray/);
  assert.match(s!, /queue is full/);
  assert.equal(preAssignSummary(null), null);
});
