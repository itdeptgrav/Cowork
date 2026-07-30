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
  request: Pick<EmergencyRequest, "managerId" | "employeeId" | "status">;
  actorId: string;
  approve: boolean;
  decisionReason: string;
}): string | null {
  const { request, actorId } = input;
  if (request.status !== "pending")
    return "This request has already been decided.";
  if (actorId === request.employeeId)
    return "You cannot decide your own emergency request.";
  if (actorId !== request.managerId)
    return "Only this person's manager can decide this request.";
  if (!input.approve && !input.decisionReason.trim())
    return "A reason is required to decline.";
  return null;
}
