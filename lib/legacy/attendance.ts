import type { LegacyResult } from "./envelope";
import { legacyFetch } from "./http.ts";
import { type LegacyDutyStatus, unappliedGapMs } from "./wire.ts";

/**
 * Attendance, duty status and leave, from the legacy engine.
 *
 * **Two databases and two authentication systems meet here**, which is why this
 * module's functions take different tokens:
 *
 * | Concern | Store | Route | Token |
 * |---|---|---|---|
 * | Duty status, break, emergency | Firestore `cowork_duty_status` | none — **browser writes** | Firebase |
 * | Blocked dates for deadlines | Mongo, via `/cowork/...` | `/cowork/deadline-availability/blocked-dates` | **Firebase** |
 * | Attendance records | Mongo `Attendance` | `/api/employee/attendance/*` | **HR JWT** |
 * | Leave | Mongo `LeaveApplication` | `/api/hr/leaves`, `/api/employee/leave-applications` | **HR JWT** |
 *
 * No attendance figure is computed here. `services/Attendanceengine.js` derives
 * days from punches and `BiometricSyncService.js` supplies them from the
 * eTimeOffice devices; both stay where they are.
 */

/* ── Duty status ──────────────────────────────────────────────────────────── */

/**
 * Presence, break and emergency, mapped for the UI.
 *
 * **Legacy already implements the availability-delta model.** `latenessMs` is
 * late login; `breakGapStoredMs` / `breakGapAppliedMs` separate what was
 * measured from what has already been given back to deadlines;
 * `lastDeadlineShiftMs` is the idempotency watermark that stops one absence
 * being paid for twice.
 *
 * That is the same model as `lib/rules/availability/ledger.ts`, arrived at
 * independently and with different names. Per the extension rule: the new work
 * **extends these fields** rather than introducing a parallel accumulator. Two
 * counters for one quantity is precisely how an hour gets credited twice.
 */
export interface LegacyDuty {
  status: string | null;
  startedAtMs: number | null;
  /** Milliseconds late against the scheduled open, as the engine measured it. */
  latenessMs: number;
  workedTodaySecs: number;
  break: {
    isOnBreak: boolean;
    startedAtMs: number | null;
    usedTodaySecs: number;
    allowanceSecs: number | null;
    remainingSecs: number | null;
  };
  emergency: {
    isActive: boolean;
    startedAtMs: number | null;
  };
  /**
   * Measured but not yet applied to deadlines, in milliseconds.
   *
   * What a UI needs to say "your deadlines will move by X" before the engine
   * applies it. Derived from the engine's own fields, so it cannot disagree with
   * what the engine is about to do.
   */
  unappliedGapMs: number;
  /** The engine's idempotency watermark — the last shift already paid out. */
  lastShiftAtMs: number | null;
}

