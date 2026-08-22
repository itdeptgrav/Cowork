import { isTaskBlocked } from "./outputs.ts";
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
   * Nothing on this task can be started — every output it declares is waiting
   * on an input nobody has approved yet.
   *
   * When true, `rank` is the rank somebody SET rather than the position the
   * task fell to. A blocked task is demoted in the queue, which is the point of
   * the feature — but a demotion with no explanation reads as the assignor's
   * instruction being ignored. "P1 blocked" says both: the intent stands, and
   * the work cannot run yet.
   */
  isBlocked: boolean;
  /**
   * The rank somebody SET, where a block has pushed the task off it.
   *
   * Null when there is nothing to explain — either the task is not blocked, or
   * it is blocked and still sitting where it was put. Used by the tooltip only:
   * the chip shows the real position, and this says what it would have been.
   */
  setRank: number | null;
  /**
   * The task has left the active queue, so this is a record and not a position.
   *
   * It must be rendered differently — "was P1", never a bare "P1". A closed
   * task showing the same chip as a live one puts two first-priorities on the
   * screen and undoes the whole point of compacting the queue.
   */
  isHistoric: boolean;
  /**
   * The number counts a DIFFERENT sequence: work still awaiting acceptance.
   *
   * The same argument as `isHistoric`, arrived at from the other end. A task
   * whose hours nobody has agreed is not in the running order, so it is numbered
   * among its own kind — and the first of those is `1` exactly as the first of
   * the live queue is. Rendered identically, a list showing one of each puts
   * **two P1s on the screen**, which is what people report as "two tasks have
   * the same priority". They do not: one is first in the queue, the other is
   * first in line to be accepted.
   *
   * `displayPriority` has always known which sequence it answered from — it
   * returns `scale` — and this is that fact reaching the renderer, which used to
   * discard it here.
   */
  isProvisional: boolean;
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

  /**
   * **The chip shows where the task actually IS.** OWNER RULE, 21 Aug 2026.
   *
   * A blocked task is demoted, so it reads P2 — plainly, with no qualifier. An
   * earlier version showed `P1 blocked`, the rank the assignor set: that put
   * two different scales in one column again, and a number that did not match
   * the row's place in the list.
   *
   * The assignor's intent is not lost by this and never was. It lives in
   * `assigneePriorities`, which nothing in this feature writes — which is
   * exactly why the task takes first place back on its own when its input is
   * approved. `isBlocked` and `setRank` carry it to the TOOLTIP, so the answer
   * to "what happened to the P1 I set?" is one hover away instead of crowded
   * into a chip.
   */
  const blocked = isTaskBlocked(view.outputs ?? []) && !resolved.isHistoric;

  return {
    rank: resolved.rank,
    isMine: resolved.isMine,
    isHistoric: resolved.isHistoric,
    isProvisional: resolved.scale === "provisional_position",
    /** Nothing on this task can be started — an input has not been approved. */
    isBlocked: blocked,
    /** The rank somebody SET, for explaining a demotion. Null when unchanged. */
    setRank:
      blocked && (resolved.storedRank ?? view.myStoredRank ?? null) !== resolved.rank
        ? (resolved.storedRank ?? view.myStoredRank ?? null)
        : null,
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
  if (display.isHistoric) return `Was P${display.rank}`;
  /* **Not `P1`.** This is first among work awaiting acceptance, not first in the
     queue, and the two appear in the same list. The bare form was reported as
     "two tasks have the same priority P1" — they did not, and nothing on screen
     said so. `To accept` names the sequence in the two words that fit a chip;
     the tooltip carries the full sentence. */
  if (display.isProvisional) return `P${display.rank} to accept`;
  /* A blocked task reads as the position it actually holds — see `isBlocked`.
     What it was set to is in the tooltip, not the chip. */
  return `P${display.rank}`;
}

/** What the control's tooltip should say about whose rank this is. */
export function rankTitle(display: RankDisplay): string {
  if (display.rank === null) return "No priority has been set for this task";
  if (display.isHistoric) {
    return `This task is closed. It was P${display.rank} when it left the queue.`;
  }
  if (display.isBlocked) {
    const setTo =
      display.setRank === null
        ? ""
        : ` It is set to P${display.setRank} and takes that place back by itself once the input lands — nothing needs re-ordering.`;
    return (
      `P${display.rank} for now. Nothing on this task can be started — every ` +
      `output it produces is waiting on an input nobody has approved — so it ` +
      `sits below work that can be done.${setTo}`
    );
  }
  if (display.isProvisional) {
    return (
      `Not in the running order yet — the hours are not agreed. ` +
      `This is its position among your work still awaiting acceptance, ` +
      `which is counted separately from the live queue.`
    );
  }
  return display.isMine
    ? `Your priority on this task: P${display.rank}`
    : `The assignee's priority: P${display.rank}`;
}
