/**
 * How a person's live work reads against the time they were given.
 *
 * **The budget is a working-time budget, not a wall clock.** That distinction
 * is the whole reason this module exists. A task given three hours is not late
 * because three hours of the afternoon went by; it is late when three hours of
 * *logged work* have gone by, or when the due moment it implies has passed with
 * the work unfinished. Legacy got this right in one place only — the manager's
 * status-tracking modal (`cowork-old-frontend/app/coworking/status-tracking/
 * page.js:256-299`) — and the reading was trapped in that component's render.
 * It is a rule, so it lives here.
 *
 * ## Four states, and the question each answers
 *
 *   `on_track`   — inside the window. "How much of the budget is left?"
 *   `incomplete` — the due moment passed and the budget was NOT spent. "How
 *                  much work never happened?" This is the state legacy invented
 *                  and it is the one that matters most: a task can be overdue
 *                  while the person has barely worked on it, and calling that
 *                  "overtime" would credit them for the opposite of what
 *                  happened.
 *   `overdue`    — the due moment passed, the budget is spent, nothing more to
 *                  show. "It is late and there is no time left in it."
 *   `overtime`   — worked BEYOND the budget. "How far past it are they?"
 *
 * `no_budget` is the fifth reading and not a state of the work at all: a
 * fixed-deadline task carries no window, and every figure below would be
 * divided by a denominator nobody agreed to. Per `resolveTimeBudget`, inventing
 * one is the bug this codebase has already paid for once.
 *
 * ## What is NOT derived here
 *
 * The elapsed seconds of a running clock. `worked` is passed in, because the
 * only honest source is the session document plus a ticker, and a rule that
 * called `Date.now()` could not be tested. Everything else follows from it.
 */

import type { Task } from "@/lib/domain";

export type WorkProgressState =
  | "on_track"
  | "incomplete"
  | "overdue"
  | "overtime"
  | "no_budget";

export interface WorkProgress {
  state: WorkProgressState;
  /** The window in force, including every approved extension. Null when none. */
  budgetSecs: number | null;
  /** The window before any extension, where the two differ. */
  originalBudgetSecs: number | null;
  /** Logged work, as handed in. Never rewritten — see `remainingWorkSecs`. */
  workedSecs: number;
  /**
   * Budget still unspent, floored at zero.
   *
   * Read as "time left" while `on_track` and as "still needed" once the due
   * moment has passed — the same number answering two questions, which is why
   * it is one field rather than two.
   */
  remainingSecs: number | null;
  /** Work logged past the budget. Only ever set in `overtime`. */
  overtimeSecs: number | null;
  /** Worked against budget, 0–100 and clamped. Null without a budget. */
  percentUsed: number | null;
  /**
   * When the budget runs out, epoch ms — the figure the DUE chip shows.
   *
   * Derived from the clock rather than read off the task, so a manager and the
   * person working see the same moment: while a session RUNS the budget ends
   * `remaining` from now, and it ticks down in real time; while it is PAUSED it
   * ends `remaining` from the moment it stopped — frozen, because a paused
   * task's deadline does not advance while nobody is working on it. That is
   * what makes this different from `task.deadline.dueAt`, which is assignment
   * time plus the budget and assumes the person started immediately and never
   * stopped.
   *
   * Legacy writes the running case as `lastStartTime + (budget − banked)`
   * (`status-tracking/page.js:350-357`). It is the same moment: `worked` is
   * `banked` plus the seconds since the run began, so the two differ by exactly
   * the elapsed run and cancel. Stated against `now` here because `worked`
   * already carries the live tick, and subtracting it from the START instead
   * would count that run twice and drag the due moment backwards a second per
   * second.
   *
   * Falls back to the stored `dueAt` when there is no clock to derive from, and
   * is null when there is neither.
   */
  budgetEndsAtMs: number | null;
  /** Whether `budgetEndsAtMs` is in the past. False when it cannot be derived. */
  isPastDue: boolean;
}

export interface WorkProgressInput {
  /** The window in force. `deadline.currentWindowSecs`, in practice. */
  budgetSecs: number | null | undefined;
  /** The window as first agreed, for the extension chain. */
  originalBudgetSecs?: number | null | undefined;
  /** Seconds logged, banked plus any live tick. */
  workedSecs: number;
  /** Whether the clock is running right now. Decides which due moment applies. */
  isRunning?: boolean;
  /** Epoch ms the clock last stopped, for a paused task's frozen due moment. */
  pausedAtMs?: number | null;
  /** The task's stored due moment, epoch ms. The fallback, never the first choice. */
  storedDueAtMs?: number | null;
  /** Now, epoch ms. Passed in so this stays pure. */
  nowMs: number;
}

