/**
 * Two orders of one queue, and what changed between them.
 *
 * ## Why this exists as a rule rather than in a component
 *
 * Three surfaces describe the same reorder: the confirmation the person making
 * the change presses, the receipt the person whose queue it is has to
 * acknowledge, and the record kept of it. If each assembled its own before/after
 * table, the confirmation could say "two deadlines move" while the receipt said
 * three — and the reader has no way to tell which is lying. There is one
 * function, and all three read it.
 *
 * ## The deadline in each order is supplied, never computed here
 *
 * `dueAt` on a snapshot row is the date that order produces, and it comes from
 * the same chain the write uses (`chainDeadlines` — `#recalculateQueueDeadlines`
 * writes exactly what it returns). This module measures the difference between
 * two answers; it never derives a date, because a second derivation is a second
 * answer to "when is this due".
 */

export interface QueueSnapshotRow {
  taskId: string;
  title: string;
  /** 1-based position in this order. */
  rank: number;
  /** The deadline this order produces. Null for a task with no dated commitment. */
  dueAt: string | null;
}

export interface PriorityDiffRow {
  taskId: string;
  title: string;
  /** Null when the task was not in the queue before. */
  previousRank: number | null;
  /** Null when the task is no longer in the queue. */
  newRank: number | null;
  previousDueAt: string | null;
  newDueAt: string | null;
  /**
   * Seconds the deadline moved. Positive is later, negative is earlier, 0 is
   * unmoved — and 0 is also what an undated task reports, because "no date did
   * not move" and "the date did not move" are the same fact to a reader.
   */
  shiftedBySecs: number;
  /** The position changed. Independent of the date, which may not have. */
  moved: boolean;
}

const secondsBetween = (from: string | null, to: string | null): number => {
  if (!from || !to) return 0;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 1000);
};

/**
 * Every task in either order, as one table.
 *
 * Ordered by where things END UP, because that is the list the reader is being
 * asked to accept. A task that has left the queue has no new rank and sorts to
 * the bottom, where it reads as an aside rather than as part of the new order.
 *
 * The title comes from the AFTER snapshot when there is one: a task renamed
 * between the two reads should be shown under the name it now has.
 */
export function diffQueues(
  before: readonly QueueSnapshotRow[],
  after: readonly QueueSnapshotRow[],
): PriorityDiffRow[] {
  const beforeById = new Map(before.map((r) => [r.taskId, r]));
  const afterById = new Map(after.map((r) => [r.taskId, r]));
  const ids = [...new Set([...after.map((r) => r.taskId), ...before.map((r) => r.taskId)])];

  const rows = ids.map((taskId) => {
    const was = beforeById.get(taskId) ?? null;
    const now = afterById.get(taskId) ?? null;
    return {
      taskId,
      title: now?.title ?? was?.title ?? taskId,
      previousRank: was?.rank ?? null,
      newRank: now?.rank ?? null,
      previousDueAt: was?.dueAt ?? null,
      newDueAt: now?.dueAt ?? null,
      shiftedBySecs: secondsBetween(was?.dueAt ?? null, now?.dueAt ?? null),
      /* A task that has only just entered the queue has not "moved" — there is
         no previous position for it to have moved from, and marking it as moved
         would put a P—→P3 chip on a row whose story is that it is new. */
      moved: was !== null && now !== null && was.rank !== now.rank,
    };
  });

  return rows.sort((a, b) => {
    if (a.newRank !== null && b.newRank !== null) return a.newRank - b.newRank;
    if (a.newRank !== null) return -1;
    if (b.newRank !== null) return 1;
    return (a.previousRank ?? 0) - (b.previousRank ?? 0);
  });
}

/**
 * Is this reorder a no-op?
 *
 * Compared as a SEQUENCE of ids, not as a set and not by rank: the question is
 * whether the queue would read differently, and two orders holding the same
 * tasks in the same sequence would not — however they were arrived at. Opening a
 * confirmation for a drag that put a row back where it started is how people
 * learn to press Confirm without reading it.
 */
export function isNoOpReorder(
  beforeIds: readonly string[],
  afterIds: readonly string[],
): boolean {
  if (beforeIds.length !== afterIds.length) return false;
  return beforeIds.every((id, i) => id === afterIds[i]);
}

export interface DiffSummary {
  /** Tasks whose position changed. */
  moved: number;
  /** Tasks whose deadline moved later. */
  delayed: number;
  /** Tasks whose deadline came earlier. */
  pulledEarlier: number;
  /** The largest single delay, in seconds. 0 when nothing was delayed. */
  worstDelaySecs: number;
  /** Tasks in the queue after the change. */
  total: number;
}

/**
 * The headline.
 *
 * Counted separately from `moved`, because a reorder can move five positions and
 * no deadline — the tasks below the one that was promoted absorb nothing if the
 * promoted task was already ahead of them. Reporting "5 deadlines moved" for
 * that change is the defect `priorityCascade.ts` was rewritten to fix, and
 * saying it in a different component would reintroduce it.
 */
export function summariseDiff(rows: readonly PriorityDiffRow[]): DiffSummary {
  const delays = rows.filter((r) => r.shiftedBySecs > 0).map((r) => r.shiftedBySecs);
  return {
    moved: rows.filter((r) => r.moved).length,
    delayed: delays.length,
    pulledEarlier: rows.filter((r) => r.shiftedBySecs < 0).length,
    worstDelaySecs: delays.length ? Math.max(...delays) : 0,
    total: rows.filter((r) => r.newRank !== null).length,
  };
}

/**
 * The task the reorder was ABOUT.
 *
 * A reorder is an INSERT, not a swap: somebody drags one row, and every row
 * between its old and new place shifts by exactly one to make room. So the
 * dragged task is the one whose rank changed by the most — in either direction.
 *
 * **Direction is not the tell, and assuming it was is a defect this function
 * shipped with.** Dragging a task to the bottom of a five-task queue moves it by
 * four and moves four others up by one each; a rule that looked for the biggest
 * PROMOTION would name one of those four and tell the reader that the task they
 * did not touch was the one that moved. Magnitude is the tell, because only the
 * dragged row can move by more than one.
 *
 * A straight swap of two adjacent rows moves both by one, and there is nothing
 * in the data to distinguish them. The promoted one wins, because "B was moved
 * above A" is how people describe that change.
 *
 * Naming this lets both dialogs lead with the change somebody made, instead of
 * listing eight rows and leaving the reader to find it.
 *
 * Null when nothing moved, or when the change is only an arrival or a removal.
 */
export function subjectOf(rows: readonly PriorityDiffRow[]): PriorityDiffRow | null {
  const movers = rows.filter(
    (r) => r.moved && r.previousRank !== null && r.newRank !== null,
  );
  if (movers.length === 0) return null;

  const distance = (r: PriorityDiffRow) => Math.abs(r.newRank! - r.previousRank!);
  const rose = (r: PriorityDiffRow) => r.newRank! < r.previousRank!;

  return movers.reduce((best, r) => {
    if (distance(r) !== distance(best)) return distance(r) > distance(best) ? r : best;
    if (rose(r) !== rose(best)) return rose(r) ? r : best;
    /* Still tied: the higher of the two, so the answer is stable rather than
       dependent on the order the rows arrived in. */
    return r.newRank! < best.newRank! ? r : best;
  });
}
