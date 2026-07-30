/**
 * Deadline negotiation — the richest workflow carried forward from legacy
 * (docs/architecture/MIGRATION_DECISIONS.md D8), restructured from ~25 fields scattered across
 * the task document into typed records.
 *
 * One extension mechanism, not two. Legacy had `propose-deadline` (creator
 * approves) and `request-deadline-extension` (any manager approves) writing
 * different fields — docs/specs/TASK_LOGIC_SPEC.md §3.5.
 */

import type { EmployeeId } from "./identity";
import type { TaskId } from "./tasks";

export type ProposalState =
  "pending" | "approved" | "rejected" | "countered" | "expired";

export interface DeadlineProposal {
  id: string;
  taskId: TaskId;
  proposedById: EmployeeId;
  proposedDueAt: string;
  windowSecs: number;
  /** Extensions are ADDITIVE, producing an auditable 30m + 20m + 10m chain. */
  isExtension: boolean;
  previousWindowSecs: number | null;
  /**
   * Seconds this request ADDS. The figure somebody actually chose.
   *
   * Stored at request time, never derived. Differencing `windowSecs` against
   * the window in force cannot work for a GRANTED extension: approving it
   * overwrites exactly that window, so every historical row computed zero.
   *
   * Null on records written before the amount was carried, and on a proposal
   * that sets a window rather than extending one.
   */
  addedSecs: number | null;
  reason: string | null;
  state: ProposalState;
  decidedById: EmployeeId | null;
  decisionReason: string | null;
  createdAt: string;
  /** Legacy had no expiry — a proposal could stall forever. OWNER DECISION O15. */
  expiresAt: string | null;
  decidedAt: string | null;
}

export interface DeadlineCounter {
  id: string;
  proposalId: string;
  taskId: TaskId;
  counteredById: EmployeeId;
  counterDueAt: string;
  counterWindowSecs: number;
  message: string | null;
  response: "pending" | "accepted" | "rejected";
  responseMessage: string | null;
  respondedAt: string | null;
  createdAt: string;
}

export interface DeadlineExtension {
  id: string;
  taskId: TaskId;
  /**
   * The negotiation this extension settled, or null.
   *
   * Null when the time came from somewhere other than a deadline negotiation —
   * an approved Emergency Mode request, which extends every one of that
   * person's live tasks at once and belongs to no single proposal.
   */
  proposalId: string | null;
  addedSecs: number;
  previousWindowSecs: number;
  newWindowSecs: number;
  /**
   * Office-hours-aware elapsed fraction at request time. Legacy hard-coded
   * 50%/70% zones deciding the waiver — OWNER DECISION O14 (T8).
   */
  elapsedPercentAtRequest: number;
  penaltyWaived: boolean;
  waiverDecidedById: EmployeeId | null;
  approvedById: EmployeeId;
  approvedAt: string;
}

/** A day the deadline picker must refuse: holiday, approved leave, week-off. */
export interface BlockedDate {
  date: string;
  kind: "holiday" | "leave" | "week_off";
  label: string;
}

export interface WorkCalendarDay {
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  isOff: boolean;
  inTime: string | null;
  outTime: string | null;
}

export interface WorkCalendar {
  id: string;
  name: string;
  /** Configuration, never hard-coded IST (docs/architecture/MIGRATION_DECISIONS.md D31). */
  timezone: string;
  days: WorkCalendarDay[];
  breaks: { start: string; end: string; label: string }[];
}