export function readDuty(doc: LegacyDutyStatus): LegacyDuty {
  const allowanceSecs =
    typeof doc.maxBreakSecs === "number" ? doc.maxBreakSecs : null;
  const usedTodaySecs = Number(doc.dailyBreakSeconds) || 0;

  return {
    status: doc.status ?? null,
    startedAtMs: numberOrNull(doc.startedAt),
    latenessMs: Math.max(0, Number(doc.latenessMs) || 0),
    workedTodaySecs: Number(doc.workedTodaySeconds) || 0,
    break: {
      /* A break is running when the engine has stamped its start and not
         cleared it — there is no explicit flag. */
      isOnBreak: typeof doc.breakStartedAtMs === "number" && doc.breakStartedAtMs > 0,
      startedAtMs: doc.breakStartedAtMs ?? null,
      usedTodaySecs,
      allowanceSecs,
      remainingSecs:
        allowanceSecs === null ? null : Math.max(0, allowanceSecs - usedTodaySecs),
    },
    emergency: {
      isActive:
        typeof doc.emergencyStartedAtMs === "number" && doc.emergencyStartedAtMs > 0,
      startedAtMs: doc.emergencyStartedAtMs ?? null,
    },
    unappliedGapMs: unappliedGapMs(doc),
    lastShiftAtMs: doc.lastDeadlineShiftMs ?? null,
  };
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** The Firestore path for somebody's duty status. */
export function dutyStatusPath(employeeId: string): string[] {
  return ["cowork_duty_status", employeeId];
}

/* ── Blocked dates — the Cowork↔HR bridge ─────────────────────────────────── */

/**
 * `GET /cowork/scheduling/blocked-dates`.
 *
 * **The only path from HR data into Cowork's deadline maths.** Returns company
 * holidays (everyone) plus that employee's HR-approved leave — both statuses
 * legacy accepts, `hr_approved` and `withdraw_pending`.
 *
 * Uses the **Firebase token**, not the HR one: the route is mounted under
 * `/cowork` even though it reads Mongo.
 *
 * ---
 *
 * **This pointed at a route that does not exist, and it was a 404 every time.**
 * `routes/task_routes/deadlineAvailability.routes.js` does define
 * `/deadline-availability/blocked-dates` — but that file is never `require`d or
 * mounted anywhere in the backend, so it is dead code in the same way
 * `taskTree.routes.js`'s `/task/create` is. Probed against the running engine:
 * the old path answers **404**, this one answers **401**.
 *
 * The consequence was silent and in the wrong direction: a failed read meant no
 * blocked dates, so the deadline picker offered dates on public holidays and on
 * somebody's approved leave, and the engine accepted them.
 *
 * The two routes also differ in their PARAMETERS and their RESPONSE SHAPE, so
 * fixing the path alone would still have returned nothing — see below.
 */
export interface LegacyBlockedDate {
  date: string;
  kind: "holiday" | "leave";
  label: string | null;
}

/**
 * `{ success, blockedDates }`, where `blockedDates` is an **object keyed by
 * date** — `{ "2026-08-15": { type: "holiday", name: "Independence Day" } }`.
 *
 * Not an array. The previous reader iterated it as one (`for (const raw of
 * response.blockedDates ?? [])`), which yields nothing for an object and would
 * have reported everybody available on every holiday even from the right route.
 *
 * The array-shaped keys are kept because a different engine build did send them
 * that way, and reading only one shape is how a person gets scheduled onto
 * their own leave.
 */
interface BlockedDatesResponse {
  success?: boolean;
  blockedDates?: unknown;
  holidays?: unknown[];
  leaves?: unknown[];
}

export function readBlockedDates(
  response: BlockedDatesResponse,
): LegacyBlockedDate[] {
  const out: LegacyBlockedDate[] = [];
  const seen = new Set<string>();

  const push = (raw: unknown, fallbackKind: "holiday" | "leave") => {
    const date =
      typeof raw === "string"
        ? raw
        : ((raw as Record<string, unknown>)?.date as string | undefined);
    if (!date || seen.has(date)) return;
    seen.add(date);
    const record = (typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const kind = record.kind === "leave" || record.kind === "holiday"
      ? (record.kind as "holiday" | "leave")
      : fallbackKind;
    out.push({
      date,
      kind,
      label:
        typeof record.label === "string" ? record.label
        : typeof record.leaveType === "string" ? record.leaveType
        : typeof record.name === "string" ? record.name
        : null,
    });
  };

  /* The live route's shape: an object keyed by date, whose values name the
     kind. `cowork.js:60` builds it as `blocked[date] = { type, name|leaveType }`. */
  const map = response.blockedDates;
  if (map && typeof map === "object" && !Array.isArray(map)) {
    for (const [date, value] of Object.entries(map as Record<string, unknown>)) {
      const v = (typeof value === "object" && value ? value : {}) as Record<
        string,
        unknown
      >;
      push(
        {
          date,
          kind: v.type === "leave" ? "leave" : "holiday",
          label: v.name ?? v.leaveType ?? null,
        },
        v.type === "leave" ? "leave" : "holiday",
      );
    }
  } else if (Array.isArray(map)) {
    /* A different engine build sends an array. Reading only one shape is how a
       person gets scheduled onto their own approved leave. */
    for (const raw of map) push(raw, "holiday");
  }
  for (const raw of response.holidays ?? []) push(raw, "holiday");
  for (const raw of response.leaves ?? []) push(raw, "leave");

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The engine's own cap. Asking for more is silently truncated. */
export const MAX_BLOCKED_DATE_WINDOW_DAYS = 90;

/**
 * Company holidays and one person's approved leave, between two dates.
 *
 * `from` and `to` — the live route requires both and 400s without them
 * (`cowork.js:62`). The dead route this used to call took `fromDate` and a day
 * COUNT instead, which is why the parameters changed shape along with the path.
 */
export async function fetchBlockedDates(input: {
  token: string;
  employeeId: string;
  from: string;
  to: string;
}): Promise<LegacyResult<LegacyBlockedDate[]>> {
  const r = await legacyFetch<BlockedDatesResponse>({
    path: "/cowork/scheduling/blocked-dates",
    query: { employeeId: input.employeeId, from: input.from, to: input.to },
    token: input.token,
  });
  return r.ok ? { ok: true, data: readBlockedDates(r.data) } : r;
}

/* ── Attendance records — HR token ────────────────────────────────────────── */

export interface LegacyAttendanceDay {
  date: string | null;
  status: string | null;
  inTime: string | null;
  outTime: string | null;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  isExpectedWorkingDay: boolean;
}

export function readAttendanceDay(raw: unknown): LegacyAttendanceDay | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const date = text(r.date) ?? text(r.attendanceDate);
  if (!date) return null;

  return {
    date,
    status: text(r.status),
    inTime: text(r.inTime) ?? text(r.actualStart) ?? text(r.punchIn),
    outTime: text(r.outTime) ?? text(r.actualEnd) ?? text(r.punchOut),
    lateMinutes: Number(r.lateMinutes) || 0,
    earlyDepartureMinutes: Number(r.earlyDepartureMinutes) || 0,
    /* Legacy derives the denominator from the work calendar, not from whether
       events exist — a missed biometric sync must not silently shrink the
       expected days and inflate the C4 score. */
    isExpectedWorkingDay: r.isExpectedWorkingDay !== false,
  };
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function readAttendanceDays(
  raw: readonly unknown[],
): LegacyAttendanceDay[] {
  return raw
    .map(readAttendanceDay)
    .filter((d): d is LegacyAttendanceDay => d !== null);
}

/** `GET /api/employee/attendance/today` — **HR token**. */
export async function fetchToday(
  hrToken: string,
): Promise<LegacyResult<LegacyAttendanceDay | null>> {
  const r = await legacyFetch<unknown>({
    path: "/api/employee/attendance/today",
    envelopeKey: "attendance",
    token: hrToken,
  });
  return r.ok ? { ok: true, data: readAttendanceDay(r.data) } : r;
}

/** `GET /api/employee/attendance/monthly` — **HR token**. */
export async function fetchMonthly(input: {
  hrToken: string;
  month?: number;
  year?: number;
}): Promise<LegacyResult<LegacyAttendanceDay[]>> {
  const r = await legacyFetch<unknown[]>({
    path: "/api/employee/attendance/monthly",
    query: { month: input.month, year: input.year },
    envelopeKey: "attendance",
    token: input.hrToken,
  });
  return r.ok ? { ok: true, data: readAttendanceDays(r.data ?? []) } : r;
}

/** `GET /hr/attendance/employee/:empId` — **HR token**, HR staff only. */
export async function fetchEmployeeAttendance(input: {
  hrToken: string;
  employeeId: string;
  from?: string;
  to?: string;
}): Promise<LegacyResult<LegacyAttendanceDay[]>> {
  const r = await legacyFetch<unknown[]>({
    path: `/hr/attendance/employee/${encodeURIComponent(input.employeeId)}`,
    query: { from: input.from, to: input.to },
    envelopeKey: "attendance",
    token: input.hrToken,
  });
  return r.ok ? { ok: true, data: readAttendanceDays(r.data ?? []) } : r;
}

/* ── The after-duty conflict ──────────────────────────────────────────────── */

/**
 * **Legacy and the new product disagree about after-duty work, and this is the
 * extension point rather than a silent resolution.**
 *
 * Legacy `timerSop.service.js` treats time worked after the office closes — and
 * all time on week-offs — as an **accumulating reward**: crossing
 * `timerOvertimeThresholdHrs` writes a ledger entry named `"Overtime Reward"`
 * with `type: "C4"` and `bleachType: "debit"`, which *lowers* the penalty total
 * and *raises* the score.
 *
 * The new product's approved rule is the opposite: after-duty work **consumes
 * task budget**, so working late costs rather than earns.
 *
 * Both cannot hold. The adapter therefore does neither — it does not suppress
 * legacy's reward and it does not apply the new charge. It reports the conflict
 * so a screen can show both figures and a person can decide, and so the
 * decision is visible rather than buried in whichever code path ran last.
 *
 * Resolving it is an owner decision. Until then, **legacy's calculation is the
 * one that reaches anybody's score**, because legacy remains the engine.
 */
export interface AfterDutyConflict {
  legacyBehaviour: string;
  newRule: string;
  resolved: false;
}

export const AFTER_DUTY_CONFLICT: AfterDutyConflict = {
  legacyBehaviour:
    'Time after office close, and all time on week-offs, accumulates toward "Overtime Reward" — a C4 credit that raises the score.',
  newRule:
    "After-duty work consumes the task's budget, so working late reduces remaining time rather than earning credit.",
  resolved: false,
};

/**
 * After-duty seconds present in a duty record, for reporting only.
 *
 * Deliberately does **not** decide what they mean. It surfaces the quantity both
 * rules would act on, so a comparison screen can show what legacy credited
 * against what the new rule would have charged — without either being applied.
 */
export function afterDutySecondsReported(duty: LegacyDuty): number {
  return Math.max(0, duty.workedTodaySecs);
}
