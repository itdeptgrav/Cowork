/**
 * The one read of a task's priority for a person.
 *
 * **Legacy's own expression, written once.** `page.js` reads
 * `assigneePriorities[me] ?? priority ?? 999` and nothing else. That line had
 * been re-typed in the queue builder, the deadline chain, the mapper's
 * assignment ranks and the display resolver — four copies of one rule, which is
 * four chances for a manager's screen and an employee's screen to disagree
 * about the same task.
 *
 * They did disagree, and worse than that: the number was missing entirely for
 * the person actually holding the work. See `PENDING` below.
 *
 * ## Whose number
 *
 * A shared task carries ONE `priority` for everybody and a per-person entry in
 * `assigneePriorities`. Reading `priority` for a named person would order their
 * day by a colleague's queue position, so the map always wins where it has an
 * entry. The bare `priority` is the fallback, exactly as legacy has it.
 *
 * ## The scale
 *
 * 1–10, 1 highest. `999` means "never written" — legacy's sentinel, not a
 * priority somebody chose. `0` is not on the scale either. Both resolve to
 * null through `isRealRank`, so a screen shows a dash rather than inventing a
 * P0 that reads as most-urgent.
 */

/** Legacy's "no rank recorded" sentinel. */
export const UNRANKED = 999;
export const MIN_RANK = 1;
export const MAX_RANK = 10;

/** Only the fields the rule reads, so any shape of task document fits. */
export interface PriorityCarrier {
  /* `unknown`, because the field is untyped at the source — a legacy document
     may hold anything here, and the guard below is what makes it safe. */
  assigneePriorities?: unknown;
  priority?: unknown;
}

/** Is this a rank a person could have been given? */
export function isRealRank(value: number | null | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_RANK &&
    value <= MAX_RANK
  );
}

/**
 * This person's stored rank on this task, or `UNRANKED`.
 *
 * Never null: callers that sort need a number for every task, and `UNRANKED`
 * sorts to the bottom the way legacy intends. Callers that DISPLAY should pass
 * the result through `isRealRank` — 999 is an absence, not a position.
 */
export function resolveTaskPriority(
  task: PriorityCarrier,
  employeeId: string | null | undefined,
): number {
  const map =
    task.assigneePriorities && typeof task.assigneePriorities === "object"
      ? (task.assigneePriorities as Record<string, unknown>)
      : null;
  const mine = employeeId != null && map ? num(map[employeeId]) : null;
  if (mine !== null) return mine;
  return num(task.priority) ?? UNRANKED;
}

/**
 * A number, or nothing.
 *
 * `Number()` alone will not do: `Number(null)` and `Number("")` are both **0**,
 * and 0 is finite. A missing entry therefore resolved to P0 — off the bottom of
 * the 1–10 scale and, because it is the smallest number, sorted AHEAD of every
 * real priority. Legacy's `??` treats null as absent and so does this.
 */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The same read, but null where nothing displayable was ever written. */
export function displayablePriority(
  task: PriorityCarrier,
  employeeId: string | null | undefined,
): number | null {
  const rank = resolveTaskPriority(task, employeeId);
  return isRealRank(rank) ? rank : null;
}

/**
 * Everyone who holds this task, whether or not the handover has happened.
 *
 * **PENDING.** A cross-department task waiting at the approval gate keeps its
 * assignee in `pendingAssigneeId` and has an EMPTY `assigneeIds`. Every read
 * keyed on `assigneeIds` therefore returned nothing for the one person whose
 * queue the work is actually in: no rank on their own task, no queue position,
 * and no place in the chain that decides when they will start it.
 *
 * That is not a display problem. It is the same person being absent from the
 * data the whole product plans around.
 */
export function holdersOf(task: {
  assigneeIds?: string[] | null;
  pendingAssigneeIds?: string[] | null;
}): string[] {
  const out: string[] = [];
  for (const id of [
    ...(task.assigneeIds ?? []),
    ...(task.pendingAssigneeIds ?? []),
  ]) {
    const s = String(id);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
