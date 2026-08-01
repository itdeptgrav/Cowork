/**
 * Priority changes, the P1 cascade, and acknowledgement.
 *
 * Legacy wrote priority client-side straight to Firestore with no permission
 * check, no audit record, and a 500ms race before the cascade fired
 * (docs/specs/TASK_LOGIC_SPEC.md §2.4, §2.9). Every change here is a recorded event.
 */

import type { EmployeeId } from "./identity";
import type { TaskId } from "./tasks";

export interface PriorityChange {
  id: string;
  taskId: TaskId;
  employeeId: EmployeeId;
  previousRank: number;
  newRank: number;
  /** Mandatory on manual reorder. Legacy required it in drag but not elsewhere. */
  reason: string;
  changedById: EmployeeId;
  changedAt: string;
  cascadeId: string | null;
}

/** One task's deadline movement caused by a promotion above it. */
export interface CascadeEffect {
  taskId: TaskId;
  taskTitle: string;
  previousRank: number;
  newRank: number;
  previousDueAt: string | null;
  newDueAt: string | null;
  previousWindowSecs: number | null;
  newWindowSecs: number | null;
  shiftedBySecs: number;
  /** Work already done is credited, so the shift is net of it. */
  creditedWorkedSecs: number;
}

/**
 * One row of a person's queue as it stood at a moment.
 *
 * What the receipt LISTS. `effects` above carries only the tasks whose deadline
 * moved — by design, since announcing a move for a task nothing displaced is the
 * defect `priorityCascade.ts` was rewritten over — but "show me the previous
 * order and the new order" needs every row, including the ones that did not
 * budge. The two answer different questions and are stored separately.
 */
export interface CascadeOrderEntry {
  taskId: TaskId;
  taskTitle: string;
  /** 1..N, contiguous. */
  rank: number;
  /** The date that order produces. Null on an undated task, shown as such. */
  dueAt: string | null;
}

export interface PriorityCascade {
  id: string;
  triggeringTaskId: TaskId;
  triggeringTaskTitle: string;
  employeeId: EmployeeId;
  reason: string;
  changedById: EmployeeId;
  changedByName: string;
  effects: CascadeEffect[];
  /**
   * The person's whole active queue before the reorder, in rank order.
   *
   * Empty is meaningful and permitted: a record written before the orders were
   * carried has none, and the receipt falls back to listing `effects` rather
   * than showing an empty table.
   */
  previousOrder: CascadeOrderEntry[];
  /** The same queue after. Same tasks, same length, different sequence. */
  newOrder: CascadeOrderEntry[];
  createdAt: string;
  acknowledgedAt: string | null;
}

/**
 * A blocking, non-dismissable receipt. Confirm is the only action — legacy had
 * no reject path and acknowledgement gates nothing (docs/specs/TASK_LOGIC_SPEC.md §2.7).
 */
export interface PriorityAcknowledgement {
  id: string;
  cascadeId: string;
  employeeId: EmployeeId;
  affectedTaskIds: TaskId[];
  acknowledgedAt: string;
  timerPausedTaskId: TaskId | null;
}

/**
 * A detected rank collision. Legacy allowed unlimited duplicate P1s because the
 * auto-assign count query was not transactional — OWNER DECISION O10.
 */
export interface PriorityConflict {
  employeeId: EmployeeId;
  rank: number;
  taskIds: TaskId[];
}
