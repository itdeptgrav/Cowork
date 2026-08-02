import type { TaskStatus } from "@/lib/domain";
/* From `priorityDeadline`, not `priorityDisplay`: that module now reads
   `isActiveInQueue` from here, and importing it back would be a cycle. Both
   hold the same legacy sentinel, and `priorityDeadline` imports nothing. */
import { UNRANKED_SENTINEL as UNRANKED } from "./priorityDeadline.ts";
import {
  assignPriorityRanks,
  calculatePriorityOrder,
  calculateProvisionalOrder,
  isActiveWorkload,
} from "./priorityQueue.ts";

/**
 * P1, P2, P3 over the tasks a person can actually act on.
 *
 * **The fault.** A rank was stored per person per task
 * (`assigneePriorities[employeeId]`) and displayed raw. Nothing rewrites it
 * when a task finishes, so a completed P1 kept slot 1 for ever and the queue
 * below it never moved up: the next thing to do read "P2", and there was no P1
 * to be found. The numbers stopped describing the day.
 *
 * **The fix is a derivation, not a migration.** The stored rank stays exactly
 * as its manager set it and remains the SORT KEY; what a person sees is their
 * position among the tasks still in play. Closing a task therefore renumbers
 * nothing — the gap simply stops being rendered.
 *
 * That choice is deliberate, and it is the reason the numbers survive a
 * refresh, a new session, and another person opening the same task: every
 * viewer derives the same positions from the same stored ranks. Renumbering on
 * completion instead would mean a write racing every other completion, a
 * half-applied batch leaving two tasks holding one rank, and a queue whose
 * order depends on whose browser happened to witness the transition.
 *
 * **Nothing here decides a lifecycle.** `isActiveInQueue` reads the status the
 * engine set; it never sets one.
 */

/**
 * Statuses that occupy a slot in somebody's queue.
 *
 * The test is "can this person act on it today", which is why `in_review` is
 * here — the work is submitted but can still come back as rework, and a task
 * that may return to your desk has not left your queue. `draft` is not: it has
 * not been given to anybody. `pending_approval` needs no clause at all, because
 * a task held at a cross-department gate carries no assignees to build a queue
 * from — the gate parks the person in `pendingAssigneeId` precisely so the work
 * is not yet theirs.
 */
const ACTIVE_STATUSES: readonly TaskStatus[] = [
  "assigned",
  "deadline_negotiation",
  "confirmed",
  "in_progress",
  "in_review",
];

/**
 * Is the task LIVE rather than closed? A question about the status alone.
 *
 * **Distinct from `isActiveWorkload`, and the difference matters.** This asks
 * whether a task has finished; that asks whether it consumes one of a person's
 * priority slots, which additionally requires a settled budget and the assignee
 * having accepted it.
 *
 * A task assigned but not yet accepted is LIVE (so its priority is not a
 * historic record) and is NOT workload (so it holds no slot). Collapsing the two
 * would either mark unaccepted work as "was P3" or let it push accepted work
 * down a place — both of which have happened.
 */
