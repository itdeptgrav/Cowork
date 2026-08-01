/* Relative and extensioned: `EMERGENCY_DOC_TYPES` is a runtime value, and the
   test runner is plain `node --test`, which resolves neither the `@/` alias nor
   an extensionless path. The type imports below are erased, so they may keep
   the alias. */
import { EMERGENCY_DOC_TYPES } from "../../domain/emergency.ts";
import type { EmergencyRequest } from "@/lib/domain";

/**
 * The rules an Emergency Mode request has to satisfy, and who they belong to.
 *
 * Pure, and separate from the repository, so the dialog can refuse before a
 * round trip and the repository can refuse regardless — one rule, two
 * enforcement points, and the form never has to guess at the wording.
 */

/**
 * Why this request cannot be raised, or null.
 *
 * Legacy required a reason to ENTER Emergency Mode and asked for nothing on the
 * way out — so the record explaining what happened was written before it had
 * happened. The reason and the document are collected at the end, when there is
 * something to describe.
 */
export function emergencyRequestRefusal(input: {
  durationSecs: number;
  reason: string;
  document: { mimeType: string; filename: string } | null;
  managerId: string | null;
}): string | null {
  if (input.durationSecs <= 0)
    return "Emergency Mode has not been running, so there is nothing to review.";
  if (!input.reason.trim())
    return "Explain what happened. Your manager decides from this.";
  if (!input.document)
    return "Attach a supporting document — a PDF or a Word file.";
  if (!isAcceptedDocument(input.document.mimeType))
    return "That file is not a PDF or a Word document.";
  if (!input.managerId)
    return "You have no manager on record, so there is nobody to review this. Ask an administrator to set your reporting line.";
  return null;
}

/** Whether a file is acceptable evidence. */
export function isAcceptedDocument(mimeType: string): boolean {
  return (EMERGENCY_DOC_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Why this person cannot decide this request, or null.
 *
 * Identity, not capability. The request names one decider and only that person
 * may act — which is what makes "the employee cannot approve their own" and
 * "an administrator does not bypass this" true without either being written as
 * a special case. An administrator with organisation scope over everything
 * still is not the named manager.
 */
export function emergencyDecisionRefusal(input: {
  request: Pick<
    EmergencyRequest,
    "managerId" | "employeeId" | "status" | "compensationAppliedAt"
  >;
  actorId: string;
  approve: boolean;
  decisionReason: string;
}): string | null {
  const { request, actorId } = input;
  if (request.status !== "pending")
    return "This request has already been decided.";
  /* Belt to the braces above. A record whose compensation has been paid out but
     whose status somehow reads `pending` — a half-written update, a restored
     backup — must still not pay out twice. */
  if (request.compensationAppliedAt !== null)
    return "This request has already been applied.";
  if (actorId === request.employeeId)
    return "You cannot decide your own emergency request.";
  if (actorId !== request.managerId)
    return "Only this person's manager can decide this request.";
  if (!input.approve && !input.decisionReason.trim())
    return "A reason is required to decline.";
  return null;
}

/**
 * How much time this decision owes the person's deadlines, in milliseconds.
 *
 * **The single arithmetic for emergency compensation.** Both repositories call
 * it, so neither can decide on its own what an approval is worth, and a
 * rejection cannot accidentally be worth something.
 *
 * Zero unless every one of these holds:
 *
 *  · the decision is an APPROVAL — a rejection or a cancellation adds nothing,
 *  · the request is still `pending` — a decided one has had its turn,
 *  · nothing has been applied yet — `compensationAppliedAt` is the consumed
 *    marker, and it is checked here as well as at the refusal so that a caller
 *    which somehow skips the refusal still cannot pay twice,
 *  · the actor is the manager the request NAMES — identity, never capability,
 *    so an administrator, a secondary manager, the requester themselves and an
 *    unrelated user all get zero rather than a partial shift.
 *
 * The duration is the one frozen onto the record when the request was raised,
 * never recomputed from the timestamps: the span under review is the span the
 * manager read.
 */
export function emergencyCompensationMs(input: {
  request: Pick<
    EmergencyRequest,
    "managerId" | "employeeId" | "status" | "durationSecs" | "compensationAppliedAt"
  >;
  actorId: string;
  approve: boolean;
}): number {
  const { request } = input;
  if (!input.approve) return 0;
  if (request.status !== "pending") return 0;
  if (request.compensationAppliedAt !== null) return 0;
  if (input.actorId === request.employeeId) return 0;
  if (input.actorId !== request.managerId) return 0;
  return Math.max(0, Math.round(request.durationSecs)) * 1000;
}
