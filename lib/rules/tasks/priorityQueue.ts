import { isBudgetSettled } from "./activeQueue.ts";
import { isRealRank, MAX_RANK, MIN_RANK } from "./resolveTaskPriority.ts";

/**
 * **One person's priority queue: what is in it, in what order, at what rank.**
 *
 * The rule, in one line: *priority belongs to active workload, and an active
 * queue is 1..N with no gaps and no repeats.*
 *
 * ## What was broken, precisely
 *
 * The DERIVATION was already sound — `activeQueuePositions` numbers by array
 * index, so it cannot emit a duplicate or a gap. The **stored ranks** are not,
 * and they are what everybody except the queue owner reads:
 *
 * - Legacy writes `assigneePriorities[id] = that person's open-task count + 1`
 *   per assignee, independently, at assignment time. Two tasks created before
 *   either was counted both get the same number.
 * - Nothing ever normalised the set. A completed task keeps its rank, so the
 *   live work below it sits at 3 and 5 with nothing at 2 or 4.
 * - A list read fetches only the VIEWER's queue, so a manager reading a report's
 *   tasks falls through to those raw stored numbers — duplicates, gaps and all.
 *
 * So the derivation papered over bad data for exactly one person and for nobody
 * else. This module makes the stored data satisfy the invariant instead of
 * compensating for it, and is the single place the invariant is expressed.
 *
 * ## Active is about ACCEPTANCE, not only about status
 *
 * `assigned` is the awaiting-acceptance state — and it is **also** the fallback
 * for any legacy status the mapper does not recognise. So excluding the status
 * would silently drop unknown-status work out of every queue, which is a
 * different bug wearing this fix's clothes.
 *
 * The precise test is the confirmation fact: a person's own
 * `TaskAssignment.confirmedAt`. Work reaching `in_progress` or beyond proves
 * acceptance happened — legacy's `confirmed` maps to `in_progress` — so those
 * statuses need no separate evidence.
 */

/** One candidate for a person's queue. Only what the rule reads. */
export interface QueueCandidate {
  taskId: string;
  /** The DOMAIN status. Legacy's raw field stays `open` through a review. */
  status: string;
  /** This person's stored rank, or null where none was ever written. */
  storedRank: number | null;
  /** Legacy's tie-break, `(index + 1) * 1000`, from the drag handler. */
  order?: number | null;
  /** Last-resort tie-break, epoch ms, so the sort is total and stable. */
  createdAtMs?: number | null;
  /** The budget negotiation's state, where the task has one. */
  budgetState?: string | null;
  /**
   * Whether THIS person has accepted the work.
   *
   * From their own `TaskAssignment.confirmedAt`. Undefined means unknown, which
   * is treated as **not accepted** for a status that has not passed acceptance —
   * a queue must not be padded on an assumption.
   */
  accepted?: boolean;
}

/**
 * Statuses that can hold a slot, given acceptance.
 *
 * `in_review` is here because submitted work can come back as rework, and a task
 * that may return to your desk has not left your queue. `deadline_negotiation` is
 * accepted work whose date is being agreed — still owned workload.
 */
const ACTIVE_STATUSES = new Set([
  "assigned",
  "deadline_negotiation",
  "confirmed",
  "in_progress",
  "in_review",
]);

/**
 * Statuses that prove acceptance already happened.
 *
 * Legacy's `confirmed` maps to `in_progress`, and nothing reaches `in_review`
 * without having been worked on. Asking for a `confirmedAt` on these would drop
 * work somebody is actively doing out of their own queue.
 */
const ACCEPTANCE_IMPLIED = new Set([
  "confirmed",
  "in_progress",
  "in_review",
  "deadline_negotiation",
]);

/**
 * Excluded outright, and named so the list is auditable rather than implied.
 *
 * `pending_approval` needs no clause of its own — a task at a cross-department
 * gate carries no assignees to build a queue from, the gate parking the person in
 * `pendingAssigneeId` precisely so the work is not yet theirs.
 */
