/**
 * Two conversations, two records, two units. Never one.
 *
 * **Hours and dates are not interchangeable and must not travel together.**
 *
 *   *Time budget extension* — between an assignee and their PRIMARY MANAGER,
 *     entirely in working seconds. No date appears in it, because none is being
 *     decided: the question is how long the work takes, not when it is due.
 *
 *   *Deadline extension* — between that manager and the ASSIGNOR, entirely in
 *     dates. No hours appear in it, because the assignor is not deciding how
 *     long anybody's work takes. They are deciding whether a commitment they
 *     made can move.
 *
 * The second follows the first only when the workload genuinely cannot fit.
 *
 * ## Why the separation has to be structural
 *
 * A deadline request carrying "+2 hours" invites the assignor to do the one
 * calculation they must never do — `oldDeadline + extraHours`. That answer is
 * always wrong: the work sits in a queue behind other work and runs through an
 * office calendar, so two extra hours of budget can move a completion by a day
 * or by nothing at all. Presenting the hours makes the wrong sum look
 * available, and somebody eventually does it.
 *
 * So the field simply is not there. `deadlineExtension()` has nowhere to put a
 * duration, and `timeBudgetExtension()` has nowhere to put a date.
 */

export const TIME_BUDGET_EXTENSION = "TIME_BUDGET_EXTENSION";
export const DEADLINE_EXTENSION = "DEADLINE_EXTENSION";

/**
 * The budget conversation's states.
 *
 * **`approved` is not terminal, and that is the fix.** It was, and so "the
 * manager granted your hours, now confirm them" had nowhere to live: approval
 * applied the figure unilaterally and closed the record. A manager may grant
 * FEWER hours than were asked for, so their answer is an offer, and the person
 * whose week it binds has to agree to it.
 *
 * | status | whose move | means |
 * |---|---|---|
 * | `pending` | approver | the assignee has asked; the manager has not answered |
 * | `approved` | requester | the manager has answered; the assignee must confirm |
 * | `counter_proposed` | approver | the assignee asked again; back to the manager |
 * | `accepted` | nobody | settled, and the budget is in force |
 * | `rejected` | nobody | declined on the first answer; nothing changed |
 *
 * `approved` → `counter_proposed` → `approved` → … is the loop, and it exits
 * only through `accepted`.
 */
export type ExtensionStatus =
  | "pending"
  | "approved"
  | "counter_proposed"
  | "accepted"
  | "rejected";

/** The statuses with nothing outstanding. */
export const SETTLED_BUDGET_STATUSES: ExtensionStatus[] = [
  "accepted",
  "rejected",
];

/**
 * The deadline conversation's states.
 *
 * Now the same union as the budget one, and that convergence is the fix rather
 * than a tidy-up. The deadline record always had `counter_proposed` — an
 * assignor answering with a different date is not refusing, and collapsing that
 * into "rejected" would end a conversation that is not over. The BUDGET record
 * did not, which is why a manager granting a different figure had nowhere to
 * record it and the assignee had nothing to answer.
 *
 * `accepted` is unused on this side: a deadline is settled by the assignor's
 * `approved`, because the manager who asked does not then confirm their own
 * request. Kept in one union anyway — two nearly-identical status types is how
 * a reader comes to believe the two conversations differ more than they do.
 */
export type DeadlineExtensionStatus = ExtensionStatus;

/**
 * Hours only. Assignee ↔ primary manager.
 *
 * **Stored in its own collection**, not folded into the deadline history. It
 * was riding in `deadlineExtRequest` — a record whose whole purpose is a date —
 * so a capacity question and a commitment question shared one row and one
 * status. Approving either looked like approving both.
 */
