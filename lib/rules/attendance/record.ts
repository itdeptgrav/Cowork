/**
 * Validating a recorded attendance day.
 *
 * Recording is a manager / People-Operations action against another person; the
 * repository enforces WHO may record. This rule is the pure part: it decides
 * whether a submitted day is well-formed and normalises it into the shape the
 * scoring projection reads (docs/specs/SCORING_LOGIC_SPEC.md §5.5).
 *
 * Two invariants matter for C4 · Attendance:
 *  - lateness and early departure only apply to a day someone actually worked;
 *    an absent or leave day carries neither.
 *  - `isExpectedWorkingDay` comes from the calendar, not from whether events
 *    exist, so the denominator cannot be silently shrunk (the legacy defect,
 *    SCORING_LOGIC_SPEC.md §4.3).
 */

import type { AttendanceStatus } from "../../domain/work.ts";

export interface AttendanceRecordInput {
  employeeId: string;
  /** YYYY-MM-DD. */
  date: string;
  status: AttendanceStatus;
  lateMinutes?: number;
  earlyDepartureMinutes?: number;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  /** Overrides the calendar default when supplied. */
  isExpectedWorkingDay?: boolean;
}

export interface NormalisedAttendance {
  employeeId: string;
  date: string;
  status: AttendanceStatus;
  isExpectedWorkingDay: boolean;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
}

export type AttendanceValidation =
  | { ok: true; value: NormalisedAttendance }
  | { ok: false; field: string; message: string };

const STATUSES: AttendanceStatus[] = [
  "present",
  "absent",
  "half_day",
  "leave",
  "holiday",
  "week_off",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A worked day is one where somebody was expected to be at their desk. */
export function isWorkedStatus(status: AttendanceStatus): boolean {
  return status === "present" || status === "half_day";
}

/**
 * Whether a status counts toward the attendance denominator by default.
 * A week-off or a company holiday is not an expected working day; a present,
 * absent, half or approved-leave day is. Leave still counts as a full-credit
 * unit so approved absence never lowers a score.
 */
export function defaultExpectedWorkingDay(status: AttendanceStatus): boolean {
  return status !== "week_off" && status !== "holiday";
}

export function validateAttendanceRecord(
  input: AttendanceRecordInput,
): AttendanceValidation {
  const employeeId = input.employeeId?.trim();
  if (!employeeId)
    return { ok: false, field: "employeeId", message: "Choose whose day this is." };

  if (!DATE_RE.test(input.date ?? ""))
    return { ok: false, field: "date", message: "Enter the date as YYYY-MM-DD." };

  if (!STATUSES.includes(input.status))
    return { ok: false, field: "status", message: "Choose an attendance status." };

  const late = input.lateMinutes ?? 0;
  const early = input.earlyDepartureMinutes ?? 0;
  if (!Number.isFinite(late) || late < 0)
    return {
      ok: false,
      field: "lateMinutes",
      message: "Late minutes cannot be negative.",
    };
  if (!Number.isFinite(early) || early < 0)
    return {
      ok: false,
      field: "earlyDepartureMinutes",
      message: "Early-departure minutes cannot be negative.",
    };

  // Lateness and early departure are meaningless on a day nobody was expected
  // to work — an absent day is not "0 minutes late", it is simply absent.
  const worked = isWorkedStatus(input.status);
  const lateMinutes = worked ? Math.round(late) : 0;
  const earlyDepartureMinutes = worked ? Math.round(early) : 0;

  const isExpectedWorkingDay =
    input.isExpectedWorkingDay ?? defaultExpectedWorkingDay(input.status);

  return {
    ok: true,
    value: {
      employeeId,
      date: input.date,
      status: input.status,
      isExpectedWorkingDay,
      lateMinutes,
      earlyDepartureMinutes,
      scheduledStart: input.scheduledStart ?? null,
      scheduledEnd: input.scheduledEnd ?? null,
      actualStart: input.actualStart ?? null,
      actualEnd: input.actualEnd ?? null,
    },
  };
}