export const INACTIVE_STATUSES = [
  "draft",
  "pending_approval",
  "completed",
  "cancelled",
  "assignment_rejected",
] as const;

/**
 * Does this task consume one of this person's priority slots?
 *
 * Three conditions, and each one has produced a real defect on its own:
 *
 *  1. **A live status.** A completed task keeping slot 1 for ever is what made
 *     the next thing to do read "P2" with no P1 to be found.
 *  2. **A settled budget.** A task whose hours are still being argued over sat
 *     ahead of work that was ready to start and pushed everything below it down.
 *  3. **Accepted by this person.** Work nobody has taken on is not yet workload,
 *     and letting it hold a slot means accepted work is ranked behind something
 *     that may never be accepted at all.
 */
export function isActiveWorkload(candidate: QueueCandidate): boolean {
  if (!ACTIVE_STATUSES.has(candidate.status)) return false;
  if (!isBudgetSettled(candidate.budgetState)) return false;
  if (ACCEPTANCE_IMPLIED.has(candidate.status)) return true;
  return candidate.accepted === true;
}

/**
 * This person's active workload, in no particular order.
 *
 * Filtering only. The caller supplies the candidates because deciding WHOSE
 * tasks these are is a query, not a rule — and a rule that fetched would be
 * untestable without a store.
 */
export function getActiveTasksForUser(
  candidates: QueueCandidate[],
): QueueCandidate[] {
  return candidates.filter(isActiveWorkload);
}

/**
 * The order the queue should be in, as task ids.
 *
 * **Stored rank first**, so an explicit ranking a manager set is never
 * overridden — this closes gaps rather than re-deciding priorities. Then
 * legacy's `order` tie-break, so two tasks sharing a rank keep the sequence they
 * were dragged into. Then oldest-first, because where nothing else distinguishes
 * two tasks the one that has been waiting longer goes first. Then the id, so the
 * sort is total and the same input always gives the same output.
 *
 * That last clause is what makes this safe to persist: an unstable sort would
 * renumber the queue differently on each call and write a change every time.
 */
export function calculatePriorityOrder(candidates: QueueCandidate[]): string[] {
  return [...getActiveTasksForUser(candidates)]
    .sort((a, b) => {
      /* An unranked task sorts to the BOTTOM. `MAX_RANK + 1` rather than
         legacy's 999 sentinel: the comparison only needs to lose to every real
         rank, and using the sentinel invited somebody to read it as a position. */
      const ra = isRealRank(a.storedRank) ? a.storedRank : MAX_RANK + 1;
      const rb = isRealRank(b.storedRank) ? b.storedRank : MAX_RANK + 1;
      if (ra !== rb) return ra - rb;

      const oa = a.order ?? Number.MAX_SAFE_INTEGER;
      const ob = b.order ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;

      const ca = a.createdAtMs ?? 0;
      const cb = b.createdAtMs ?? 0;
      if (ca !== cb) return ca - cb;

      return a.taskId.localeCompare(b.taskId);
    })
    .map((c) => c.taskId);
}

/**
 * Ranks for an ordered queue: 1, 2, 3 … N.
 *
 * **Continuous and unique by construction**, because it numbers by index. There
 * is deliberately no way to pass a rank in — that is what let two tasks hold P1.
 *
 * Not clamped to `MAX_RANK`. A person with twelve active tasks has a twelfth
 * position, and clamping would put two tasks at 10; the 1–10 bound is on what a
 * manager may TYPE, enforced by `clampRank` on the write, not on how long a queue
 * may be.
 */
export function assignPriorityRanks(orderedTaskIds: string[]): Map<string, number> {
  const ranks = new Map<string, number>();
  orderedTaskIds.forEach((taskId, i) => ranks.set(taskId, i + MIN_RANK));
  return ranks;
}

