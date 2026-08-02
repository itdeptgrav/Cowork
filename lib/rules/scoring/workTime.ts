/**
 * Turns real work commits into the per-day input the Timer SOP engine judges.
 *
 * Legacy read `cowork_work_commits`, reconstructed per-session seconds, bucketed
 * them by IST date, and split each segment into inside- and after-office time
 * (`services/timerSop.service.js`). This does the same from the new model's
 * `WorkCommit`, which already carries a segment's `startedAt`, `endedAt` and
 * `durationSecs` — so no cumulative-delta reconstruction is needed.
 *
 * The date range walked is the span of real commits: a day inside that span
 * with no commits is a real zero-work day and counts toward deficit, exactly as
 * a no-show did in legacy. Off days never count toward deficit.
 */

import { DAY_KEYS, minutesOf } from "../../legacy/officePolicy.ts";
import type { OfficePolicy } from "../../legacy/officePolicy.ts";
import type { WorkCommit } from "../../domain/tasks.ts";
import { isStaleRun } from "../tasks/timer.ts";
import type { DayWork } from "./timerSop.ts";

const DEFAULT_IN = 570; // 09:30
const DEFAULT_OUT = 1110; // 18:30
const IST_OFFSET_MS = 5.5 * 3_600_000;

function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

/** Minute-of-day from an ISO timestamp's own clock, or null if unparseable. */
function minuteOfDay(iso: string): number | null {
  return minutesOf(iso.slice(11, 16));
}

function addDay(date: string): string {
  const ms = Date.parse(date + "T00:00:00.000Z");
  return new Date(ms + 86_400_000).toISOString().slice(0, 10);
}

function dayKeyOf(date: string): (typeof DAY_KEYS)[number] {
  const dow = new Date(date + "T00:00:00.000Z").getUTCDay();
  return DAY_KEYS[dow];
}

/** Break hours that fall inside the office window, subtracted from the target. */
function breakHoursWithin(
  policy: OfficePolicy,
  inMin: number,
  outMin: number,
): number {
  let minutes = 0;
  for (const b of policy.breaks) {
    const bs = minutesOf(b.start);
    const be = minutesOf(b.end);
    if (bs === null || be === null || be <= bs) continue;
    const ov = Math.min(outMin, be) - Math.max(inMin, bs);
    if (ov > 0) minutes += ov;
  }
  return minutes / 60;
}

/**
 * The daily break allowance, in hours, off the target as well.
 *
 * `maxBreakMinutesPerDay` is the personal break time the office policy grants
 * every person every day. It is therefore time nobody can have a task timer
 * running for, and a target computed without it demands hours the policy
 * itself has already given away.
 *
 * **It does not double-count with `breaks`.** Those are fixed hours the whole
 * office is closed — a canteen hour at 13:00 that is not personal time at all.
 * The allowance is personal time, taken whenever the person takes it. A
 * deployment that configures both means both apply, which is why they are
 * subtracted separately rather than one being taken as an upper bound on the
 * other.
 *
 * Mirrors `_expectedHrsForDay` in `grav-cms-backend`'s
 * `services/timerSop.service.js` — that function is what actually cuts the
 * points, and if these two disagree the card shows a target the engine does
 * not enforce.
 */
function allowanceHours(policy: OfficePolicy): number {
  return Math.max(0, policy.maxBreakMinutesPerDay) / 60;
}

/** The instant an IST calendar day begins, in epoch ms. */
function istDayStartMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) - IST_OFFSET_MS;
}

/**
 * Seconds of a CURRENTLY RUNNING timer that belong to the given day.
 *
 * Work commits are only written when a timer stops, so a person four minutes
 * into a run has nothing committed and Today's Work read `0m` — which is a true
 * statement about the ledger and a false one about their morning. This is the
 * part that has not been banked yet.
 *
 * Three things it deliberately does not count:
 *
 * - **A run that is not running.** A paused session keeps its document.
 * - **A stale run** — `isStaleRun`'s sixteen-hour bound, the same guard
 *   `displaySecs` applies. A clock left going overnight would otherwise add
 *   most of a day to the figure and fill the progress bar off a laptop that
 *   was asleep.
 * - **The part before midnight.** A run carried across the IST date boundary
 *   counts from the start of the day being shown, not from when it began, so
 *   yesterday's hours cannot land on today's target.
 *
 * It also never adds the session's banked `accumulatedSecs`: those seconds were
 * written to `cowork_work_commits` when the previous run stopped and are
 * already in `workedHours`. Adding them here would count them twice.
 */
