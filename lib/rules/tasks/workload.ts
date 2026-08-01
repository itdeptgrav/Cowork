/**
 * When a person's work actually lands, and how far out it runs.
 *
 * "How much work" is a count; "until when do they have work" is a date, and the
 * two answer different questions. This module reads the second off the tasks the
 * roster already has — each task's `operationalDueAt`, which is the app's own
 * projection of when it will really finish (the queue ahead of it, its budget,
 * walked through the office calendar). The furthest of those is the runway: the
 * day their queue clears.
 *
 * Kept pure and date-only so it can be tested without a task fixture: the caller
 * maps its tasks to landing dates and hands the strings in.
 */

/** A timestamp as a local calendar day, `YYYY-MM-DD`, or null when unreadable. */
export function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The furthest-out timestamp in a set — the workload runway — or null. */
export function latestDate(
  isos: readonly (string | null | undefined)[],
): string | null {
  let bestMs: number | null = null;
  let bestIso: string | null = null;
  for (const iso of isos) {
    if (!iso) continue;
    const ms = new Date(iso).getTime();
    if (Number.isNaN(ms)) continue;
    if (bestMs === null || ms > bestMs) {
      bestMs = ms;
      bestIso = iso;
    }
  }
  return bestIso;
}

/** The earliest timestamp in a set — where a calendar should open — or null. */
export function earliestDate(
  isos: readonly (string | null | undefined)[],
): string | null {
  let bestMs: number | null = null;
  let bestIso: string | null = null;
  for (const iso of isos) {
    if (!iso) continue;
    const ms = new Date(iso).getTime();
    if (Number.isNaN(ms)) continue;
    if (bestMs === null || ms < bestMs) {
      bestMs = ms;
      bestIso = iso;
    }
  }
  return bestIso;
}

/** Whole days from now until `iso` (negative if past), or null. */
export function daysUntil(
  iso: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.round((ms - nowMs) / 86_400_000);
}

/**
 * Group a list of `{ id, date }` items by their local day.
 *
 * Insertion order is preserved within a day, and days with nothing are simply
 * absent — the calendar renders empty cells for those itself.
 */
export function groupByDay<T>(
  items: readonly T[],
  dateOf: (item: T) => string | null | undefined,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const key = dayKey(dateOf(item));
    if (!key) continue;
    const bucket = out.get(key);
    if (bucket) bucket.push(item);
    else out.set(key, [item]);
  }
  return out;
}

/* ── Serial scheduling ────────────────────────────────────────────────────── */

/** A `YYYY-MM-DD` key back to a local Date at midnight. */
export function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** A local Date to its `YYYY-MM-DD` key. */
export function keyOfDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The office day the schedule fills — local time, Monday–Friday, 09:00–18:30. */
export const WORK_START_MINUTES = 9 * 60;
export const WORK_END_MINUTES = 18 * 60 + 30;

function isWeekend(d: Date): boolean {
  const g = d.getDay();
  return g === 0 || g === 6;
}

/** A copy of `d` set to `minutes` past local midnight. */
export function atMinutes(d: Date, minutes: number): Date {
  const c = new Date(d.getTime());
  c.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return c;
}

/**
 * The next moment work is available at or after `d` (local, Mon–Fri, office day).
 *
 * Before the day opens → its opening; after it closes or on a weekend → the next
 * weekday's opening; already mid-day → `d` unchanged.
 */
export function nextWorkStart(d: Date): Date {
  let c = new Date(d.getTime());
  for (let guard = 0; guard < 4000; guard++) {
    if (isWeekend(c)) {
      c = atMinutes(c, WORK_START_MINUTES);
      c.setDate(c.getDate() + 1);
      continue;
    }
    const mins = c.getHours() * 60 + c.getMinutes();
    if (mins < WORK_START_MINUTES) return atMinutes(c, WORK_START_MINUTES);
    if (mins >= WORK_END_MINUTES) {
      c = atMinutes(c, WORK_START_MINUTES);
      c.setDate(c.getDate() + 1);
      continue;
    }
    return c;
  }
  return c;
}

/** Advance `secs` of WORKING time from a work moment, rolling over off-hours. */
function addWorkSeconds(start: Date, secs: number): Date {
  let cursor = nextWorkStart(start);
  let remaining = Math.max(0, secs);
  for (let guard = 0; guard < 4000 && remaining > 0; guard++) {
    const dayEnd = atMinutes(cursor, WORK_END_MINUTES);
    const avail = (dayEnd.getTime() - cursor.getTime()) / 1000;
    if (remaining <= avail) {
      cursor = new Date(cursor.getTime() + remaining * 1000);
      remaining = 0;
    } else {
      remaining -= avail;
      cursor = nextWorkStart(dayEnd);
    }
  }
  return cursor;
}

export interface ScheduledSpan {
  id: string;
  startMs: number;
  endMs: number;
}

/**
 * Lay a serial queue across working time — one thing at a time, no time overlap.
 *
 * A person cannot do two tasks at the same MOMENT, but a day has hours, so a day
 * can hold several. Each task takes its budget of working seconds starting where
 * the last one ended; a task longer than the rest of the day spills into the next
 * weekday. The result is a set of non-overlapping [start, end] windows — the
 * honest picture of a serial worker, several small tasks fitting into one day and
 * a long one running across several.
 */
export function scheduleBusinessTime(
  items: readonly { id: string; secs: number }[],
  startMs: number,
): ScheduledSpan[] {
  let cursor = nextWorkStart(new Date(startMs));
  const out: ScheduledSpan[] = [];
  for (const it of items) {
    const start = cursor;
    const end = addWorkSeconds(start, Math.max(60, it.secs));
    out.push({ id: it.id, startMs: start.getTime(), endMs: end.getTime() });
    cursor = nextWorkStart(end);
  }
  return out;
}
