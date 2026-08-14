/**
 * What counts as a meeting, and who was in it.
 *
 * ## Two faults this answers, and they share a cause
 *
 * The panel counted `attendance.length` — ROWS, not people. A row is written
 * every time somebody arrives, so one person leaving and rejoining five times
 * produced five rows.
 *
 *  · **"10 people"** on a session that was two. Soumya and RAKESH rejoining
 *    five times each read as ten attendees, which is the one figure on that
 *    panel somebody will argue about.
 *  · **A meeting that never happened.** 327 of 366 stored sessions have a
 *    single person in them, 324 of those credited nothing. Opening a task's
 *    room and closing it is not a meeting, and listing it as one put a
 *    conversation on the record of tasks where none took place.
 *
 * Counting DISTINCT employees fixes both: the same person is one person however
 * many times they came back, and one person alone is nobody to meet.
 *
 * Nothing is deleted. A solo session is a real record of somebody opening the
 * room and stays where it is — it is simply not a meeting, so it is not listed
 * as one.
 */

export interface AttendanceLike {
  employeeId: string;
}

export interface SessionLike {
  attendance: readonly AttendanceLike[];
  endedAt?: string | null;
}

/**
 * The people in a session, each once, in the order they first arrived.
 *
 * Order matters for display: the first name is whoever opened the room, which
 * is the one a reader is most likely to be looking for.
 */
export function distinctAttendees(session: SessionLike): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of session.attendance ?? []) {
    const id = String(row?.employeeId ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** How many people were in the room. Never how many times they arrived. */
export function attendeeCount(session: SessionLike): number {
  return distinctAttendees(session).length;
}

/**
 * Was this a meeting at all?
 *
 * Two distinct people is the whole test. One person in a room has met nobody,
 * whatever the clock did.
 *
 * A session still running is always treated as one: somebody is in the room
 * now, a second person may be seconds away, and hiding a live room is how two
 * people end up waiting in it for each other.
 */
export function isRealMeeting(session: SessionLike): boolean {
  if (!session.endedAt) return true;
  return attendeeCount(session) >= 2;
}

/** Only the sessions that were meetings. Order is preserved. */
export function realMeetingsOnly<T extends SessionLike>(sessions: readonly T[]): T[] {
  return sessions.filter(isRealMeeting);
}
