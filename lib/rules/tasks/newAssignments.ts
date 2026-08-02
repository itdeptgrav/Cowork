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

  /* ── What the work actually is ─────────────────────────────────────────
   *
   * A notice that gives only a title asks somebody to open every task
   * before they can tell which one matters. These are the fields that let
   * that judgement happen in the notice itself.
   */

  /** The task's own description, for a one- or two-line snippet. */
  description: string | null;
  /** How many acceptance criteria have to be satisfied. 0 where none were set. */
  requirementCount: number;
  /**
   * The time this is expected to take — the assignor's proposed window on a
   * budget task, otherwise the effort estimate. Null where neither is set.
   */
  effortSecs: number | null;
  /**
   * `timer` is a time BUDGET whose deadline is derived once accepted;
   * `fixed` is a date somebody set. The distinction decides what the next
   * step even is, so the notice states it rather than showing a date and
   * leaving the reader to infer the model.
   */
  deadlineMode: "timer" | "fixed";
  /** The project this belongs to, where it belongs to one. */
  projectName: string | null;
  /** True when this is part of a larger task rather than standalone. */
  isSubtask: boolean;

  /**
   * The one thing to do about it next, in the product's own words, with the
   * screen that does it.
   *
   * Resolved by `actionableFor` — the same resolver the action inbox uses —
   * rather than assumed here. A newly assigned task is not always "confirm
   * receipt": a budget task with a window on offer is "Accept or discuss the
   * time", and one with no deadline yet is "Propose a deadline". Guessing
   * would send people to the wrong screen.
   */
  action: { label: string; href: string } | null;
}

/**
 * The total time these assignments commit, and how much of it is known.
 *
 * Reported as a pair rather than one number on purpose: "12h" over five
 * tasks when only two carry an estimate is a figure that reads as the whole
 * commitment and is not. The caller can say "12h across 2 of 5" and be
 * honest, which is the difference between a useful total and a misleading
 * one.
 */
export function committedEffort(notices: readonly AssignmentNotice[]): {
  totalSecs: number;
  withEstimate: number;
  total: number;
} {
  const withEstimate = notices.filter((n) => (n.effortSecs ?? 0) > 0);
  return {
    totalSecs: withEstimate.reduce((sum, n) => sum + (n.effortSecs ?? 0), 0),
    withEstimate: withEstimate.length,
    total: notices.length,
  };
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
