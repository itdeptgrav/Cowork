/**
 * How long a work session lasted.
 *
 * **The bug this exists to prevent.** Cowork's prototype clock only advances
 * when a mutation calls `tick()` — it does not track real time, so it stands
 * still for the entire period somebody is actually working. `pauseTimer`
 * measured the session against that clock, having first advanced it a full
 * minute, and floored the result at 60 seconds. Ten seconds of work therefore
 * committed as 1:00, and every further pause added another minute:
 *
 *     start → work 10s → pause     committed 60s, displayed 1:00
 *     resume → work 10s → pause    committed 60s, displayed 2:00
 *
 * A stopwatch has to measure real elapsed time. Both halves of the product now
 * read it from the same pair of timestamps through this module: the repository
 * to write the `WorkCommit`, the timer control to render the running count.
 * They cannot disagree about how long a session has lasted, because neither of
 * them decides it.
 */

/** Never zero — a commit recording no work is not a record of work. */
const MIN_COMMIT_SECS = 1;

/**
 * Seconds between a real start and a real now, or 0 when nothing is running.
 *
 * Always DERIVED from two timestamps rather than accumulated by counting. A
 * counter loses time whenever its interval is throttled — a backgrounded tab,
 * a sleeping laptop — and never recovers it. Subtraction catches up on the next
 * tick however long the gap was.
 */
export function elapsedSecs(
  startedAtRealMs: number | null,
  nowRealMs: number,
): number {
  if (startedAtRealMs === null) return 0;
  return Math.max(0, Math.round((nowRealMs - startedAtRealMs) / 1000));
}

/**
 * The duration to commit for one run, in seconds.
 *
 * `fallbackSimElapsedMs` covers a session recorded before real starts were
 * stored: there is nothing real to measure against, so it falls back to the
 * prototype clock exactly as before — minus the minute of inflation.
 */
export function runDurationSecs(input: {
  startedAtRealMs: number | null;
  nowRealMs: number;
  fallbackSimElapsedMs: number;
}): number {
  const { startedAtRealMs, nowRealMs, fallbackSimElapsedMs } = input;
  const ms =
    startedAtRealMs !== null
      ? Math.max(0, nowRealMs - startedAtRealMs)
      : Math.max(0, fallbackSimElapsedMs);
  return Math.max(MIN_COMMIT_SECS, Math.round(ms / 1000));
}

/**
 * How many seconds of a run may be BANKED — capped at the last liveness beat.
 *
 * A running clock writes a heartbeat every ~45s. Time past the last beat, plus
 * the same staleness grace presence uses, was NOT worked: the tab was closed or
 * the laptop asleep, so no beat came. Banking only up to that point is what stops
 * a session left running across a long gap from crediting the whole gap — the
 * "1:59:39 for a five-minute run" figure.
 *
 * A live pause is unaffected. Its last beat is at most one interval old, so
 * `lastBeat + grace` is comfortably in the future and the cap never bites; the
 * result is the full `now - start`. `heartbeatAtRealMs` absent (a session from
 * before beats existed) falls back to the start, so an un-beaten run banks at
 * most the grace — safe, and self-corrects the moment beats resume.
 */
export function bankableRunSecs(input: {
  startedAtRealMs: number | null;
  heartbeatAtRealMs: number | null;
  nowRealMs: number;
  graceMs: number;
}): number {
  const { startedAtRealMs, heartbeatAtRealMs, nowRealMs, graceMs } = input;
  if (startedAtRealMs === null) return 0;
  const lastBeat = heartbeatAtRealMs ?? startedAtRealMs;
  const bankedUntil = Math.min(nowRealMs, lastBeat + graceMs);
  return Math.max(0, Math.round((bankedUntil - startedAtRealMs) / 1000));
}

/**
 * A session left running past any plausible working stretch.
 *
 * Real and already in production: `GR0067/T623` is `isActive: true` with a
 * `lastStartTime` from a previous day, so a naive `now - lastStartTime` reports
 * tens of hours of continuous work. Legacy has an auto-pause that makes this
 * rare rather than impossible — a clock started before a laptop slept is still
 * running when it wakes, and nothing closes it until the person returns.
 *
 * The threshold is a working day's outer bound rather than a guess at when
 * somebody stopped. **Nothing is written and nothing is truncated**: the banked
 * total is untouched and the real elapsed is still available. This only decides
 * whether a figure is fit to put on screen as "currently working", because a
 * running clock reading 41:12:07 is not information — it is a bug the reader
 * has to diagnose, and it inflates every total derived from it.
 */
export const STALE_RUN_AFTER_SECS = 16 * 3600;

export function isStaleRun(
  startedAtRealMs: number | null,
  nowRealMs: number,
): boolean {
  if (startedAtRealMs === null) return false;
  return elapsedSecs(startedAtRealMs, nowRealMs) > STALE_RUN_AFTER_SECS;
}

/**
 * What to SHOW for a session, given what the record says.
 *
 * One place, so the control, the manager's view and any list agree. The state
 * is derived from the stored document — `isActive` and `lastStartTime` — never
 * from a React flag, which is what let a paused task keep rendering as running.
 */
export type TimerDisplayState =
  | "not_started"
  | "running"
  | "paused"
  | "stale";

export function timerDisplayState(
  session: { isActive?: boolean; startedAtRealMs?: number | null } | null,
  bankedSecs: number,
  nowRealMs: number,
): TimerDisplayState {
  if (!session) return bankedSecs > 0 ? "paused" : "not_started";
  if (!session.isActive) return bankedSecs > 0 ? "paused" : "not_started";
  if (isStaleRun(session.startedAtRealMs ?? null, nowRealMs)) return "stale";
  return "running";
}

/**
 * The seconds to display: banked work plus the current run.
 *
 * A stale run contributes NOTHING. Adding tens of hours nobody worked would
 * put a wrong figure in front of a manager and into every total built on it —
 * the run is reported as needing attention instead.
 */
export function displaySecs(
  session: { isActive?: boolean; startedAtRealMs?: number | null } | null,
  bankedSecs: number,
  nowRealMs: number,
): number {
  const state = timerDisplayState(session, bankedSecs, nowRealMs);
  if (state !== "running") return bankedSecs;
  return bankedSecs + elapsedSecs(session?.startedAtRealMs ?? null, nowRealMs);
}
