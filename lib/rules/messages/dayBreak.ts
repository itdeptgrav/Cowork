import { istDayKey } from "../tasks/dailyReport.ts";

/**
 * Where a date separator goes in a message list, and what it says.
 *
 * ## Why a rule rather than a line of JSX
 *
 * "Is this message from today or last Tuesday" is answered by comparing two
 * instants against a CALENDAR, and a calendar has a timezone. Cowork's answer is
 * already written down — `istDayKey` — because the day a thing happened on is a
 * fact the scoring engine, the daily report and the attendance record all have
 * to agree about. A chat that decided days for itself with `toDateString()`
 * would put a message sent at 05:00 IST on the previous day for anybody whose
 * laptop is set to UTC, which is most rented servers and some laptops.
 *
 * So this reuses the same key, and the separator a reader sees agrees with the
 * date their timesheet shows.
 *
 * ## What it deliberately does not do
 *
 * It does not format a time — the bubbles already do that, and two spellings of
 * the same instant is two things to keep in step. It only answers *is there a
 * boundary before this message* and *what should the boundary read*.
 */

/** The minimum a message must expose. Every chat message in Cowork satisfies
    it structurally — the Messages `Message`, the task `TaskChatMessage`, and a
    LiveKit `ChatMessage` once its numeric timestamp is turned into one. */
export interface DatedMessage {
  createdAt: string | number;
}

function msOf(m: DatedMessage): number {
  const v = m.createdAt;
  const ms = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Whether a separator belongs directly above `index`.
 *
 * True for the first message — a thread should open with the day it starts on
 * rather than leaving the reader to work out whether the top of the list is
 * today — and true wherever the calendar day changes.
 *
 * An unreadable timestamp reads as day zero rather than throwing, which means
 * one malformed row cannot put a separator between every pair of messages after
 * it.
 */
export function needsDayBreak(messages: DatedMessage[], index: number): boolean {
  if (index < 0 || index >= messages.length) return false;
  if (index === 0) return true;
  return (
    istDayKey(msOf(messages[index])) !== istDayKey(msOf(messages[index - 1]))
  );
}

/**
 * What the separator reads: `Today`, `Yesterday`, or a written date.
 *
 * `nowMs` is passed rather than read, so the same list renders the same way in
 * a test as on screen, and so a component never reads the clock during a
 * render.
 *
 * The written form omits the year for the current year — "12 August" is how
 * somebody says it — and includes it otherwise, because "12 August" a year
 * later is a different day and reads as a mistake.
 */
export function dayBreakLabel(ms: number, nowMs: number): string {
  const day = istDayKey(ms);
  if (day === istDayKey(nowMs)) return "Today";
  if (day === istDayKey(nowMs - 86_400_000)) return "Yesterday";

  /* Built from the IST key rather than from a locale call on the raw instant,
     so the words match the boundary the separator was placed at. A date
     formatted in the reader's own timezone could name a different day from the
     one the separator was decided by. */
  const [y, m, d] = day.split("-").map(Number);
  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const month = MONTHS[m - 1] ?? "";
  const thisYear = istDayKey(nowMs).slice(0, 4);
  return String(y) === thisYear
    ? `${d} ${month}`
    : `${d} ${month} ${y}`;
}
