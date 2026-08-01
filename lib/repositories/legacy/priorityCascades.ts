import type {
  CascadeEffect,
  CascadeOrderEntry,
  PriorityCascade,
} from "../../domain/priority.ts";

/**
 * The receipt a reorder leaves, in the engine's own storage.
 *
 * ## The premise this file was written to correct
 *
 * This repository asserted, in three separate comments, that "legacy neither
 * computes nor stores a priority cascade" and that an empty
 * `listPendingAcknowledgements` was therefore *the true answer*. It is not.
 * `grav-cms-backend/services/taskForward.service.js` writes a record per shifted
 * task into `cowork_tasks.deadlineAutoExtendedHistory[]` — carrying `oldPriority`,
 * `newPriority`, `oldDeadline`, `newDeadline`, the reason, who changed it, and
 * `acknowledgedByEmployee: false` — and the old frontend's own
 * `PriorityChangeAckModal.jsx` reads exactly that and flips the flag on Confirm.
 *
 * So the concept exists, the storage exists, and the old app is still reading
 * it. Inventing a parallel collection would have left two products keeping two
 * separate records of one event, and an employee acknowledging in one would
 * still be shown the modal by the other.
 *
 * ## The grouping key is legacy's
 *
 * `shiftedByTaskId|at` — every task bumped by one action carries the same pair,
 * which is what turns N per-task entries into ONE receipt. Copied rather than
 * improved on, because the old modal groups by it too and the two must agree
 * about what counts as a single event.
 *
 * ## Two fields are ours, and additive
 *
 * `queueBefore` / `queueAfter` carry the whole order, which legacy never stored
 * because its modal only ever listed the tasks that moved. Unknown keys are
 * ignored by the old app — the same additive-field argument the presence
 * document already rests on — so writing them costs the old modal nothing and
 * gives this one the before/after the product now shows.
 */

/** One task's deadline move, as the queue recalculation reports it. */
export interface QueueDeadlineMove {
  taskId: string;
  title: string;
  previousDueAt: string | null;
  newDueAt: string;
}

/** Legacy's own trigger vocabulary. Ours is named apart from `p1_conflict_check`. */
export const REORDER_TRIGGER = "priority_reorder";

export const HISTORY_FIELD = "deadlineAutoExtendedHistory";

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * One stored history entry, in the shape the engine writes.
 *
 * Deliberately tolerant: entries written by the engine's own P1 path, by the old
 * frontend, and by this app all land in the same array and must all be readable.
 */
export interface StoredCascadeEntry {
  shiftedByTaskId: string;
  shiftedByTaskTitle: string;
  at: string;
  reason: string | null;
  changedByName: string | null;
  changedById?: string | null;
  acknowledgedByEmployee: boolean;
  oldPriority: number | null;
  newPriority: number | null;
  oldDeadline: string | null;
  newDeadline: string | null;
  extendedByHrs: number | null;
  workedHrsAtExtension?: number | null;
  queueBefore?: CascadeOrderEntry[];
  queueAfter?: CascadeOrderEntry[];
}

export function readEntry(raw: unknown): StoredCascadeEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const shiftedByTaskId = str(r.shiftedByTaskId);
  const at = str(r.at);
  /* Without both, the entry cannot be grouped into a receipt — and a receipt
     that cannot be grouped would be raised once per task, which is the wall of
     modals legacy's own grouping key exists to prevent. */
  if (!shiftedByTaskId || !at) return null;
  return {
    shiftedByTaskId,
    shiftedByTaskTitle: str(r.shiftedByTaskTitle, shiftedByTaskId),
    at,
    reason: typeof r.reason === "string" ? r.reason : null,
    changedByName: typeof r.changedByName === "string" ? r.changedByName : null,
    changedById: typeof r.changedById === "string" ? r.changedById : null,
    /* Only an explicit `false` is unacknowledged. An entry missing the field was
       written by something that does not participate in acknowledgement, and
       raising a blocking modal for it would trap somebody in a receipt nothing
       can clear. */
    acknowledgedByEmployee: r.acknowledgedByEmployee !== false,
    oldPriority: num(r.oldPriority),
    newPriority: num(r.newPriority),
    oldDeadline: typeof r.oldDeadline === "string" ? r.oldDeadline : null,
    newDeadline: typeof r.newDeadline === "string" ? r.newDeadline : null,
    extendedByHrs: num(r.extendedByHrs),
    workedHrsAtExtension: num(r.workedHrsAtExtension),
    queueBefore: readOrder(r.queueBefore),
    queueAfter: readOrder(r.queueAfter),
  };
}