function positive(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  /* Zero is "never set", not "a budget of nothing" — the same reading
     `resolveTimeBudget` takes, and for the same reason: a zero-second window
     would drive a progress bar off a denominator of zero. */
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function workProgress(input: WorkProgressInput): WorkProgress {
  const budgetSecs = positive(input.budgetSecs);
  const originalBudgetSecs = positive(input.originalBudgetSecs);
  const rawWorked = Number(input.workedSecs);
  const workedSecs =
    Number.isFinite(rawWorked) && rawWorked > 0 ? Math.round(rawWorked) : 0;

  if (budgetSecs === null) {
    /* No window was ever agreed. The due moment can still be stated — a
       fixed-deadline task has one — but nothing may be said about how much of
       a budget is left, because there is no budget. */
    const dueMs = input.storedDueAtMs ?? null;
    return {
      state: "no_budget",
      budgetSecs: null,
      originalBudgetSecs: null,
      workedSecs,
      remainingSecs: null,
      overtimeSecs: null,
      percentUsed: null,
      budgetEndsAtMs: dueMs,
      isPastDue: dueMs !== null && dueMs < input.nowMs,
    };
  }

  const remainingSecs = Math.max(0, budgetSecs - workedSecs);
  const overtimeRaw = workedSecs - budgetSecs;

  /* The due moment, from the clock that is actually running. */
  const budgetEndsAtMs = input.isRunning
    ? input.nowMs + remainingSecs * 1000
    : input.pausedAtMs != null && workedSecs > 0
      ? input.pausedAtMs + remainingSecs * 1000
      : (input.storedDueAtMs ?? null);

  const isPastDue = budgetEndsAtMs !== null && budgetEndsAtMs < input.nowMs;

  /* Overtime is decided by the budget alone, not by the clock: somebody who
     logs more than they were given has worked overtime whether or not the due
     moment has arrived, and it cannot arrive later than the budget runs out
     anyway. Checking it first is what stops an overrun being reported as
     `incomplete`, which would read as "they never did the work". */
  const state: WorkProgressState =
    overtimeRaw > 0
      ? "overtime"
      : !isPastDue
        ? "on_track"
        : remainingSecs > 0
          ? "incomplete"
          : "overdue";

  return {
    state,
    budgetSecs,
    originalBudgetSecs,
    workedSecs,
    remainingSecs,
    overtimeSecs: overtimeRaw > 0 ? overtimeRaw : null,
    percentUsed: Math.min(100, Math.round((workedSecs / budgetSecs) * 100)),
    budgetEndsAtMs,
    isPastDue,
  };
}

/**
 * The same reading, taken straight off a task and a session.
 *
 * A convenience over `workProgress` and nothing more — it exists so every
 * surface pulls the budget out of `deadline` the same way rather than each
 * choosing between `currentWindowSecs`, `originalWindowSecs` and
 * `estimatedEffortSecs` for itself. That choice has already been made once, in
 * `resolveTimeBudget`, and made differently in four places before that.
 */
export function taskWorkProgress(
  task: Task,
  worked: {
    workedSecs: number;
    isRunning?: boolean;
    pausedAtMs?: number | null;
  },
  nowMs: number,
): WorkProgress {
  const dueAt = task.deadline.dueAt;
  return workProgress({
    budgetSecs: task.deadline.currentWindowSecs,
    originalBudgetSecs: task.deadline.originalWindowSecs,
    workedSecs: worked.workedSecs,
    isRunning: worked.isRunning ?? false,
    pausedAtMs: worked.pausedAtMs ?? null,
    storedDueAtMs: dueAt ? new Date(dueAt).getTime() : null,
    nowMs,
  });
}

/**
 * What the third column is called, given the state.
 *
 * The label changes with the reading because the number does: 2h remaining is
 * "time left" while there is time to use it and "still needed" once there is
 * not, and calling both "time left" is how a manager reads a stalled task as a
 * comfortable one.
 */
export function remainderLabel(state: WorkProgressState): string | null {
  switch (state) {
    case "on_track":
      return "Time left";
    case "incomplete":
      return "Still needed";
    case "overtime":
      return "Overtime";
    default:
      return null;
  }
}
