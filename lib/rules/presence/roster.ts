/**
 * The shapes a presence roster is built from.
 *
 * Types only. The arithmetic that used to live here — ordering a roster and
 * summing a day — moved to `attendanceDay.ts` when the dashboard card became
 * the attendance drawer, and it did not move unchanged: the version here
 * measured a session from its start and never bounded it to the day, which
 * reported "233h today" for somebody who had simply never gone offline. A day
 * does not contain 233 hours. Everything in `attendanceDay.ts` is clipped to
 * the day window for that reason, and nothing is left behind here that could be
 * picked up and used again by mistake.
 *
 * What remains is the vocabulary the two repositories and the UI share, so a
 * store writing these facts and a component reading them cannot drift.
 */
import type { DutyMode } from "./duty.ts";

/**
 * One person's duty facts, as a store reports them.
 *
 * `closedSecs` and the running session are held APART rather than pre-summed:
 * the accumulator is a shared field with its own meaning, and a reader that
 * needs "so far today" adds the live part itself, where it can also bound it.
 */
export interface DutyFacts {
  mode: DutyMode;
  /**
   * Seconds banked in today's accumulator, from CLOSED sessions only.
   *
   * The engine's own `dailyHours` field, incremented when a session ends.
   * `dailyHoursSecs` returns exactly this and deliberately does not add the
   * running session, so every reader of that field agrees with every other.
   */
  closedSecs: number;
  /** Epoch ms of the last mode change — `updatedAt`, or null on an old doc. */
  sinceMs: number | null;
}

/**
 * A person, as a presence view needs them.
 *
 * A subset of `Employee`, so any directory row satisfies it and the rules stay
 * testable with three fields. `hue` keeps the domain's own union rather than
 * widening to `number`: the avatar palette is closed, and a row that widened it
 * could not be handed back to `Avatar` without a cast.
 */
export interface RosterPerson {
  id: string;
  displayName: string;
  initials: string;
  hue: 0 | 1 | 2 | 3 | 4 | 5;
  designation?: string | null;
  profilePictureUrl?: string | null;
}
