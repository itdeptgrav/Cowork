import { workingSecsInSpan, type WeekSchedule } from "./deadlineCompensation.ts";

/**
 * Work done after the office has closed pulls the deadline EARLIER.
 *
 * ## The rule
 *
 * A timer session that runs outside office hours is time the person gave that
 * the working day was never going to provide. The deadline is a commitment
 * measured in working time, so time found outside it is time the commitment no
 * longer needs:
 *
 *     newDueAt = dueAt − (after-office-hours seconds in the session)
 *
 * Due 10 Sep 11:00, an hour worked after close on the 9th → due 10 Sep 10:00.
 *
 * ## Why this is the mirror of `deadlineCompensation`, not a rival to it
 *
 * That module states the other half: a deadline moves LATER by working time
 * somebody LOST — `dueAt + Σ(lost working time)`. This is the same commitment
 * arithmetic in the other direction, over the complement of the same span, and
 * it deliberately reuses that module's `workingSecsInSpan` rather than walking
 * the week again. There is one answer to "when is the office open" and it lives
 * there; after-hours time is simply everything the walk did not claim.
 *
 * The two cannot double-count. Compensation credits time in the three
 * UNAVAILABLE states, bounded to office hours. This credits time with a timer
 * demonstrably RUNNING, bounded to everything outside them. No second of wall
 * clock can be both.
 *
 * ## What it will not do
 *
 * **It never moves a deadline into the past.** Subtracting in full is the rule
 * as written, and on a deadline a few hours away it marks the task overdue as
 * the reward for working late — punishing the exact behaviour being credited.
 * The subtraction stops at the moment of the pause. Time that cannot be applied
 * is simply not applied; nothing is banked for later, because a credit nobody
 * can see is not a credit.
 *
 * **It never moves the date later**, whatever the arithmetic says. A task
 * already past its deadline stays exactly where it is.
 *
 * **It touches only the standard flow.** Self-assigned, goal, recurring and
 * external tasks, cross-department work, anything with a dependency it is
 * waiting on, and a task broken down into subtasks are all left alone — each
 * settles its dates by a rule of its own, and a second mechanism quietly
 * editing them would make two systems disagree. Emergency Mode is not a task
 * type at all; it is a presence state, and its credit is `deadlineShift`'s.
 *
 * **It reads the clock, never the counter.** The span comes from the session's
 * own start and pause instants — the same span the work commit records — so
 * what is credited and what is banked can never disagree.
 */

/**
 * Task types that settle their own dates.
 *
 * `standard` is the whole of the standard flow. Everything else in `TaskType`
 * is here because it does something different with time: a `self_assigned`
 * task's date is a proposal its approver decides, a `goal` carries no task
 * deadline at all, `recurring` regenerates its own, and `external` is not this
 * office's working day.
 */
const CREDITED_TYPE = "standard";

/** Everything the eligibility question needs, and nothing else. */
export interface AfterHoursTask {
  type: string;
  /**
   * The task has reached a state whose date is a record rather than a
   * commitment — done, cancelled or refused.
   *
   * A decided boolean rather than a status string on purpose: the domain and
   * the engine spell these differently ("completed" against "done",
   * "assignment_rejected" against "rejected"), and a rule holding one spelling
   * would silently credit the other. Whoever reads the task knows which
   * vocabulary they are in; this does not have to.
   */
  isFinished: boolean;
  /** The engine raised a sender-side department approval for this task. */
  isCrossDepartment: boolean;
  /** It has an output waiting on somebody else's output. */
  hasDependencies: boolean;
  /** It has been broken down, so it is a project and nobody works it. */
  isProject: boolean;
  /** The stored deadline, or null where the date comes from the queue. */
  dueAtMs: number | null;
}

/**
 * Why this task's deadline is not moved by after-hours work — or null when it
 * is.
 *
 * A sentence rather than a boolean because these are the reasons a person asks
 * about ("I worked all evening and nothing changed"), and a caller that wants
 * the yes/no can read it as one.
 */
export function afterHoursCreditRefusal(task: AfterHoursTask): string | null {
  if (task.type !== CREDITED_TYPE)
    return "Only a standard task's deadline moves for after-hours work; this type settles its dates its own way.";
  if (task.isCrossDepartment)
    return "A cross-department task's dates are settled with the other department.";
  if (task.hasDependencies)
    return "This task is waiting on another task's output, so its date is not its own to move.";
  if (task.isProject)
    return "This task has been broken down — nobody works a project directly, so there is nothing to credit.";
  if (task.isFinished)
    return "This task is finished, and a finished task's deadline is a record rather than a commitment.";
  if (task.dueAtMs === null)
    return "This task carries no deadline of its own — its date comes from the queue, and the queue reads the time already logged.";
  return null;
}

