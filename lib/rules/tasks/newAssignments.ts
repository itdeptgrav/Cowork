/**
 * Which newly-assigned tasks to announce, and which have already been seen.
 *
 * ## What counts as "new"
 *
 * A task the viewer is assigned to that is still in `assigned` — the status
 * between somebody assigning it and the assignee confirming it. That is
 * already the product's own record of "this person has not acted on this",
 * stored server-side, so nothing new has to be persisted to know what is
 * outstanding. No `seenAt` column, no backend change, and no second source of
 * truth that could disagree with the task list.
 *
 * ## What "already shown" means, and its honest limit
 *
 * The *status* says the work is outstanding; it does not say whether this
 * person has had the notice put in front of them. Those are different
 * questions, and conflating them would either nag on every single page load
 * until they confirm, or require a server field for something that is really
 * a UI courtesy.
 *
 * So "already shown" is kept per-browser. The consequence, stated plainly
 * rather than discovered: **signing in on a second machine shows the notice
 * again.** That is the right trade for a notice — the cost is seeing it
 * twice, and the alternative failure is never seeing it at all because a
 * device you no longer use marked it read. Confirming the task, which IS
 * server-side, is what actually clears the work.
 *
 * Keyed on `taskId:assignedAt` rather than `taskId` alone: being re-assigned
 * to the same task later is a genuinely new event and must announce itself
 * again.
 */

export interface AssignmentNotice {
  taskId: string;
  title: string;
  reference: string;
  assignedAt: string;
  assignedByName: string | null;
  dueAt: string | null;
  /** The stored priority, 1–10, as the assignor set it. */
  rank: number | null;
}

/** Stable identity for one assignment event. */
export function noticeKey(notice: Pick<AssignmentNotice, "taskId" | "assignedAt">): string {
  return `${notice.taskId}:${notice.assignedAt}`;
}

/**
 * The notices worth showing — newest first, and capped.
 *
 * The cap is not cosmetic: somebody returning from leave to forty new
 * assignments does not need forty rows in a modal, they need to know it
 * happened and to go to their list. The caller reports the overflow count
 * rather than silently dropping it.
 */
export const MAX_SHOWN = 5;

export function unseenNotices(
  all: readonly AssignmentNotice[],
  seenKeys: readonly string[],
): AssignmentNotice[] {
  const seen = new Set(seenKeys);
  return [...all]
    .filter((n) => !seen.has(noticeKey(n)))
    .sort((a, b) => (a.assignedAt < b.assignedAt ? 1 : a.assignedAt > b.assignedAt ? -1 : 0));
}

/**
 * The `seen` set after showing these, bounded so the stored list cannot grow
 * without limit on a long-lived browser.
 *
 * Trimmed from the FRONT — the oldest keys go first, and re-adding one only
 * matters if that exact assignment is still outstanding months later, which
 * is a case where showing the notice again is defensible anyway.
 */
export const MAX_REMEMBERED = 200;

export function rememberSeen(
  seenKeys: readonly string[],
  shown: readonly AssignmentNotice[],
): string[] {
  const next = [...seenKeys];
  for (const notice of shown) {
    const key = noticeKey(notice);
    if (!next.includes(key)) next.push(key);
  }
  return next.length > MAX_REMEMBERED ? next.slice(next.length - MAX_REMEMBERED) : next;
}