export function isActiveInQueue(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

/**
 * Is the time budget settled, so the work can actually be planned?
 *
 * **A task whose budget is still being argued about must not hold a priority
 * slot.** `open` and `pending_deadline_approval` both map to `assigned`, which
 * is an active status — so a task nobody had agreed the hours for was sitting
 * in the queue ahead of work that was ready to start, and pushed every task
 * below it down a place.
 *
 * `null` means there is nothing to settle: a fixed-deadline task has no budget
 * negotiation and is ready the moment it is assigned. Only a task that HAS a
 * negotiation has to finish it.
 *
 * Keyed on the negotiation state rather than on a due date existing. The state
 * is the authority — the engine stamps the date as a separate event, and a task
 * that has just been agreed would otherwise drop out of the queue for as long
 * as that took.
 */
export function isBudgetSettled(
  budgetState: string | null | undefined,
): boolean {
  if (!budgetState) return true;
  return budgetState === "ACCEPTED";
}

export interface QueueEntry {
  taskId: string;
  status: string;
  /** The employee's stored rank, or null where none was ever written. */
  storedRank: number | null;
  /**
   * Legacy's tie-break, `(index + 1) * 1000`, written by the drag handler
   * alongside the rank. Preserved so two tasks sharing a rank keep the order a
   * manager dragged them into rather than falling back to whatever the
   * directory returned first.
   */
  order?: number | null;
  /** Last resort tie-break, epoch ms, so the sort is total and stable. */
  createdAtMs?: number | null;
  /**
   * The time-budget negotiation's state, where the task has one.
   *
   * Absent or null means nothing to settle — a fixed-deadline task. Anything
   * other than `ACCEPTED` keeps the task OUT of the queue: it cannot be planned
   * against hours nobody has agreed.
   */
  budgetState?: string | null;
  /** This task has been broken down and holds no slot. See `priorityQueue.ts`. */
  isContainer?: boolean;
}

/**
 * Where each active task sits in this person's queue, numbered from 1.
 *
 * Inactive tasks are absent from the result entirely rather than mapped to
 * null: a caller that asks for a closed task's queue position is asking the
 * wrong question, and an absent key says so more clearly than a null.
 *
 * The sort is by stored rank first, so an explicit ranking is never overridden
 * — this only closes the gaps that closed tasks left behind.
 */
export function activeQueuePositions(entries: QueueEntry[]): Map<string, number> {
  /*
   * **Delegated to `priorityQueue.ts`.** The filter and the sort lived here and
   * were the only expression of "what counts as active workload" — which meant
   * the rule could not be applied to a WRITE without re-typing it, and a
   * normaliser that re-typed it would eventually disagree with the reader.
   *
   * `assignPriorityRanks` numbers by index, so the result is 1..N with no gaps
   * and no duplicates by construction, exactly as before.
   */
  return assignPriorityRanks(calculatePriorityOrder(entries));
}

/**
 * P1, P2, P3 over the work that is real but has not cleared the active queue —
 * a task awaiting acceptance, or one whose budget is still being negotiated.
 *
 * **A second, independent sequence, not an extension of `activeQueuePositions`.**
 * The two answer different questions and must not be merged: the active queue
 * is "what you have committed to, in order"; this is "among what has not been
 * committed to yet, what order is it in". Folding a pending task into the
 * SAME numbering as accepted work would let it push an already-accepted
 * task's displayed position down — exactly the failure the active queue's own
 * acceptance requirement exists to prevent. So a task is numbered by EXACTLY
 * one of the two functions, never both, and `calculateProvisionalOrder`
 * enforces the split.
 *
 * Before this existed, a pending task's number came from the raw stored rank
 * with no derivation at all — which is where a broken-down task's leftover
 * rank surfaced as a missing sibling: three real subtasks stored 1, 3, 5
 * because two containers occupied 2 and 4, and nothing closed the gap the way
 * a finished task's gap has always been closed here.
 */
export function provisionalQueuePositions(
  entries: QueueEntry[],
): Map<string, number> {
  return assignPriorityRanks(calculateProvisionalOrder(entries));
}

/**
 * What to show on one task: a live position, or the rank it closed holding.
 *
 * The two are different claims and the UI must not print them the same way. A
 * closed task's number is a record of what it was, and labelling it "P1" beside
 * a live P1 would put two first-priorities on one screen.
 */
export interface QueueRank {
  /** Position among tasks still in play. Null once the task has closed. */
  activeRank: number | null;
  /**
   * The stored rank, whatever the status.
   *
   * For a closed task this is what it was carrying when it closed, and is the
   * only priority record that survives — no per-change history is persisted
   * (`listPriorityChanges`), so this is a last-known value rather than a
   * reconstructed one, and the UI says "was" rather than claiming a position.
   */
  storedRank: number | null;
  isActive: boolean;
}

export function queueRankFor(
  entry: QueueEntry,
  positions: Map<string, number>,
): QueueRank {
  /* The one membership rule, not a re-typed pair of conditions. */
  const isActive = isActiveWorkload(entry);
  return {
    activeRank: isActive ? (positions.get(entry.taskId) ?? null) : null,
    storedRank:
      entry.storedRank !== null && entry.storedRank !== UNRANKED
        ? entry.storedRank
        : null,
    isActive,
  };
}

/** Legacy clamps a rank to 1..10 (`handleUpdatePriority`). */
export const MAX_STORED_RANK = 10;

/**
 * The rank a NEW task should be stored with, so it lands at the bottom.
 *
 * **Highest active rank plus one, not the active COUNT plus one.** The engine
 * counts (`taskForward.js:303`), and a count collides the moment a queue has
 * gaps — three active tasks ranked 5, 6, 7 give a count of 3, so the new task
 * is stored at 4 and lands ABOVE all of them. Gaps are not hypothetical:
 * closing a task leaves one by design, and production queues carry them.
 *
 * Closed tasks are excluded, which is the other half of the same bug. The
 * engine's query filters on `status not-in [done, cancelled]` alone, and legacy
 * leaves `status` at `open` through an entire review cycle — so approved work
 * was still counted, and every new task started further down than it should.
 *
 * Nothing else is renumbered. A new task is one write, and reshuffling a queue
 * because somebody was given more work would move tasks their manager had
 * deliberately ordered.
 */
export function nextActiveRank(entries: QueueEntry[]): number {
  const ranks = entries
    .filter(isActiveWorkload)
    .map((e) => e.storedRank)
    .filter((r): r is number => typeof r === "number" && Number.isFinite(r));

  if (ranks.length === 0) return 1;

  /* Clamped, because the scale is 1..10 and a rank of 11 is not a rank at all —
     the display layer treats anything outside the range as unranked, so an
     eleventh task would render with no priority rather than last. Landing on a
     duplicate 10 is harmless: the tie-break puts the newer task after the
     older, which is exactly where a new task belongs. */
  return Math.min(MAX_STORED_RANK, Math.max(...ranks) + 1);
}

/**
 * Does this task count toward somebody's WORKLOAD?
 *
 * **Three predicates in this area, and they answer three different questions.**
 * Naming them apart is deliberate — collapsing any two has produced a real
 * defect:
 *
 * | Predicate | Question | Requires |
 * |---|---|---|
 * | `isActiveInQueue` | is it live rather than closed? | a live status |
 * | `isActivePriorityTask` | does it count as work on somebody's plate? | + a settled budget |
 * | `isActiveWorkload` | does it hold a priority SLOT? | + accepted by that person |
 *
 * This one deliberately does **not** require acceptance. Work assigned to you and
 * not yet accepted is still work heading your way, and a roster that hid it would
 * show a person as free the day before eight tasks land on them. The surfaces
 * calling this count a whole team and have no per-person assignment row to read.
 *
 * A priority SLOT is the stricter question, because an unaccepted task ranked
 * ahead of accepted work pushes work somebody has committed to down a place for
 * something that may never be accepted at all. That is `isActiveWorkload`.
 *
 * Both halves here, always: a live status AND a settled budget. Counting tasks
 * whose hours nobody has agreed inflates a workload with work that has not been
 * committed to — capacity shown as blocked, an extra active task, and hours that
 * may still change.
 *
 * Takes the view rather than loose fields so a caller cannot pass one and forget
 * the other, which is exactly how "status !== completed" became four separate
 * definitions of active across the product.
 */
export function isActivePriorityTask(view: {
  task: { status: string };
  budgetNegotiation?: { state: string } | null;
}): boolean {
  return (
    isActiveInQueue(view.task.status) &&
    isBudgetSettled(view.budgetNegotiation?.state ?? null)
  );
}
