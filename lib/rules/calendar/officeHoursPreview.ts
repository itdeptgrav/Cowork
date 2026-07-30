import type { OfficeHours, Task } from "@/lib/domain";

/**
 * What a person is about to change, in the terms they set it in.
 *
 * Separate from `describeChange` — that produces one-line audit entries for the
 * history list; this produces before/after PAIRS for the confirmation dialog.
 * Both read the same two configurations, so the dialog and the audit trail can
 * never describe the same edit differently.
 *
 * Only fields that actually changed are returned. A confirmation listing seven
 * unchanged rows buries the one that matters.
 */

export interface PreviewRow {
  label: string;
  before: string;
  after: string;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatMinute(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** `Mon–Fri` when contiguous, `Mon, Wed, Fri` when not. Empty reads as "None". */
export function formatDays(days: readonly number[]): string {
  if (days.length === 0) return "None";
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every(
    (d, i) => i === 0 || d === sorted[i - 1] + 1,
  );
  if (contiguous && sorted.length > 2)
    return `${DAY_NAMES[sorted[0]]}–${DAY_NAMES[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => DAY_NAMES[d]).join(", ");
}

function formatWindows(ws: readonly { startMinuteOfDay: number; endMinuteOfDay: number }[]): string {
  if (ws.length === 0) return "None";
  return ws
    .map((w) => `${formatMinute(w.startMinuteOfDay)}–${formatMinute(w.endMinuteOfDay)}`)
    .join(", ");
}

export function previewRows(
  before: OfficeHours,
  after: OfficeHours,
): PreviewRow[] {
  const rows: PreviewRow[] = [];
  const push = (label: string, b: string, a: string) => {
    if (b !== a) rows.push({ label, before: b, after: a });
  };

  push(
    "Office hours",
    `${formatMinute(before.startMinuteOfDay)}–${formatMinute(before.endMinuteOfDay)}`,
    `${formatMinute(after.startMinuteOfDay)}–${formatMinute(after.endMinuteOfDay)}`,
  );
  push("Timezone", before.timezone, after.timezone);
  push("Working days", formatDays(before.workingDays), formatDays(after.workingDays));
  push("Breaks", formatWindows(before.breaks), formatWindows(after.breaks));
  push(
    "Holidays",
    `${before.dayOverrides.length}`,
    `${after.dayOverrides.length}`,
  );
  push(
    "Overtime window",
    before.overtimeWindow ? formatWindows([before.overtimeWindow]) : "None",
    after.overtimeWindow ? formatWindows([after.overtimeWindow]) : "None",
  );
  return rows;
}

export function hasChanges(before: OfficeHours, after: OfficeHours): boolean {
  return previewRows(before, after).length > 0;
}

/**
 * Tasks whose operational scheduling this change would touch.
 *
 * Anything still live and dated. Completed, cancelled and undated work is
 * unaffected because nothing is left to reschedule — counting it would inflate
 * a warning people need to trust.
 *
 * The count is for the WARNING only. Nothing is recalculated in this
 * checkpoint, and `officialDueAt` never moves regardless.
 */
export function activeTaskCount(tasks: readonly Task[]): number {
  const TERMINAL = ["completed", "cancelled", "assignment_rejected"];
  return tasks.filter(
    (t) => !t.deletedAt && !TERMINAL.includes(t.status) && t.deadline.dueAt !== null,
  ).length;
}
