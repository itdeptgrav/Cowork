import type { Task } from "@/lib/domain";

/**
 * Which deadlines a block of non-working time moves, and to when.
 *
 * Shared by the two features that credit time back to somebody's schedule —
 * an approved Emergency Mode request and a Break — because they answer the same
 * question and must not answer it differently. Legacy had one implementation
 * too (`shiftOngoingTaskDeadlines`), reached from both paths; this is that
 * function's eligibility rule and arithmetic, kept in one place.
 *
 * It decides WHICH tasks and TO WHEN. It does not write anything: applying the
 * move is `#extendDeadline` in the repository, which is the only thing that
 * touches a deadline and the only thing that records why.
 */

/** Terminal states, transcribed from legacy's `TERMINAL_STATUSES`. */
const UNSHIFTABLE: Task["status"][] = [
  "completed",
  "cancelled",
  "assignment_rejected",
];

/**
 * Which of this person's tasks a credited absence moves.
 *
 * Transcribed from legacy's `shiftOngoingTaskDeadlines`: every task assigned to
 * them that has a deadline and has not reached a terminal state. A task with no
 * date has nothing to shift, and shifting a finished one would rewrite history.
 */
export function shiftableTasks(input: {
  tasks: Task[];
  employeeId: string;
  isAssigned: (task: Task) => boolean;
}): Task[] {
  return input.tasks.filter(
    (t) =>
      !t.deletedAt &&
      !UNSHIFTABLE.includes(t.status) &&
      t.deadline.dueAt !== null &&
      input.isAssigned(t),
  );
}

/** The due date after an approved emergency of `secs`. */
export function shiftedDueAt(dueAtIso: string, secs: number): string {
  return new Date(Date.parse(dueAtIso) + secs * 1000).toISOString();
}