export interface TimeBudgetExtensionRecord {
  type: typeof TIME_BUDGET_EXTENSION;
  id: string;
  taskId: string;
  /** The assignee who needs longer. */
  requestedBy: string;
  /** Their primary manager. Never a department lead, never the assignor. */
  approverId: string | null;
  previousBudgetSecs: number;
  requestedAdditionalSecs: number;
  newBudgetSecs: number;
  reason: string | null;
  status: ExtensionStatus;
  /**
   * What the manager actually granted, when it differs from what was asked.
   *
   * Kept BESIDE `newBudgetSecs` rather than overwriting it, for the same reason
   * `counterDeadline` sits beside `proposedDeadline`: what was asked for and what
   * was offered back are both part of the account, and a record that remembered
   * only the latest figure could not show the negotiation. Null means the
   * manager granted exactly what was requested.
   */
  approvedSecs: number | null;
  /**
   * How many times a figure has been put forward, starting at 1.
   *
   * The loop can run indefinitely, so a reader needs to know which round they
   * are looking at — and a timeline of four rows all saying "requested more
   * time" is unreadable without it.
   */
  round: number;
  createdAt: string | null;
  /** When the manager decided. Null while pending. */
  approvedAt: string | null;
  /** When the assignee confirmed. Null until the loop exits through `accepted`. */
  confirmedAt: string | null;
  /** Who confirmed. The assignee, always — recorded rather than inferred. */
  confirmedBy: string | null;
}

/**
 * Dates only. Manager ↔ assignor.
 *
 * Raised only when the workload engine says the extra hours cannot land inside
 * the commitment — never as a matter of course.
 */
export interface DeadlineExtensionRecord {
  type: typeof DEADLINE_EXTENSION;
  id: string;
  taskId: string;
  /** The MANAGER who escalated, not the assignee. */
  requestedBy: string;
  /** The assignor, whose commitment it is. */
  approverId: string | null;
  /** ISO. The commitment as it stands. */
  previousDeadline: string | null;
  /**
   * ISO. The earliest the queue can actually deliver, from the workload
   * engine — never `previousDeadline` plus a duration.
   */
  proposedDeadline: string;
  reason: string | null;
  status: DeadlineExtensionStatus;
  /**
   * The assignor's own date, when they answered with one.
   *
   * Kept beside `proposedDeadline` rather than overwriting it: what was asked
   * for and what was offered back are both part of the account, and a record
   * that only remembered the latest figure could not show the negotiation.
   */
  counterDeadline: string | null;
  createdAt: string | null;
  approvedAt: string | null;
  /** Who answered. Null while pending. */
  decidedBy: string | null;
  /**
   * A pre-migration row, read from `deadlineHistory` rather than the typed
   * collection. Displayed, never written, and never decided on.
   */
  isHistorical: boolean;
}

export type ExtensionRecord =
  | TimeBudgetExtensionRecord
  | DeadlineExtensionRecord;

