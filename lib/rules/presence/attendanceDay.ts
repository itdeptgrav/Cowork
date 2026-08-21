/**
 * One person's day, as an attendance line: when they came on, when they went
 * off, and how long that adds up to.
 *
 * ## What this fixes, beyond adding times
 *
 * The roster's first version reported "Online for 233h · 233h today", and both
 * halves of that were failures of a different kind. The first is *honest* and
 * useless — presence is never revoked by a clock (a status is only changed by
 * the person whose status it is, see `readDutyMode`), so somebody who closed
 * their laptop nine days ago is genuinely still "online for 233 hours". The
 * second is simply **wrong**: a day does not contain 233 hours, and any figure
 * labelled "today" that exceeds a day is a bug on its face.
 *
 * Both come from measuring a session by its START and never bounding it to the
 * day being reported. So everything here is CLIPPED to the day window, and the
 * display leads with the two instants a person actually asks for — "9:30 AM →
 * 6:30 PM" — rather than an elapsed figure that grows without limit.
 *
 * ## Where the facts come from
 *
 * `cowork_duty_history` holds one row per transition, stamping only the moment
 * a mode BEGAN; `spanRows` (already tested, already used by the status history
 * modal) closes each row against the next and merges the duplicate writes a
 * second device or a retry leaves behind. This module is the day view over
 * those spans, with the live duty document as the fallback for somebody whose
 * session started before today and so has no transition in it.
 *
 * Pure: instants in, instants out. The clock is a parameter.
 */
import type { DutyMode } from "./duty.ts";
import type { DutyHistoryEntry } from "./duty.ts";
import { spanRows } from "./historyLog.ts";
import type { DutyFacts, RosterPerson } from "./roster.ts";

/** IST is UTC+05:30 and has never observed daylight saving — the one offset
 *  every displayed time in Cowork uses (`lib/utils/format.ts`). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * One stretch of being on duty, bounded to the day being reported.
 *
 * `toMs` is null while it is still running — "has not ended" and "ended just
 * now" are different facts, and only one of them may be printed as a time.
 */
export interface AttendanceSession {
  fromMs: number;
  toMs: number | null;
  /** The stretch began before the day window and was clipped to it. */
  carriedIn: boolean;
}

export interface AttendanceRow extends RosterPerson {
  mode: DutyMode;
  /** Every online stretch of the day, oldest first. */
  sessions: AttendanceSession[];
  /** The first time they came on duty today, or null if they never did. */
  firstOnMs: number | null;
  /** When the last completed stretch ended. Null while one is still running. */
  lastOffMs: number | null;
  /** Total time on duty today, in seconds — the sum of the stretches shown. */
  onlineSecs: number;
  /** Still on duty right now. */
  live: boolean;
}

/**
 * The day window a report covers, in epoch ms.
 *
 * Half-open — `[startMs, endMs)` — so an instant belongs to exactly one day
 * and a session ending at midnight is not counted twice.
 */
export interface DayWindow {
  startMs: number;
  endMs: number;
}

/**
 * The IST calendar day an instant falls in.
 *
 * **IST rather than the duty document's UTC `dailyHours` key**, and the
 * difference is not pedantry: a workday of 09:30–18:30 IST is 04:00–13:00 UTC
 * and sits inside one UTC day, but anybody working past 05:30 IST *in the
 * morning* — or reading the card at 01:00 IST — is looking at a "day" that
 * disagrees with the one on their wall. The times on this card are printed in
 * IST, so the day they are grouped by is IST too; a card whose rows say 9:30 AM
 * under a heading for the wrong date is worse than either convention alone.
 */
export function istDayWindow(nowMs: number): DayWindow {
  const shifted = new Date(nowMs + IST_OFFSET_MS);
  const startShifted = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  const startMs = startShifted - IST_OFFSET_MS;
  return { startMs, endMs: startMs + 86_400_000 };
}

/**
 * Build one person's attendance line for the day.
 *
 * The history is authoritative where it exists, because the times printed have
 * to be the times that add up to the total beside them. The duty document is
 * the fallback for the one case history cannot answer: a session that began
 * before this day and has never ended, which leaves no transition inside the
 * window at all.
 */