export function liveRunSecsForDay(input: {
  startedAtRealMs: number | null;
  isRunning: boolean;
  nowRealMs: number;
  date: string;
}): number {
  const { startedAtRealMs, isRunning, nowRealMs, date } = input;
  if (!isRunning || startedAtRealMs === null) return 0;
  if (isStaleRun(startedAtRealMs, nowRealMs)) return 0;
  const from = Math.max(startedAtRealMs, istDayStartMs(date));
  return Math.max(0, Math.round((nowRealMs - from) / 1000));
}

/** Today's window and worked total, for the live "Today's Work" card. */
export interface TodayWindow {
  date: string;
  isOff: boolean;
  /** First login today (minute of day), or null if nothing has run yet. */
  loginMinute: number | null;
  inMinute: number;
  closeMinute: number;
  /** close − login, before anything is taken off. */
  spanHours: number;
  /** Recurring office breaks falling inside that span. */
  breakHours: number;
  /** The daily personal break allowance. */
  allowanceHours: number;
  /**
   * (close − login) minus recurring breaks minus the daily break allowance —
   * the time actually available to run a task timer in, and the base the
   * percentage target is taken from.
   */
  windowHours: number;
  workedHours: number;
}

export function todayWindow(
  commits: WorkCommit[],
  policy: OfficePolicy,
  date: string,
): TodayWindow {
  const cfg = policy.schedule[dayKeyOf(date)] ?? {
    isOff: false,
    inTime: "09:30",
    outTime: "18:30",
  };
  const inMinute = minutesOf(cfg.inTime) ?? DEFAULT_IN;
  const closeMinute = minutesOf(cfg.outTime) ?? DEFAULT_OUT;

  let loginMinute: number | null = null;
  let workedSecs = 0;
  for (const c of commits) {
    if (dateOf(c.startedAt) === date) {
      const m = minuteOfDay(c.startedAt);
      if (m !== null && (loginMinute === null || m < loginMinute)) loginMinute = m;
    }
    if (dateOf(c.endedAt) === date) workedSecs += c.durationSecs;
  }

  const start = loginMinute ?? inMinute;
  const spanHours = Math.max(0, (closeMinute - start) / 60);
  const breakHours = breakHoursWithin(policy, start, closeMinute);
  const allowance = allowanceHours(policy);
  const windowHours = Math.max(0, spanHours - breakHours - allowance);
  return {
    date,
    isOff: cfg.isOff,
    loginMinute,
    inMinute,
    closeMinute,
    spanHours,
    breakHours,
    allowanceHours: allowance,
    windowHours,
    workedHours: workedSecs / 3600,
  };
}

export function bucketWorkByDay(
  commits: WorkCommit[],
  policy: OfficePolicy,
): DayWork[] {
  if (commits.length === 0) return [];

  // Real date range: the earliest and latest calendar day any commit touches.
  let min = dateOf(commits[0].endedAt);
  let max = min;
  for (const c of commits) {
    for (const d of [dateOf(c.startedAt), dateOf(c.endedAt)]) {
      if (d < min) min = d;
      if (d > max) max = d;
    }
  }

  const workedSecs: Record<string, number> = {};
  const afterSecs: Record<string, number> = {};
  for (const c of commits) {
    const d = dateOf(c.endedAt);
    workedSecs[d] = (workedSecs[d] ?? 0) + c.durationSecs;

    const cfg = policy.schedule[dayKeyOf(d)];
    if (cfg?.isOff) {
      afterSecs[d] = (afterSecs[d] ?? 0) + c.durationSecs;
      continue;
    }
    const outMin = minutesOf(cfg?.outTime ?? "") ?? DEFAULT_OUT;
    const startM = minuteOfDay(c.startedAt);
    const endM = minuteOfDay(c.endedAt);
    if (startM !== null && endM !== null && endM >= startM) {
      const afterMin = Math.max(0, endM - Math.max(startM, outMin));
      afterSecs[d] = (afterSecs[d] ?? 0) + afterMin * 60;
    }
  }

  const out: DayWork[] = [];
  for (let date = min; date <= max; date = addDay(date)) {
    const cfg = policy.schedule[dayKeyOf(date)] ?? {
      isOff: false,
      inTime: "09:30",
      outTime: "18:30",
    };
    const inMin = minutesOf(cfg.inTime) ?? DEFAULT_IN;
    const outMin = minutesOf(cfg.outTime) ?? DEFAULT_OUT;
    const spanHours = Math.max(0, (outMin - inMin) / 60);
    const expectedHours = Math.max(
      0,
      spanHours - breakHoursWithin(policy, inMin, outMin) - allowanceHours(policy),
    );
    out.push({
      date,
      workedHours: (workedSecs[date] ?? 0) / 3600,
      afterOfficeHours: (afterSecs[date] ?? 0) / 3600,
      isOff: cfg.isOff,
      expectedHours,
    });
  }
  return out;
}
