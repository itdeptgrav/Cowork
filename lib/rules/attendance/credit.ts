/**
 * Overtime credit for one attendance day — the OFFSET model (owner decision O5,
 * docs/architecture/MIGRATION_DECISIONS.md; docs/specs/SCORING_LOGIC_SPEC.md §5.5).
 *
 * Legacy issued an "Overtime Reward" and a "Late Stay Boost" as separate reward
 * entries that could push attendance past its ceiling. The new model does not
 * reproduce that: overtime earns a credit that CANCELS a same-day attendance
 * deduction, but the scoring projection clamps the day to its 1.0 maximum, so a
 * day can never exceed full and the component still caps at 100%.
 *
 * Both legacy concepts collapse into one measure here — minutes worked past the
 * scheduled end — because that is the single fact the attendance record carries.
 * The rate and grace period are provisional; every figure derived from them is
 * disclosed as such at the point of display.
 */

import { provisionalNumber } from "../../config/provisional.ts";

export interface OvertimeCredit {
  /** Minutes worked past the scheduled end. */
  minutes: number;
  /** Minutes past the scheduled end once the grace period is removed. */
  chargeableMinutes: number;
  /** Credit points before the projection clamps the day. */
  points: number;
  rate: number;
  grace: number;
}

/** Minutes worked past the scheduled end. Both are "HH:MM" clock strings. */
export function overtimeMinutes(
  scheduledEnd: string | null | undefined,
  actualEnd: string | null | undefined,
): number {
  const end = clockToMinutes(scheduledEnd);
  const out = clockToMinutes(actualEnd);
  if (end === null || out === null) return 0;
  return Math.max(0, out - end);
}

/**
 * Overtime credit for one day, at effective (possibly provisional) rates.
 * Pass `rate`/`grace` explicitly in tests; production reads live configuration.
 */
export function overtimeCreditFor(
  scheduledEnd: string | null | undefined,
  actualEnd: string | null | undefined,
  opts: { rate?: number; grace?: number } = {},
): OvertimeCredit {
  const rate = opts.rate ?? provisionalNumber("overtimeCreditRate");
  const grace = opts.grace ?? provisionalNumber("overtimeGraceMins");
  const minutes = overtimeMinutes(scheduledEnd, actualEnd);
  const chargeableMinutes = Math.max(0, minutes - grace);
  const points = round2(chargeableMinutes * rate);
  return { minutes, chargeableMinutes, points, rate, grace };
}

function clockToMinutes(clock: string | null | undefined): number | null {
  if (!clock) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