export function attendanceRow(input: {
  person: RosterPerson;
  facts: DutyFacts | undefined;
  /** Today's transitions for this person, NEWEST FIRST — as stored. */
  entries: readonly DutyHistoryEntry[];
  day: DayWindow;
  nowMs: number;
}): AttendanceRow {
  const { person, facts, entries, day, nowMs } = input;
  const mode: DutyMode = facts?.mode ?? "offline";
  const live = mode === "online";

  /* `spanRows` closes each transition against the one after it and merges the
     repeat writes; the newest is left open and measured against now. */
  const spans = spanRows(entries, nowMs);
  const sessions: AttendanceSession[] = [];

  for (const span of spans) {
    if (span.entry.mode !== "online") continue;
    const rawFrom = span.entry.at;
    const rawTo = span.ongoing ? nowMs : span.untilMs;
    /* Clipped to the window at BOTH ends. A stretch that started yesterday
       contributes only its part of today; one that has not ended contributes
       only up to now. This is the whole of the "233h today" fix. */
    const fromMs = Math.max(rawFrom, day.startMs);
    const toMs = Math.min(rawTo, day.endMs);
    if (toMs <= fromMs) continue;
    sessions.push({
      fromMs,
      toMs: span.ongoing ? null : toMs,
      carriedIn: rawFrom < day.startMs,
    });
  }

  /**
   * Nothing in the log, but they are on duty now.
   *
   * The session began before today — or before the history log existed — so
   * there is no transition inside the window to find. Their duty document
   * still knows when the mode began, and clipping that to the window is the
   * honest reading: "on duty since midnight, carried in from earlier".
   */
  if (sessions.length === 0 && live) {
    const began = facts?.sinceMs ?? null;
    const fromMs =
      began !== null && began > day.startMs && began <= nowMs
        ? began
        : day.startMs;
    sessions.push({
      fromMs,
      toMs: null,
      carriedIn: began === null || began <= day.startMs,
    });
  }

  /* Oldest first — the order a day is read in. */
  sessions.sort((a, b) => a.fromMs - b.fromMs);

  const onlineSecs = sessions.reduce(
    (total, s) =>
      total + Math.max(0, Math.round(((s.toMs ?? nowMs) - s.fromMs) / 1000)),
    0,
  );

  const completed = sessions.filter((s) => s.toMs !== null);
  return {
    ...person,
    mode,
    sessions,
    firstOnMs: sessions.length ? sessions[0].fromMs : null,
    /* Only when nothing is running: an "off at" beside a live session would be
       reporting an end that has not happened. */
    lastOffMs:
      sessions.length && sessions[sessions.length - 1].toMs !== null
        ? (completed[completed.length - 1]?.toMs ?? null)
        : null,
    onlineSecs,
    live,
  };
}

/** Rank for the report's order: on duty first, then away, then gone. */
const MODE_RANK: Record<DutyMode, number> = {
  online: 0,
  emergency: 1,
  break: 2,
  offline: 3,
};

/**
 * The day's report, ordered the way it is read.
 *
 * On duty first — the administrator's question is "who is here" — then by the
 * most time logged today, so the people who have actually worked the day lead
 * their group. Names break the final tie so identical rows cannot reshuffle
 * between two renders.
 */
export function attendanceReport(input: {
  people: readonly RosterPerson[];
  facts: ReadonlyMap<string, DutyFacts>;
  /** Today's transitions per employee id, newest first. */
  history: ReadonlyMap<string, readonly DutyHistoryEntry[]>;
  nowMs: number;
}): AttendanceRow[] {
  const day = istDayWindow(input.nowMs);
  const rows = input.people.map((person) =>
    attendanceRow({
      person,
      facts: input.facts.get(person.id),
      entries: input.history.get(person.id) ?? [],
      day,
      nowMs: input.nowMs,
    }),
  );
  return rows.sort((a, b) => {
    const rank = MODE_RANK[a.mode] - MODE_RANK[b.mode];
    if (rank !== 0) return rank;
    if (b.onlineSecs !== a.onlineSecs) return b.onlineSecs - a.onlineSecs;
    return a.displayName.localeCompare(b.displayName);
  });
}

/* ── Wording ──────────────────────────────────────────────────────────────── */

/** `9:30 AM` — IST, twelve-hour, the way the times were asked for. */
export function clockLabel(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const d = new Date(ms + IST_OFFSET_MS);
  const hours24 = d.getUTCHours();
  const suffix = hours24 < 12 ? "AM" : "PM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${suffix}`;
}

/** `18 Aug` — IST. */
export function dayLabel(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const d = new Date(ms + IST_OFFSET_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** `18 Aug, 9:30 AM` — the full stamp, for a row that may span a date. */
export function stampLabel(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  return `${dayLabel(ms)}, ${clockLabel(ms)}`;
}

/**
 * One session as a person reads it: `9:30 AM → 6:30 PM`.
 *
 * A running session says so in words rather than printing a time that has not
 * happened; a session carried in from before midnight keeps its date so
 * "12:00 AM" is not mistaken for somebody starting work at midnight.
 */
export function sessionLabel(session: AttendanceSession): string {
  const from = session.carriedIn
    ? `from ${clockLabel(session.fromMs)}`
    : clockLabel(session.fromMs);
  return session.toMs === null
    ? `${from} → now`
    : `${from} → ${clockLabel(session.toMs)}`;
}

/**
 * The day in one line: first on, last off, and whether it is still running.
 *
 * The single sentence the card leads with, because it is the question —
 * "Online: 18 Aug, 9:30 AM → Offline: 18 Aug, 6:30 PM".
 */
export function dayLabelFor(row: AttendanceRow): string {
  if (row.sessions.length === 0)
    return row.mode === "offline" ? "Not on duty today" : "No sessions today";
  const first = clockLabel(row.firstOnMs);
  if (row.live) return `${first} → still on duty`;
  return `${first} → ${clockLabel(row.lastOffMs)}`;
}

/** `8h 05m`, `45m`, `0m` — padded so a column of figures lines up. */
export function durationLabel(secs: number): string {
  const total = Number.isFinite(secs) ? Math.max(0, Math.round(secs)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (m === 60) return `${h + 1}h 00m`;
  if (!h) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
