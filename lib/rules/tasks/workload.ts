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