function secs(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * A budget request, in seconds.
 *
 * `newBudgetSecs` is derived here so no caller adds the two numbers itself —
 * a second sum is how a form and a stored record come to disagree.
 */
export function timeBudgetExtension(input: {
  id?: string;
  taskId?: string;
  requestedBy?: string;
  approverId?: string | null;
  previousBudgetSecs: unknown;
  requestedAdditionalSecs: unknown;
  reason?: string | null;
  status?: ExtensionStatus;
  approvedSecs?: unknown;
  round?: unknown;
  createdAt?: string | null;
  approvedAt?: string | null;
  confirmedAt?: string | null;
  confirmedBy?: string | null;
}): TimeBudgetExtensionRecord {
  const previousBudgetSecs = secs(input.previousBudgetSecs);
  const requestedAdditionalSecs = Math.round(
    Number(input.requestedAdditionalSecs) || 0,
  );
  return {
    type: TIME_BUDGET_EXTENSION,
    id: input.id ?? "",
    taskId: input.taskId ?? "",
    requestedBy: input.requestedBy ?? "",
    approverId: input.approverId ?? null,
    previousBudgetSecs,
    requestedAdditionalSecs,
    /* Floored at one second: a budget of zero would drop the task out of the
       queue entirely, which no extension request means to do. */
    newBudgetSecs: Math.max(1, previousBudgetSecs + requestedAdditionalSecs),
    reason: input.reason ?? null,
    status: input.status ?? "pending",
    /* Null, not the requested figure. "The manager granted exactly what was
       asked" and "the manager named 4h" are different facts, and the second is
       what the confirmation card has to show as a change. */
    approvedSecs:
      input.approvedSecs === null || input.approvedSecs === undefined
        ? null
        : Math.max(1, secs(input.approvedSecs)),
    /* Floored at 1: a stored 0 from a pre-loop record is still the first round
       of a conversation, and rendering "round 0" would read as a fault. */
    round: Math.max(1, Math.round(Number(input.round) || 0)),
    createdAt: input.createdAt ?? null,
    approvedAt: input.approvedAt ?? null,
    confirmedAt: input.confirmedAt ?? null,
    confirmedBy: input.confirmedBy ?? null,
  };
}

/**
 * A deadline request, in dates.
 *
 * `proposedDeadline` must come from the workload engine's `estimatedCompletionTime`
 * — there is deliberately no duration parameter to derive one from.
 */
export function deadlineExtension(input: {
  id?: string;
  taskId?: string;
  requestedBy?: string;
  approverId?: string | null;
  previousDeadline: string | null;
  proposedDeadline: string;
  reason?: string | null;
  status?: DeadlineExtensionStatus;
  counterDeadline?: string | null;
  createdAt?: string | null;
  approvedAt?: string | null;
  decidedBy?: string | null;
  isHistorical?: boolean;
}): DeadlineExtensionRecord {
  return {
    type: DEADLINE_EXTENSION,
    id: input.id ?? "",
    taskId: input.taskId ?? "",
    requestedBy: input.requestedBy ?? "",
    approverId: input.approverId ?? null,
    previousDeadline: input.previousDeadline,
    proposedDeadline: input.proposedDeadline,
    reason: input.reason ?? null,
    status: input.status ?? "pending",
    counterDeadline: input.counterDeadline ?? null,
    createdAt: input.createdAt ?? null,
    approvedAt: input.approvedAt ?? null,
    decidedBy: input.decidedBy ?? null,
    isHistorical: input.isHistorical === true,
  };
}

/**
 * The date now under discussion.
 *
 * The counter if one was made, otherwise what was asked for. One reading, so a
 * screen and a write cannot disagree about which figure is live.
 */
export function liveDeadline(record: DeadlineExtensionRecord): string {
  return record.counterDeadline ?? record.proposedDeadline;
}

/**
 * Does this record carry only its own unit?
 *
 * A runtime check as well as a type, because these records cross a wire and
 * come back as untyped documents. A budget record that has grown a date, or a
 * deadline record that has grown seconds, is the mixing this module exists to
 * prevent — and it would arrive silently.
 */
export function isUnitPure(record: Record<string, unknown>): boolean {
  /* `createdAt`/`approvedAt` are on both: WHEN a decision happened is not the
     unit under discussion, it is provenance. The ban is on the other side's
     SUBJECT — a deadline being proposed, or a budget being sized. */
  const keys = Object.keys(record).filter(
    (k) => k !== "createdAt" && k !== "approvedAt",
  );
  if (record.type === TIME_BUDGET_EXTENSION) {
    return !keys.some((k) => /deadline|dueAt|proposedDate/i.test(k));
  }
  if (record.type === DEADLINE_EXTENSION) {
    return !keys.some((k) => /secs|seconds|hours|budget|window/i.test(k));
  }
  return false;
}

/**
 * What the ASSIGNOR is shown.
 *
 * Dates and a reason. Not the hours, not the queue, not the priority — none of
 * it is theirs to decide, and showing it invites the `oldDeadline + hours` sum
 * that is always wrong.
 */
export function assignorView(record: DeadlineExtensionRecord): {
  previousDeadline: string | null;
  proposedDeadline: string;
  reason: string | null;
} {
  return {
    previousDeadline: record.previousDeadline,
    proposedDeadline: record.proposedDeadline,
    reason: record.reason,
  };
}
