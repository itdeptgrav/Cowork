/**
 * Reading a stored timer session — the two figures every screen needs.
 *
 * ## Why this is one function and not two readings
 *
 * `cowork_task_timers/{employeeId}/sessions/{taskId}` has been written by two
 * applications over several years, and it shows: the banked total lives under
 * `totalSecs` OR `totalSeconds`, and the current run's origin arrives as an
 * epoch number, a Firestore `Timestamp` object or an ISO string depending on
 * which one wrote it last.
 *
 * There were two independent readers of that document, and they disagreed on
 * both points:
 *
 *  · `getActiveTimer` — the top-bar pill — tried `totalSecs` first and parsed
 *    the start tolerantly.
 *  · `toTimerSession` — the task page and every live listener — tried
 *    `totalSeconds` first and accepted the start ONLY when it was already a
 *    number.
 *
 * So a document carrying both names was read as two different totals depending
 * on which screen asked; and where the start was a Timestamp or a string, the
 * task page saw no origin at all, `displaySecs` fell back to the banked total,
 * and **the run in progress vanished** — which is the reported "the timer shows
 * one figure, then a different one after a reload".
 *
 * Neither reader was wrong in isolation. Having two was the bug. This is the
 * single reading, and it is pure, so the agreement is testable without a
 * Firestore.
 */

export interface StoredTimerFigures {
  /** Seconds banked by completed runs. Never includes the run in progress. */
  accumulatedSecs: number;
  /**
   * Epoch ms the CURRENT run began, or null when nothing is running.
   *
   * Null is a real answer — a paused session has banked seconds and no origin —
   * so a caller must not read it as "unknown" and substitute the clock.
   */
  startedAtRealMs: number | null;
}

/** Epoch ms out of an epoch number, a Firestore `Timestamp`, or an ISO string. */
export function readTimerInstant(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object") {
    const r = value as { seconds?: unknown; _seconds?: unknown };
    if (typeof r.seconds === "number") return r.seconds * 1000;
    if (typeof r._seconds === "number") return r._seconds * 1000;
    return null;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The banked total and the current run's origin, however the document spells
 * them.
 *
 * `totalSecs` before `totalSeconds`, matching `wire.ts`'s own `totalSeconds()`
 * helper — the order is arbitrary but it has to be the SAME arbitrary order
 * everywhere, which is the entire point of this file.
 */
export function readTimerFigures(
  data: Record<string, unknown> | null | undefined,
): StoredTimerFigures {
  if (!data) return { accumulatedSecs: 0, startedAtRealMs: null };

  const banked = [data.totalSecs, data.totalSeconds].find(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );

  return {
    accumulatedSecs: banked ?? 0,
    /* `startedAt` is the older name, kept as a fallback for sessions written
       before the rename. */
    startedAtRealMs: readTimerInstant(data.lastStartTime ?? data.startedAt),
  };
}
