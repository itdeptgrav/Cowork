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
import type { DayWork } from "./timerSop.ts";

const DEFAULT_IN = 570; // 09:30
const DEFAULT_OUT = 1110; // 18:30

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

/** Today's window and worked total, for the live "Today's Work" card. */
export interface TodayWindow {
  date: string;
  isOff: boolean;
  /** First login today (minute of day), or null if nothing has run yet. */
  loginMinute: number | null;
  inMinute: number;
  closeMinute: number;
  /** (close − login) minus breaks, matching the legacy card's "your window". */
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
  const windowHours = Math.max(
    0,
    spanHours - breakHoursWithin(policy, start, closeMinute),
  );
  return {
    date,
    isOff: cfg.isOff,
    loginMinute,
    inMinute,
    closeMinute,
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
      spanHours - breakHoursWithin(policy, inMin, outMin),
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
