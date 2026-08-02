import type { TaskView } from "@/lib/repositories";
import { displayPriority } from "./priority.ts";

/**
 * What priority to show for a task, and whose it is.
 *
 * **The bug this exists to fix.** Six surfaces rendered `P{view.myRank ?? "—"}`
 * independently — the detail header twice, the board card, the overview row, the
 * table. `myRank` is *the viewer's own* rank and is `null` for anybody who is
 * not an assignee, which is the correct answer to "where is this in MY queue"
 * and the wrong thing to put on screen: a manager looking at work they assigned
 * saw **`P—` on every task**, while the rank was sitting in the document the
 * whole time.
 *
 * Legacy never had this problem because it asked a different question. Its own
 * read is `assigneePriorities[me] ?? priority ?? 999` — it falls through to the
 * TASK's rank rather than giving up, so something always renders.
 *
 * So the fix is not a fallback bolted onto each component. It is one resolver
 * that answers the question the screen is actually asking — *what priority is
 * this task carrying* — and says whose rank it is reporting, so the label can be
 * honest about the difference.
 *
 * ## The legacy scale
 *
 * `priority` is **1–10**, 1 highest, clamped by `handleUpdatePriority` and
 * defaulted to `5` at creation (`taskForward.service.js:224`). It is NOT a
 * three-level low/medium/high enum, and nothing here invents one.
 */

/** Legacy's own bounds. `changePriority` clamps writes to the same range. */
export const MIN_RANK = 1;
export const MAX_RANK = 10;

/**
 * Legacy's "no rank recorded" sentinel, from `page.js`'s
 * `assigneePriorities[me] ?? priority ?? 999`.
 *
 * Read as unranked rather than as priority 999: it means the field was never
 * written, and sorting it to the bottom is what legacy does with it.
 */
export const UNRANKED = 999;

export interface RankDisplay {
  /** The rank to show, or null when the task genuinely carries none. */
  rank: number | null;
  /**
   * Whether this is the VIEWER's own queue position.
   *
   * False when the viewer is not an assignee and the task's own rank is being
   * shown instead. The two are different claims and a tooltip should say so —
   * "your priority" against somebody else's is how a manager comes to believe
   * their own day is ordered by a report's queue.
   */
  isMine: boolean;
  /**
   * The task has left the active queue, so this is a record and not a position.
   *
   * It must be rendered differently — "was P1", never a bare "P1". A closed
   * task showing the same chip as a live one puts two first-priorities on the
   * screen and undoes the whole point of compacting the queue.
   */
  isHistoric: boolean;
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
 * The rank this task should display to this viewer.
 *
 * Order matches legacy's: the viewer's own rank first, then the task's. The
 * task's rank is taken from its assignments rather than re-derived — they carry
 * `assigneePriorities[employeeId] ?? priority`, which is the same read.
 *
 * Returns `rank: null` only when nothing in the document is a usable rank, at
 * which point the screen shows a dash because there is genuinely nothing to
 * report. `0` and `999` both land here: neither is a priority somebody set.
 */
export function rankFor(view: TaskView, viewerId: string | null): RankDisplay {
  /*
   * **Delegated to `lib/rules/tasks/priority.ts`.** This module used to decide
   * for itself, reading `view.myRank` and then falling back to
   * `Math.min(...assignments.map(a => a.rank))` — and `a.rank` held EITHER a
   * derived queue position or a stored 1–10 priority depending on whose queue the
   * read had fetched. The list path fetches the viewer's queue; the detail path
   * fetches the subject's. So one manager saw two different numbers for one task
   * on two screens, both rendered `P{n}`.
   *
   * The two facts now live in separate fields and one function decides between
   * them, so what remains here is a translation rather than a judgement.
   */
  const resolved = displayPriority({
    status: view.task.status,
    viewerId,
    myRank: view.myRank,
    myStoredRank: view.myStoredRank,
    holders: (view.assignments ?? []).map((a) => ({
      employeeId: String(a.employeeId),
      rank: a.rank,
      queuePosition: a.queuePosition,
      provisionalPosition: a.provisionalPosition,
    })),
  });

  return {
    rank: resolved.rank,
    isMine: resolved.isMine,
    isHistoric: resolved.isHistoric,
  };
}

/**
 * `P3`, or an em dash.
 *
 * The one place the `P` prefix is written. It was inline at six call sites, and
 * two of them produced the string `"P—"` — a priority level that does not
 * exist, reading as data rather than as absence.
 */
export function formatRank(rank: number | null): string {
  return rank === null ? "—" : `P${rank}`;
}

/**
 * How a rank reads on screen, live or closed.
 *
 * "Was P1" rather than "P1" on a finished task. The word is doing real work:
 * it is the difference between a position somebody still holds and a record of
 * one they held, and the two look identical without it.
 */
export function formatRankDisplay(display: RankDisplay): string {
  if (display.rank === null) return "—";
  return display.isHistoric ? `Was P${display.rank}` : `P${display.rank}`;
}

/** What the control's tooltip should say about whose rank this is. */
export function rankTitle(display: RankDisplay): string {
  if (display.rank === null) return "No priority has been set for this task";
  if (display.isHistoric) {
    return `This task is closed. It was P${display.rank} when it left the queue.`;
  }
  return display.isMine
    ? `Your priority on this task: P${display.rank}`
    : `The assignee's priority: P${display.rank}`;
}