export interface NormalisedQueue {
  /** The queue in order, as task ids. */
  order: string[];
  /** The rank each active task should carry. Always 1..N. */
  ranks: Map<string, number>;
  /**
   * Only the tasks whose stored rank is wrong, with both values.
   *
   * The unit of a write: sending the whole queue every time would touch
   * documents that already agree, and an audit trail of no-op writes is one
   * nobody reads.
   */
  changes: { taskId: string; from: number | null; to: number }[];
  /** True when the stored ranks already satisfy the invariant. */
  isNormal: boolean;
  /**
   * Active tasks carrying a duplicate stored rank, for a diagnostic.
   *
   * Reported rather than merely fixed: a duplicate means two tasks were ranked
   * without either knowing about the other, and knowing how often that happens
   * is how the cause gets found.
   */
  duplicates: number[];
  /** Ranks missing from the stored sequence — the gaps. */
  gaps: number[];
}

/**
 * What this person's queue SHOULD be, and which stored ranks disagree.
 *
 * **Returns the work rather than doing it.** A pure function so the same
 * calculation serves the preview, the write and the test — and so persisting is
 * the repository's decision, made once, rather than a side effect of a read.
 *
 * Inactive tasks are absent from `ranks` entirely and are never renumbered. A
 * completed task keeps the rank it finished with: it is a record, it renders as
 * "was P3", and pulling it into the renumbering would rewrite history to make
 * room for live work.
 */
export function normalizePriorityQueue(
  candidates: QueueCandidate[],
): NormalisedQueue {
  const active = getActiveTasksForUser(candidates);
  const order = calculatePriorityOrder(candidates);
  const ranks = assignPriorityRanks(order);

  const storedById = new Map(active.map((c) => [c.taskId, c.storedRank]));
  const changes: NormalisedQueue["changes"] = [];
  for (const [taskId, to] of ranks) {
    const from = storedById.get(taskId) ?? null;
    if (from !== to) changes.push({ taskId, from, to });
  }

  /* The diagnostic, computed over the STORED ranks — the derived ones cannot
     have duplicates, so counting those would always report health. */
  const seen = new Map<number, number>();
  for (const c of active) {
    if (!isRealRank(c.storedRank)) continue;
    seen.set(c.storedRank, (seen.get(c.storedRank) ?? 0) + 1);
  }
  const duplicates = [...seen.entries()]
    .filter(([, n]) => n > 1)
    .map(([rank]) => rank)
    .sort((a, b) => a - b);

  const gaps: number[] = [];
  for (let r = MIN_RANK; r <= active.length; r += 1) {
    if (!seen.has(r)) gaps.push(r);
  }

  return {
    order,
    ranks,
    changes,
    isNormal: changes.length === 0,
    duplicates,
    gaps,
  };
}

/**
 * Is this person's stored queue already valid?
 *
 * Separate from `normalizePriorityQueue` so a caller can ask cheaply without
 * reading the result as an instruction to write.
 */
export function isQueueNormal(candidates: QueueCandidate[]): boolean {
  return normalizePriorityQueue(candidates).isNormal;
}

/**
 * One sentence describing what is wrong with a queue, or null.
 *
 * For a diagnostic surface rather than for a user's task list — somebody whose
 * ranks are duplicated has not done anything wrong, and the sentence says what
 * happened rather than asking them to fix it.
 */
export function describeQueueFault(queue: NormalisedQueue): string | null {
  if (queue.isNormal) return null;
  const parts: string[] = [];
  if (queue.duplicates.length > 0) {
    parts.push(
      `${queue.duplicates.length === 1 ? "rank" : "ranks"} ${queue.duplicates
        .map((r) => `P${r}`)
        .join(", ")} held by more than one task`,
    );
  }
  if (queue.gaps.length > 0) {
    parts.push(`nothing at ${queue.gaps.map((r) => `P${r}`).join(", ")}`);
  }
  if (parts.length === 0) {
    parts.push("the stored order does not match the queue");
  }
  return `This queue is being renumbered: ${parts.join("; ")}.`;
}
