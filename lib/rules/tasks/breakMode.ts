import { DEFAULT_MAX_BREAK_MINUTES_PER_DAY } from "../../domain/breaks.ts";
import type { BreakBudget, BreakSession } from "@/lib/domain";

/**
 * How much of a break is credited back, and how much of today is left.
 *
 * Transcribed from legacy's close-out branch in `DutyStatusToggle.jsx`:
 *
 *     const usedBeforeToday = Number(prev.dailyBreakSeconds?.[todayKey]) || 0;
 *     const remainingBudget = Math.max(0, maxSecs - usedBeforeToday);
 *     const appliedSecs     = Math.min(sessionSecs, remainingBudget);
 *
 * Pure, so the pill can show the remaining allowance from the same arithmetic
 * the repository credits with. A budget the screen and the server disagree
 * about is one that reads as broken to whoever is watching the clock.
 */

/** Which calendar day a moment belongs to, for the daily budget. */
export function breakDayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Today's usage, summed from the sessions themselves.
 *
 * The REAL duration is summed, not the credited one, so the allowance is spent
 * by time away rather than by whatever happened to fit. Somebody who has
 * already exhausted the budget does not quietly regain it by taking more
 * breaks that credit nothing.
 */
export function usedTodaySecs(
  sessions: BreakSession[],
  employeeId: string,
  dayKey: string,
): number {
  return sessions
    .filter(
      (s) =>
        s.employeeId === employeeId && breakDayKey(s.startedAt) === dayKey,
    )
    .reduce((sum, s) => sum + s.durationSecs, 0);
}

export function maxBreakSecs(maxMinutesPerDay: number | null): number {
  const mins =
    maxMinutesPerDay && maxMinutesPerDay > 0
      ? maxMinutesPerDay
      : DEFAULT_MAX_BREAK_MINUTES_PER_DAY;
  return Math.round(mins * 60);
}

export function breakBudget(input: {
  maxMinutesPerDay: number | null;
  usedSecs: number;
}): BreakBudget {
  const maxSecs = maxBreakSecs(input.maxMinutesPerDay);
  const usedSecs = Math.max(0, input.usedSecs);
  return {
    maxSecs,
    usedSecs,
    remainingSecs: Math.max(0, maxSecs - usedSecs),
  };
}

/**
 * What one break session credits back.
 *
 * `wasCapped` distinguishes "the break was short" from "the allowance ran out",
 * which is the difference between a normal day and one somebody needs telling
 * about.
 */
export function creditedBreakSecs(input: {
  sessionSecs: number;
  remainingSecs: number;
}): { appliedSecs: number; wasCapped: boolean } {
  const session = Math.max(0, Math.round(input.sessionSecs));
  const remaining = Math.max(0, Math.round(input.remainingSecs));
  const appliedSecs = Math.min(session, remaining);
  return { appliedSecs, wasCapped: appliedSecs < session };
}

/**
 * What to tell somebody about to start a break, or null when there is nothing
 * worth saying.
 *
 * A WARNING, never a refusal — the allowance bounds what a break gives back to
 * a deadline, and stopping somebody stepping away because a number is spent is
 * not something this product does. Legacy took the same position.
 */
export function breakBudgetWarning(budget: BreakBudget): string | null {
  if (budget.remainingSecs <= 0)
    return "You have used today's break allowance. You can still take a break — it just will not move your deadlines any further.";
  if (budget.remainingSecs <= 5 * 60)
    return `${Math.round(budget.remainingSecs / 60)} minutes of today's break allowance are left. Anything beyond that will not move your deadlines.`;
  return null;
}