/**
 * The seconds of a span that fell outside office hours.
 *
 * The complement of `workingSecsInSpan` over the same span, so a session that
 * starts before closing and ends after it splits itself with no special case:
 * the part inside the day is claimed by the walk, and what is left is this.
 *
 * A day the office is shut contributes in full, from midnight to midnight —
 * both kinds of shut. The weekly schedule answers for a Sunday; a public
 * holiday or a day of approved leave is not IN that schedule, it falls on an
 * ordinary Tuesday, so those arrive separately as `blockedDates` and are taken
 * off the office total here. Without them, somebody working through Diwali
 * would be credited only the evening of it.
 *
 * **No schedule credits nothing.** `workingSecsInSpan` returns 0 for an
 * unreadable calendar, which taken as a complement would make an entire working
 * afternoon "after hours" and pull the deadline forward by all of it. Refused
 * explicitly: an unknown calendar is not a licence to move a scored deadline —
 * and the safe direction here is the opposite of the safe direction for a
 * credit that moves a deadline later.
 */
export function afterHoursSecs(input: {
  startMs: number;
  endMs: number;
  schedule: WeekSchedule | null;
  /**
   * Days the office was shut that the weekly schedule cannot know about —
   * public holidays and approved leave, as "YYYY-MM-DD" in the same local
   * calendar the schedule is read in. Absent means none were fetched, which is
   * also what an unreachable HR side looks like: the credit is then smaller
   * than it should be, never larger.
   */
  blockedDates?: ReadonlySet<string> | null;
}): number {
  const { startMs, endMs, schedule, blockedDates } = input;
  if (!schedule) return 0;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  if (endMs <= startMs) return 0;

  const elapsed = Math.round((endMs - startMs) / 1000);
  const inOffice =
    workingSecsInSpan({ startMs, endMs, schedule }) -
    closedDaySecs({ startMs, endMs, schedule, blockedDates });
  return Math.max(0, elapsed - Math.max(0, inOffice));
}

/** "YYYY-MM-DD" in local time, matching how the schedule days are read. */
function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Office-hours seconds the walk counted on days the office was actually shut.
 *
 * Subtracted rather than folded into the walk, because that walk is
 * `deadlineCompensation`'s and shared with absence credit — teaching it about
 * holidays would change what an absence is worth, which is a different feature
 * and not one being asked for. The correction lives here, where it is wanted.
 */
function closedDaySecs(input: {
  startMs: number;
  endMs: number;
  schedule: WeekSchedule;
  blockedDates?: ReadonlySet<string> | null;
}): number {
  const { startMs, endMs, schedule, blockedDates } = input;
  if (!blockedDates || blockedDates.size === 0) return 0;

  let total = 0;
  const cursor = new Date(startMs);
  cursor.setHours(0, 0, 0, 0);
  /* Bounded exactly as the walk it corrects is: a year of days is past any
     real session, and longer is a clock fault rather than an input. */
  for (let i = 0; i < 366 && cursor.getTime() <= endMs; i++) {
    if (blockedDates.has(localDateKey(cursor))) {
      const dayStart = Math.max(startMs, cursor.getTime());
      const dayEnd = Math.min(endMs, new Date(cursor).setHours(24, 0, 0, 0));
      if (dayEnd > dayStart)
        total += workingSecsInSpan({ startMs: dayStart, endMs: dayEnd, schedule });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

/** What the deadline becomes, and how much of the credit reached it. */
export interface AfterHoursMove {
  /** The deadline after the move. */
  newDueAtMs: number;
  /** Seconds actually taken off — never more than `creditSecs`. */
  appliedSecs: number;
  /** Seconds the floor refused, because the date would have gone past `now`. */
  unappliedSecs: number;
}

/**
 * The deadline after crediting `creditSecs` of after-hours work.
 *
 * Null when nothing moves: no credit, no deadline, or a date the floor holds
 * exactly where it is. A caller must not write a "change" of zero — an audit
 * row saying 11:00 → 11:00 is noise in the one place a person goes to find out
 * why their date changed.
 */
export function pulledBackDueAt(input: {
  dueAtMs: number;
  creditSecs: number;
  nowMs: number;
}): AfterHoursMove | null {
  const { dueAtMs, creditSecs, nowMs } = input;
  if (!Number.isFinite(dueAtMs) || creditSecs <= 0) return null;

  const wanted = dueAtMs - creditSecs * 1000;
  /* The floor, and the guard against moving the date LATER. A deadline that is
     already past sits at or before `now`, so `Math.max` alone would push it
     forward; taking the earlier of the two keeps it still. */
  const newDueAtMs = Math.min(dueAtMs, Math.max(wanted, nowMs));
  if (newDueAtMs >= dueAtMs) return null;

  const appliedSecs = Math.round((dueAtMs - newDueAtMs) / 1000);
  return {
    newDueAtMs,
    appliedSecs,
    unappliedSecs: Math.max(0, creditSecs - appliedSecs),
  };
}

/** "1h 30m", "45m", "20s" — the same shape the rest of the task history uses. */
function duration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${secs}s`;
}

/**
 * The line the task's history carries, and the only account of the move.
 *
 * It names what was worked and what was applied separately, because the floor
 * can make them differ and "I worked two hours and it moved by twenty minutes"
 * is answered by the sentence or by nothing.
 */
export function afterHoursCreditReason(move: AfterHoursMove): string {
  const applied = `Worked ${duration(move.appliedSecs + move.unappliedSecs)} after office hours`;
  return move.unappliedSecs > 0
    ? `${applied} — ${duration(move.appliedSecs)} applied, the rest would have put the deadline in the past`
    : `${applied} — deadline brought forward by ${duration(move.appliedSecs)}`;
}