function readOrder(raw: unknown): CascadeOrderEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const taskId = str(r.taskId);
      const rank = num(r.rank);
      if (!taskId || rank === null) return null;
      return {
        taskId,
        taskTitle: str(r.taskTitle, taskId),
        rank,
        dueAt: typeof r.dueAt === "string" ? r.dueAt : null,
      };
    })
    .filter((r): r is CascadeOrderEntry => r !== null)
    .sort((a, b) => a.rank - b.rank);
}

/** The grouping key. Legacy's, verbatim. */
export const groupKey = (entry: StoredCascadeEntry): string =>
  `${entry.shiftedByTaskId}|${entry.at}`;

/**
 * Turn one group of entries into the receipt.
 *
 * `id` is the group key rather than a generated value, so acknowledging can find
 * the same entries again without a second store mapping cascade ids to tasks.
 */
export function cascadeFromEntries(input: {
  employeeId: string;
  entries: { entry: StoredCascadeEntry; taskId: string; taskTitle: string }[];
}): PriorityCascade | null {
  const first = input.entries[0];
  if (!first) return null;
  const head = first.entry;

  const effects: CascadeEffect[] = input.entries.map(({ entry, taskId, taskTitle }) => ({
    taskId,
    taskTitle,
    previousRank: entry.oldPriority ?? 0,
    newRank: entry.newPriority ?? 0,
    previousDueAt: entry.oldDeadline,
    newDueAt: entry.newDeadline,
    /* The engine records a budget extension as an hours string rather than a
       window, and this app has no field for the pair. Null is the honest answer
       — "not stated" — rather than a zero that reads as "unchanged". */
    previousWindowSecs: null,
    newWindowSecs: null,
    shiftedBySecs: Math.max(0, Math.round((entry.extendedByHrs ?? 0) * 3600)),
    creditedWorkedSecs: Math.max(
      0,
      Math.round((entry.workedHrsAtExtension ?? 0) * 3600),
    ),
  }));

  return {
    id: groupKey(head),
    triggeringTaskId: head.shiftedByTaskId,
    triggeringTaskTitle: head.shiftedByTaskTitle,
    employeeId: input.employeeId,
    /* Legacy allowed a null reason on paths other than the drag. Said plainly
       rather than left blank, because an empty panel headed "Reason given"
       reads as a missing value rather than an absent one. */
    reason: head.reason ?? "No reason was given.",
    changedById: head.changedById ?? "",
    changedByName: head.changedByName ?? "Your manager",
    effects,
    previousOrder: head.queueBefore ?? [],
    newOrder: head.queueAfter ?? [],
    createdAt: head.at,
    acknowledgedAt: null,
  };
}

/** The entry this app writes. Legacy's keys, plus the two additive ones. */
export function entryFor(input: {
  move: QueueDeadlineMove;
  triggeringTaskId: string;
  triggeringTaskTitle: string;
  previousRank: number | null;
  newRank: number | null;
  reason: string;
  changedById: string;
  changedByName: string;
  at: string;
  queueBefore: CascadeOrderEntry[];
  queueAfter: CascadeOrderEntry[];
}): Record<string, unknown> {
  const shiftedSecs =
    input.move.previousDueAt === null
      ? 0
      : Math.max(
          0,
          Math.round(
            (Date.parse(input.move.newDueAt) - Date.parse(input.move.previousDueAt)) /
              1000,
          ),
        );
  return {
    shiftedByTaskId: input.triggeringTaskId,
    shiftedByTaskTitle: input.triggeringTaskTitle,
    oldDeadline: input.move.previousDueAt,
    newDeadline: input.move.newDueAt,
    oldPriority: input.previousRank,
    newPriority: input.newRank,
    extendedByHrs: +(shiftedSecs / 3600).toFixed(2),
    at: input.at,
    trigger: REORDER_TRIGGER,
    reason: input.reason || null,
    changedByName: input.changedByName || null,
    changedById: input.changedById || null,
    acknowledgedByEmployee: false,
    queueBefore: input.queueBefore,
    queueAfter: input.queueAfter,
  };
}
