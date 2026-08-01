import {
  DAY_KEYS,
  minutesOf,
  type OfficePolicy,
} from "../../legacy/officePolicy.ts";

/**
 * Working time between two instants.
 *
 * **The bounding two comments in `duty.ts` promised and nobody wrote.** Both
 * said "the caller bounds it to office hours"; no caller did, so an absence was
 * credited as raw wall-clock. Going offline at 18:00 and returning at 10:00 the
 * next morning credited **sixteen hours**, and every active deadline moved a
 * full day. Overnight was free time.
 *
 * The rule this implements, stated once:
 *
 * > Credit the time somebody was unavailable, counting only the minutes inside
 * > their working day.
 *
 * Which is also what makes an absence measurable at all without a stamp — the
 * span is derived from the calendar, so somebody who simply arrived late has a
 * measurable absence from the moment their day opened, with nothing to have
 * recorded in advance.
 *
 * ## The schedule is authored in IST
 *
 * `DaySchedule.inTime` is `HH:MM` in the office's own timezone, and this runs
 * in a browser that may be anywhere. Comparing a local clock against an IST
 * schedule is how a correct-looking implementation silently shifts everybody's
 * day by five and a half hours, so the conversion is explicit here and stated
 * rather than assumed.
 */

/** The office the schedule is written for. */
const OFFICE_OFFSET_MIN = 330; // IST, UTC+05:30

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

/** Minutes past midnight IST for an instant. */
function istMinutesOfDay(ms: number): number {
  const shifted = ms + OFFICE_OFFSET_MIN * MIN_MS;
  return Math.floor((shifted % DAY_MS) / MIN_MS);
}

/** The IST calendar day an instant falls on, as a day-of-week index. */
function istDayIndex(ms: number): number {
  const shifted = ms + OFFICE_OFFSET_MIN * MIN_MS;
  return new Date(shifted).getUTCDay();
}

/** Midnight IST at the start of the day an instant falls on, as a UTC ms. */
function istMidnight(ms: number): number {
  const shifted = ms + OFFICE_OFFSET_MIN * MIN_MS;
  const dayStart = Math.floor(shifted / DAY_MS) * DAY_MS;
  return dayStart - OFFICE_OFFSET_MIN * MIN_MS;
}

/** One working window on one day, as absolute ms. Empty on a day off. */
function windowsFor(
  policy: OfficePolicy,
  midnightMs: number,
): { from: number; to: number }[] {
  const day = policy.schedule[DAY_KEYS[istDayIndex(midnightMs + DAY_MS / 2)]];
  if (!day || day.isOff) return [];

  const open = minutesOf(day.inTime);
  const close = minutesOf(day.outTime);
  if (open === null || close === null || close <= open) return [];

  let windows = [
    { from: midnightMs + open * MIN_MS, to: midnightMs + close * MIN_MS },
  ];

  /* Recurring breaks are subtracted, not merely marked: lunch is not working
     time, so an absence spanning it must not be credited for it. Splitting the
     window rather than deducting a total keeps a partial overlap correct. */
  for (const br of policy.breaks ?? []) {
    const s = minutesOf(br.start);
    const e = minutesOf(br.end);
    if (s === null || e === null || e <= s) continue;
    const bFrom = midnightMs + s * MIN_MS;
    const bTo = midnightMs + e * MIN_MS;
    const next: { from: number; to: number }[] = [];
    for (const w of windows) {
      if (bTo <= w.from || bFrom >= w.to) {
        next.push(w);
        continue;
      }
      if (bFrom > w.from) next.push({ from: w.from, to: bFrom });
      if (bTo < w.to) next.push({ from: bTo, to: w.to });
    }
    windows = next;
  }
  return windows;
}

/**
 * Working milliseconds between two instants.
 *
 * Walks day by day rather than computing a closed form, because a span may
 * cross weekends, days off and any number of breaks — and the closed form for
 * that is where the off-by-one lives. Bounded to 60 days so a corrupt stamp
 * cannot spin the loop.
 */
export function workingMsBetween(
  fromMs: number,
  toMs: number,
  policy: OfficePolicy | null | undefined,
): number {
  if (!policy || !Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  if (toMs <= fromMs) return 0;

  let total = 0;
  let cursor = istMidnight(fromMs);
  const limit = istMidnight(toMs) + DAY_MS;

  for (let guard = 0; cursor < limit && guard < 60; guard++) {
    for (const w of windowsFor(policy, cursor)) {
      const overlap = Math.min(w.to, toMs) - Math.max(w.from, fromMs);
      if (overlap > 0) total += overlap;
    }
    cursor += DAY_MS;
  }
  return total;
}

/**
 * The credit an absence earns.
 *
 * A thin name over `workingMsBetween`, because the call sites read better for
 * it and because it is the one place to change if "unavailable" ever stops
 * meaning "not working".
 *
 * **Falls back to the raw span when there is no policy.** A missing schedule
 * must not silently zero everybody's credit — that would be the opposite
 * failure, and quieter. It is logged by the caller instead.
 */
export function absenceCreditMs(input: {
  fromMs: number;
  toMs: number;
  policy: OfficePolicy | null | undefined;
}): number {
  if (!input.policy) return Math.max(0, input.toMs - input.fromMs);
  return workingMsBetween(input.fromMs, input.toMs, input.policy);
}
