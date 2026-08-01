import type { EmployeeId } from "./identity";
import type { TaskId } from "./tasks";

/**
 * Emergency Mode, and the approval that decides whether it costs anybody time.
 *
 * **Ported from legacy, with its holes closed.** Legacy ran this entirely in the
 * browser: `lib/emergencyApproval.js` wrote `cowork_emergency_approvals`
 * straight to Firestore and `shiftOngoingTaskDeadlines` rewrote every due date
 * from the client. There was no route, no server validation, no audit of who
 * approved, and no notification to anyone. The backend has no emergency concept
 * at all.
 *
 * What carries forward unchanged: an emergency is declared, its duration is
 * measured, and that duration only reaches anybody's deadlines once a manager
 * has agreed to it.
 *
 * What legacy did not have and this adds, because the request is now a record
 * somebody is accountable for: a written reason at the point of ending it, a
 * supporting document, notifications on both sides, and a decision that is
 * attributable.
 */

export type EmergencyRequestStatus = "pending" | "approved" | "declined";

/** Only these are accepted as supporting evidence. */
export const EMERGENCY_DOC_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export interface EmergencyRequest {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: string;
  employeeId: EmployeeId;
  employeeName: string;
  /**
   * Who decides. The employee's DIRECT manager, resolved from the reporting
   * tree when the request is raised and then frozen onto the record.
   *
   * Frozen deliberately: a reorganisation between raising and deciding must not
   * silently move a pending decision to somebody who was not there for it.
   * Named here rather than checked as a capability, which is what makes
   * "the employee cannot approve their own" and "an administrator does not
   * bypass this" true without a new permission — the check is identity, and no
   * scope widens it.
   */
  managerId: EmployeeId;
  managerName: string;

  /** When Emergency Mode was switched on, and off. Real clock, both. */
  startedAt: string;
  endedAt: string;
  /** Derived from the two above at creation, and never recomputed. */
  durationSecs: number;

  reason: string;
  /** Required. A PDF or DOCX — see `EMERGENCY_DOC_TYPES`. */
  attachmentId: string;

  status: EmergencyRequestStatus;
  decisionReason: string | null;
  decidedAt: string | null;

  /**
   * The tasks whose deadlines actually moved, recorded when it is approved.
   *
   * Empty for a declined request, and empty for an approved one that found
   * nothing to shift. Stored rather than recomputed because "which deadlines
   * did this emergency move" must stay answerable after those tasks change
   * again for unrelated reasons.
   */
  appliedTaskIds: TaskId[];
  /**
   * When the deadline compensation was actually applied. Null until it is.
   *
   * **The consumed marker, and it is deliberately separate from `status`.**
   * `status === "approved"` records a DECISION; this records that the decision
   * has been paid out. Deriving one from the other would make the shift
   * re-runnable by anything that can write a status — a retried request, a
   * second click, a stale `pendingEmergencyGapMs` the old application turns
   * into another approval — and each replay would move every deadline again.
   *
   * The compensation is guarded on this being null, so approving twice moves
   * deadlines once.
   */
  compensationAppliedAt: string | null;
  createdAt: string;
}
