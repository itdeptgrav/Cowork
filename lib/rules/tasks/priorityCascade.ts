/**
 * What a priority change does to everybody else's deadlines.
 *
 * **The bug this replaces.** The cascade used to compute an ABSOLUTE finish
 * estimate — `now + all remaining work ahead of it` — and then refuse to pull a
 * deadline earlier:
 *
 *     computed  = now + cumulative remaining
 *     newDueAt  = max(computed, existingDueAt)
 *
 * Any queue with slack has committed deadlines further out than the realistic
 * finish, so `existingDueAt` won a every time and nothing ever moved. The
 * feature only fired when the queue was already tight enough for the estimate
 * to overtake the commitment — a narrow accident, not a rule. Meanwhile the
 * acknowledgement modal announced "N deadlines moved" over an empty list.
 *
 * **The rule now.** A deadline moves by the work that was NEWLY INSERTED ahead
 * of it — nothing else. Promote a four-hour task above two tasks and both move
 * four hours later, whatever slack they were carrying.
 *
 *     newDueAt = existingDueAt + (remaining work now ahead that was not before)
 *
 * That is relative, so it is independent of slack; it is never negative, so the
 * "never earlier" floor is a property rather than a guard; and it is zero for
 * anything the change did not displace.
 */

export interface CascadeQueueEntry {
  taskId: string;
  /** Rank before the change. 1 = highest. */
  previousRank: number;
  /** Rank after the change. */
  newRank: number;
  /**
   * Work still to do on this task, in seconds.
   *
   * What it contributes to the delay of everything below it. Already net of
   * time logged — a task half done displaces by its remainder, not its budget.
   */
  remainingSecs: number;
  /** Null for an undated task, which can neither shift nor be shifted. */
  dueAt: string | null;
}

export interface CascadeShift {
  taskId: string;
  previousDueAt: string;
  newDueAt: string;
  shiftedBySecs: number;
}

/**
 * How duration is added to a moment.
 *
 * Injected so the cascade does not own a calendar. Today the repository passes
 * wall-clock addition; once `OfficeCalendar` exists it passes
 * `addWorkingDuration` and every shift counts working hours only — with no
 * change to the logic below, which is the point of the seam.
 */
export type AddDuration = (fromIso: string, secs: number) => string;

/**
 * Seconds of work newly placed ahead of this task by the reorder.
 *
 * Set difference, not arithmetic on ranks: "ahead of me now, and not ahead of
 * me before". Rank arithmetic would double-count a task that was already ahead
 * and merely shuffled, and would miss one that jumped from far below.
 */
function insertedAheadSecs(
  entry: CascadeQueueEntry,
  all: readonly CascadeQueueEntry[],
): number {
  const aheadBefore = new Set(
    all
      .filter((e) => e.taskId !== entry.taskId && e.previousRank < entry.previousRank)
      .map((e) => e.taskId),
  );
  return all
    .filter(
      (e) =>
        e.taskId !== entry.taskId &&
        e.newRank < entry.newRank &&
        !aheadBefore.has(e.taskId),
    )
    .reduce((sum, e) => sum + Math.max(0, e.remainingSecs), 0);
}

/**
 * The deadline moves this reorder causes.
 *
 * Returns only tasks that actually move, so the count the acknowledgement shows
 * is the count that was persisted. An entry with no displacement, no due date,
 * or a zero-length displacement is absent rather than present-and-unchanged.
 */
export function cascadeShifts(input: {
  entries: readonly CascadeQueueEntry[];
  addDuration: AddDuration;
}): CascadeShift[] {
  const out: CascadeShift[] = [];

  for (const entry of input.entries) {
    /* Moved up, or did not move: nothing was inserted ahead of it that was not
       there before, so there is nothing to pay for. */
    if (entry.newRank <= entry.previousRank) continue;
    if (!entry.dueAt) continue;

    const displacement = insertedAheadSecs(entry, input.entries);
    if (displacement <= 0) continue;

    const newDueAt = input.addDuration(entry.dueAt, displacement);
    /* Guaranteed forward by construction — displacement is non-negative and
       `addDuration` only advances. Asserted rather than assumed because a
       future calendar implementation is the kind of thing that could regress
       it silently. */
    if (Date.parse(newDueAt) <= Date.parse(entry.dueAt)) continue;

    out.push({
      taskId: entry.taskId,
      previousDueAt: entry.dueAt,
      newDueAt,
      shiftedBySecs: displacement,
    });
  }

  return out;
}

/** Wall-clock addition. The stand-in until `OfficeCalendar` lands. */
export const addWallClockDuration: AddDuration = (fromIso, secs) =>
  new Date(Date.parse(fromIso) + secs * 1000).toISOString();

/**
 * How close together two cascades count as the same event.
 *
 * A cascade can be observed more than once — a drag that settles and re-renders,
 * a double-submit, a retry — and each observation would otherwise push another
 * record and another notification for a shift that happened once. Two minutes is
 * legacy's own de-bounce window for the priority-conflict check.
 */
export const CASCADE_DEDUP_WINDOW_MS = 2 * 60 * 1000;

/**
 * Is `candidate` the same cascade as one already recorded, seen again within the
 * window?
 *
 * Identity is whose queue moved, what triggered it, and why — not the effects,
 * which may legitimately differ between two computations of the same reorder as
 * other work advances. The window is compared on `createdAt`, so a caller with a
 * deterministic clock (a test) and the real one agree on what "recently" means.
 */
export function isDuplicateCascade(
  candidate: { employeeId: string; triggeringTaskId: string; reason: string },
  existing: readonly {
    employeeId: string;
    triggeringTaskId: string;
    reason: string;
    createdAt: string;
  }[],
  nowMs: number,
): boolean {
  return existing.some(
    (c) =>
      c.employeeId === candidate.employeeId &&
      c.triggeringTaskId === candidate.triggeringTaskId &&
      c.reason === candidate.reason &&
      nowMs - Date.parse(c.createdAt) < CASCADE_DEDUP_WINDOW_MS,
  );
}
