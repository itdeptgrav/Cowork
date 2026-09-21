/* Relative and extensioned where a runtime value is needed: the test runner is
   plain `node --test`, which resolves neither the `@/` alias nor an
   extensionless path. These are type-only and therefore erased. */
import type { Meeting } from "@/lib/domain";

/**
 * A meeting that was scheduled, never started, and is now long past.
 *
 * Reported 21 September 2026 with the meetings page as evidence: **Upcoming**
 * held calls scheduled for 8 September, still reading `scheduled`, two weeks
 * after the moment they were for. "Upcoming" is a promise about the future, and
 * a fortnight-old row that nobody will ever open breaks it — the section people
 * look at to see what is next becomes the section they have to read past.
 *
 * The rule asked for: **if it has not started within 24 hours of the time it
 * was scheduled for, it is expired.** A meeting set for 8 September at 5:00 PM
 * that never opened is expired from 9 September at 5:00 PM.
 *
 * **Derived, not stored, and that is the point.**
 *
 * Nothing writes an `expired` status and no job sweeps for one. Expiry is a
 * function of two values the meeting already carries — when it was for, and
 * whether it ever started — so it is computed where it is displayed. Three
 * things follow, all of them wanted:
 *
 *   · it applies to the meetings already in the database, including the ones in
 *     the screenshot, the moment this ships — a stored flag would need a
 *     backfill to reach them;
 *   · `MeetingStatus` and the engine's documents are untouched, so nothing that
 *     reads or writes a meeting today has to learn a new value;
 *   · it cannot drift. A stored flag written by a nightly job is wrong for up
 *     to a day and stays wrong if the job misses a night. This is right on
 *     every read by construction.
 *
 * **Expiry is about display, not permission.** It answers "should this still
 * be sitting under Upcoming", not "may the organiser start it". Nothing here
 * blocks starting, joining or editing; the existing rules in `access.ts` decide
 * those and are deliberately not consulted from here.
 */

/**
 * How long after its scheduled time a meeting that never opened is expired.
 *
 * Twenty-four hours, as asked for. A named constant rather than a literal
 * because the tests state the rule in terms of it, so the window can be changed
 * in one place and the tests keep meaning what they say.
 */
export const MEETING_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether this meeting is a scheduled one that never happened.
 *
 * False for every other status, and that is not a technicality:
 *
 *   · `live` / `waiting` — it is open right now, whatever the clock says about
 *     when it was meant to start;
 *   · `completed` / `archived` — it happened, and "expired" would overwrite a
 *     true statement with a false one;
 *   · `cancelled` — somebody decided this. Calling it expired would replace a
 *     deliberate act with a lapse, and the row already reads Cancelled.
 *
 * `startedAt` is checked as well as the status, because a meeting that opened
 * and was never closed properly is a stale room rather than a lapsed booking —
 * it has a different problem and would be wrong to file under this one.
 *
 * An unreadable `startsAt` expires nothing. A date the product cannot parse is
 * a fault to fix, not a licence to hide somebody's meeting.
 */
export function hasExpired(meeting: Meeting, nowMs: number): boolean {
  if (meeting.status !== "scheduled") return false;
  if (meeting.startedAt !== null) return false;

  const startsMs = Date.parse(meeting.startsAt);
  if (!Number.isFinite(startsMs)) return false;

  return nowMs - startsMs >= MEETING_EXPIRY_MS;
}

/**
 * The instant a scheduled meeting expires, or null if it never will.
 *
 * Returned for the copy that has to name the moment rather than assert it, and
 * so a caller can say "expires tomorrow at 17:00" without doing the arithmetic
 * again and risking a different answer from the badge beside it.
 */
export function expiresAtMs(meeting: Meeting): number | null {
  if (meeting.status !== "scheduled" || meeting.startedAt !== null) return null;
  const startsMs = Date.parse(meeting.startsAt);
  return Number.isFinite(startsMs) ? startsMs + MEETING_EXPIRY_MS : null;
}

/**
 * What the row should SAY this meeting is.
 *
 * The stored status everywhere except the one case it no longer describes.
 * Returning a plain string rather than widening `MeetingStatus` is deliberate:
 * the union is the set of values the engine writes, and adding a member the
 * engine can never produce would make every exhaustive switch on it carry a
 * branch for something that cannot arrive from the store.
 */
export function displayStatus(meeting: Meeting, nowMs: number): string {
  if (hasExpired(meeting, nowMs)) return "expired";
  return meeting.status === "waiting" ? "waiting room" : meeting.status;
}
