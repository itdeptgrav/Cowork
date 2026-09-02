import type { PreAssignDeadlineRequest } from "@/lib/domain";
import type { TaskView } from "@/lib/repositories/types";

/**
 * The receiver-side deadline pushback, before the work is assigned.
 *
 * ## The moment this exists for
 *
 * A cross-department task reaches `pending_tl_hours`: both department approvals
 * are in, nobody is assigned yet (the assignee is parked in
 * `pendingAssigneeId`), and the receiver's manager is about to set the hours
 * and hand it over. If they judge the creator's fixed deadline too tight, this
 * is where they push back — BEFORE committing anybody to it — rather than
 * accepting an impossible date and then fighting an extension after the fact.
 *
 * ## Why it is only ever a proposal
 *
 * The creator owns the deadline; they made the commitment, possibly onward to
 * a client. So the receiver's manager can only ASK. The creator accepts (the
 * date moves), counters (offers another), or rejects (it stands). This module
 * is the one authority on who may do which, and what the date becomes — the
 * backend writes what it decides here, and the panel offers only what it
 * permits, so the screen and the engine cannot disagree.
 *
 * ## Not the assignee's extension
 *
 * That flow (`DeadlineChangeRequest`, `requestDeadlineChange`) is in HOURS,
 * after assignment, owned by the assignee's side. This is a DATE, before
 * assignment, initiated by the manager who is about to set the budget. Kept
 * wholly separate for the reason the domain type gives.
 */

/**
 * The domain-side marker for "at the budget gate".
 *
 * The raw engine status is `pending_tl_hours`, but the mapper folds every gate
 * state into the domain status `pending_approval` and records which gate in
 * `approvalReason`. `effort_estimate` is the one that means "waiting for hours
 * to be set" — the exact moment this pushback belongs to. `budgetOwner` is
 * populated on the view only in this state too, so the two checks agree by
 * construction.
 */
function atBudgetGate(view: TaskView): boolean {
  return view.task.approvalReason === "effort_estimate";
}

/** A request that is still awaiting the creator's answer. */
export function hasOpenRequest(
  req: PreAssignDeadlineRequest | null | undefined,
): boolean {
  return !!req && req.status === "pending";
}

/**
 * May this viewer PROPOSE a different deadline right now?
 *
 * The receiver's manager, and only while the task is at the budget gate with
 * no request already open. `budgetOwner` is the field the mapper populates for
 * exactly this person on a `pending_tl_hours` task — the same one that decides
 * who may set the hours — so the two controls are offered to precisely the same
 * person and never drift apart.
 */
export function mayRequestPreAssignDeadline(
  view: TaskView,
  viewerId: string | null,
): boolean {
  if (!viewerId) return false;
  if (!atBudgetGate(view)) return false;
  if (view.budgetOwner?.id !== viewerId) return false;
  return !hasOpenRequest(view.task.preAssignDeadline);
}

/**
 * May this viewer DECIDE an open request?
 *
 * The creator, because they own the deadline. Checked against `createdById` —
 * whoever raised the task — never the assignee or their manager, who are the
 * ones asking.
 */
export function mayDecidePreAssignDeadline(
  view: TaskView,
  viewerId: string | null,
): boolean {
  if (!viewerId) return false;
  if (!hasOpenRequest(view.task.preAssignDeadline)) return false;
  return view.task.createdById === viewerId;
}

export type ProposedDeadlineCheck =
  | { ok: true; iso: string }
  | { ok: false; message: string };

/**
 * Is this a date the request may be raised with?
 *
 * A real instant, in the future, later than the date it is replacing, with a
 * reason. Later-than-current because the whole point is a pushback: a request
 * for an EARLIER date is not this feature, and silently allowing one would let
 * a manager tighten a commitment the creator made rather than loosen it.
 */
export function validateProposedDeadline(input: {
  proposedDueAt: string;
  currentDueAt: string | null;
  reason: string;
  nowMs: number;
}): ProposedDeadlineCheck {
  const reason = String(input.reason ?? "").trim();
  if (!reason) {
    return { ok: false, message: "Say why the deadline needs to move." };
  }
  const ms = Date.parse(input.proposedDueAt);
  if (!Number.isFinite(ms)) {
    return { ok: false, message: "Choose a valid date and time." };
  }
  if (ms <= input.nowMs) {
    return { ok: false, message: "The new deadline must be in the future." };
  }
  const current = input.currentDueAt ? Date.parse(input.currentDueAt) : null;
  if (current !== null && Number.isFinite(current) && ms <= current) {
    return {
      ok: false,
      message: "Ask for a LATER date — this is for more time, not less.",
    };
  }
  return { ok: true, iso: new Date(ms).toISOString() };
}

export type PreAssignDecision = "approve" | "reject" | "counter";

export interface DecisionOutcome {
  /** The fixed deadline the task should carry afterwards, or null to leave it. */
  newDueAt: string | null;
  /** What the request record becomes. */
  status: PreAssignDeadlineRequest["status"];
}

/**
 * What a creator's decision does — the one place that maps a decision to its
 * effect on the stored deadline.
 *
 *  · **approve** — the date becomes the proposed one, request closed `approved`.
 *  · **counter** — the creator offers `counterDueAt`; the DATE DOES NOT MOVE yet
 *    (the manager must still accept it), request `countered`.
 *  · **reject**  — nothing moves, request closed `rejected`.
 *
 * A counter deliberately does not touch the deadline: it is a new offer going
 * back to the manager, and moving the date on a mere counter would commit the
 * creator to something nobody has accepted.
 */
export function resolvePreAssignDecision(
  req: PreAssignDeadlineRequest,
  decision: PreAssignDecision,
  counterDueAt?: string | null,
): DecisionOutcome {
  if (decision === "approve") {
    return { newDueAt: req.proposedDueAt, status: "approved" };
  }
  if (decision === "counter") {
    return { newDueAt: null, status: "countered" };
  }
  return { newDueAt: null, status: "rejected" };
}

/** The line the panel shows about an open or decided request. */
export function preAssignSummary(
  req: PreAssignDeadlineRequest | null | undefined,
): string | null {
  if (!req) return null;
  if (req.status === "pending") {
    return `${req.requestedByName} asked to move the deadline. Reason: ${req.reason}`;
  }
  if (req.status === "approved") return "The deadline was moved as asked.";
  if (req.status === "rejected") return "The deadline change was declined.";
  if (req.status === "countered") return "A different date was offered back.";
  return null;
}
