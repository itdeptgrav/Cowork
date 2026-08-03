import type { DailyReport } from "@/lib/domain";

/**
 * What a person owes a report on, and whether they have filed it.
 *
 * Pure, and deliberately so: the same two questions are asked from two very
 * different places — the end-of-day modal, which asks about every task at once,
 * and a single task's Reports tab, which asks about one. Answering them in one
 * file is what stops the tab saying a report is pending on a day the modal
 * would not have asked for one.
 */

/**
 * The IST calendar day for an instant.
 *
 * The working day is the unit a report is filed against, and this
 * organisation's working day runs on Indian Standard Time. The browser's own
 * date would file the same evening under two different days for two people in
 * the same room; UTC files everything after 18:30 IST under tomorrow.
 *
 * Must agree with `istDayKey` in the legacy repository, which stamps
 * `reportDate` on the way in. A disagreement here shows up as a report that is
 * filed and still reads as pending.
 */
export function istDayKey(ms: number): string {
  return new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/** One task a person put time against on a given day. */
export interface WorkedTask {
  taskId: string;
  taskTitle: string;
  totalSecs: number;
}

/** The subset of a work commit this rule reads. */
interface CommitLike {
  taskId: string;
  taskTitle: string;
  durationSecs: number;
}

/** The subset of a timer session this rule reads. */
interface TimerLike {
  taskId: string;
  taskTitle?: string;
  isActive: boolean;
  startedAtRealMs: number | null;
}

/**
 * Every task worked on today, with the total time against each.
 *
 * Two sources, because neither alone is the truth. A **commit** is written when
 * a timer is paused, so it covers everything already banked. A **running
 * timer** has banked nothing yet — its current run exists only as a start
 * timestamp — and leaving it out is why a task played for fifty seconds and not
 * paused never appeared in the end-of-day list.
 */
export function workedToday(
  commits: readonly CommitLike[],
  timers: readonly TimerLike[],
  nowMs: number,
): WorkedTask[] {
  const byTask = new Map<string, WorkedTask>();

  const add = (taskId: string, taskTitle: string, secs: number) => {
    if (!taskId || secs <= 0) return;
    const existing = byTask.get(taskId);
    if (existing) {
      existing.totalSecs += secs;
      /* A commit carries a denormalised title and a timer may not. Never let a
         blank or id-shaped title overwrite a real one. */
      if (taskTitle && taskTitle !== taskId) existing.taskTitle = taskTitle;
    } else {
      byTask.set(taskId, { taskId, taskTitle: taskTitle || taskId, totalSecs: secs });
    }
  };

  for (const c of commits) add(c.taskId, c.taskTitle, c.durationSecs);

  for (const t of timers) {
    if (!t.isActive || !t.startedAtRealMs) continue;
    add(
      t.taskId,
      t.taskTitle ?? t.taskId,
      Math.floor((nowMs - t.startedAtRealMs) / 1000),
    );
  }

  return [...byTask.values()].sort((a, b) => b.totalSecs - a.totalSecs);
}

/**
 * Has this person already filed a report on this task for this day?
 *
 * Scoped to the person as well as the day on purpose: two people working the
 * same task each owe their own account of it, and one of them filing does not
 * discharge the other.
 */
export function hasReportFor(
  reports: readonly DailyReport[],
  employeeId: string,
  date: string,
): boolean {
  return reports.some(
    (r) => r.employeeId === employeeId && r.reportDate === date,
  );
}

/**
 * Is a report owed on this task right now?
 *
 * True only when the person actually put time against it today AND has not yet
 * filed. "Worked on it but already reported" and "never touched it today" are
 * both **not** pending, and the tab must not nag in either case.
 */
export function isReportPending(input: {
  reports: readonly DailyReport[];
  worked: readonly WorkedTask[];
  taskId: string;
  employeeId: string;
  date: string;
}): boolean {
  const didWork = input.worked.some((w) => w.taskId === input.taskId);
  if (!didWork) return false;
  return !hasReportFor(input.reports, input.employeeId, input.date);
}
