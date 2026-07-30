import type { LegacyResult } from "./envelope";
import { legacyFetch } from "./http.ts";

/**
 * Configuration, from the legacy engine.
 *
 * Legacy keeps its settings in **three places**, and this module reads all three
 * without consolidating them. Consolidation would mean choosing a winner where
 * two disagree, and that is a data decision the engine has to make, not the
 * adapter:
 *
 * | Setting | Where | Written by |
 * |---|---|---|
 * | Office hours, week-offs, break allowance | Firestore `cowork_settings/office` | Browser |
 * | Timer SOP thresholds | Firestore `cowork_sop_settings/task_events` | API |
 * | Departments, designations, policies | Mongo, via `/api/hr/*` | API (**HR token**) |
 * | Score bands | Mongo `BandConfig` | API — see `sop.ts` |
 */

/* ── Office hours ─────────────────────────────────────────────────────────── */

/**
 * `cowork_settings/office`.
 *
 * Times are stored as **strings** (`"09:00"`), not minutes, and the timezone is
 * not stored at all — legacy hard-codes IST (`5.5 * 60 * 60 * 1000`) in four
 * places. Both are preserved on read; see the note on `OfficeHours` below.
 */
export interface LegacyOfficeDoc {
  inTime?: string;
  outTime?: string;
  maxBreakMinutesPerDay?: number;
  dailyMinHrs?: number;
  dailyMinPct?: number;
  /** Per-weekday overrides, keyed by lowercase day name. */
  sunday?: LegacyDayConfig;
  monday?: LegacyDayConfig;
  tuesday?: LegacyDayConfig;
  wednesday?: LegacyDayConfig;
  thursday?: LegacyDayConfig;
  friday?: LegacyDayConfig;
  saturday?: LegacyDayConfig;
  [key: string]: unknown;
}

export interface LegacyDayConfig {
  isOff?: boolean;
  inTime?: string;
  outTime?: string;
}

/** Legacy's own key order — index 0 is Sunday, matching `DAY_KEYS`. */
export const DAY_KEYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

export interface LegacyOfficeDay {
  /** 0 = Sunday, matching legacy's `DAY_KEYS` index and `Date.getDay()`. */
  weekday: number;
  name: string;
  isOff: boolean;
  /** `"HH:MM"`, or null to inherit the office default. */
  inTime: string | null;
  outTime: string | null;
}

export interface LegacyOfficeSettings {
  /** `"HH:MM"`. Null when never configured — not a default of 09:00. */
  inTime: string | null;
  outTime: string | null;
  /** Daily break allowance in seconds, or null when unset. */
  breakAllowanceSecs: number | null;
  /** Minimum working hours a day, used by the deficit rule. */
  dailyMinHrs: number | null;
  dailyMinPct: number | null;
  days: LegacyOfficeDay[];
  /**
   * The timezone legacy assumes but never stores.
   *
   * Recorded here so a reader is not left to guess. `timerSop.service.js` and
   * three other files hard-code `IST_OFFSET_MS = 5.5 * 60 * 60 * 1000`, so every
   * legacy figure is IST regardless of where the office is. **A fixed offset,
   * not a zone** — it cannot follow daylight saving, which is fine for IST and
   * wrong for anywhere that observes it.
   */
  assumedTimezone: "Asia/Kolkata";
}

export function readOfficeSettings(
  doc: LegacyOfficeDoc,
): LegacyOfficeSettings {
  const minutes = Number(doc.maxBreakMinutesPerDay);

  return {
    inTime: timeOrNull(doc.inTime),
    outTime: timeOrNull(doc.outTime),
    breakAllowanceSecs: Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : null,
    dailyMinHrs: numberOrNull(doc.dailyMinHrs),
    dailyMinPct: numberOrNull(doc.dailyMinPct),
    days: DAY_KEYS.map((name, weekday) => {
      const day = (doc[name] ?? {}) as LegacyDayConfig;
      return {
        weekday,
        name,
        isOff: day.isOff === true,
        inTime: timeOrNull(day.inTime),
        outTime: timeOrNull(day.outTime),
      };
    }),
    assumedTimezone: "Asia/Kolkata",
  };
}

/**
 * A `"HH:MM"` string, or null.
 *
 * Rejects anything that is not a plausible time rather than passing it through
 * — a malformed value reaching the deadline maths as `NaN` is far harder to
 * trace than a null that renders as "not set".
 */
export function timeOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{1,2}:\d{2}$/.test(trimmed) ? trimmed : null;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * `"HH:MM"` as minutes from local midnight.
 *
 * A conversion, not a rule — provided because the new project's `OfficeHours`
 * model stores minutes and legacy stores strings, and every screen that shows
 * both needs the same translation. It does not decide anything about the
 * working day.
 */
export function minutesOfDay(time: string | null): number | null {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** Which weekdays are worked, as `0`–`6`. */
export function workingWeekdays(
  settings: LegacyOfficeSettings,
): number[] {
  return settings.days.filter((d) => !d.isOff).map((d) => d.weekday);
}

/** The Firestore path for the office settings document. */
export function officeSettingsPath(): string[] {
  return ["cowork_settings", "office"];
}

/* ── Timer SOP thresholds ─────────────────────────────────────────────────── */

/**
 * `cowork_sop_settings/task_events`.
 *
 * Drives `timerSop.service.js`. When none of the four is configured, the engine
 * returns `{ ok: false, reason: "not_configured" }` and **the whole rule is
 * inert** — so a UI must distinguish "configured as zero" from "never set up",
 * or it will show a threshold that is not being enforced.
 */
export interface LegacyTimerSopSettings {
  deficitThresholdHrs: number;
  deficitPoints: number;
  overtimeThresholdHrs: number;
  overtimePoints: number;
  /** False when the engine will skip the rule entirely. */
  isConfigured: boolean;
}

export function readTimerSopSettings(
  raw: Record<string, unknown> | null | undefined,
): LegacyTimerSopSettings {
  const doc = raw ?? {};
  const deficitThresholdHrs = parseFloat(String(doc.timerDeficitThresholdHrs)) || 0;
  const deficitPoints = parseFloat(String(doc.timerDeficitPoints)) || 0;
  const overtimeThresholdHrs = parseFloat(String(doc.timerOvertimeThresholdHrs)) || 0;
  const overtimePoints = parseFloat(String(doc.timerOvertimePoints)) || 0;
  const dailyMinHrs = parseFloat(String(doc.dailyMinHrs)) || 0;
  const dailyMinPct = parseFloat(String(doc.dailyMinPct)) || 0;

  return {
    deficitThresholdHrs,
    deficitPoints,
    overtimeThresholdHrs,
    overtimePoints,
    /* The engine's own condition, transcribed from timerSop.service.js:148. */
    isConfigured: !(
      !dailyMinHrs && !dailyMinPct && !deficitThresholdHrs && !overtimeThresholdHrs
    ),
  };
}

export function timerSopSettingsPath(): string[] {
  return ["cowork_sop_settings", "task_events"];
}

/* ── Policies — HR token ──────────────────────────────────────────────────── */

export interface LegacyPolicy {
  id: string;
  name: string;
  description: string | null;
  severity: string | null;
  isActive: boolean;
}

export function readPolicy(raw: unknown): LegacyPolicy | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r._id ?? r.id;
  const name = r.name ?? r.title;
  if (!id || typeof name !== "string" || !name.trim()) return null;

  return {
    id: String(id),
    name: name.trim(),
    description:
      typeof r.description === "string" && r.description.trim()
        ? r.description.trim()
        : null,
    severity: typeof r.severity === "string" ? r.severity : null,
    isActive: r.isActive !== false && r.status !== "inactive",
  };
}

/** `GET /api/hr/policy` — **HR token**. */
export async function listPolicies(
  hrToken: string,
): Promise<LegacyResult<LegacyPolicy[]>> {
  const r = await legacyFetch<unknown[]>({
    path: "/api/hr/policy",
    envelopeKey: "policies",
    token: hrToken,
  });
  if (!r.ok) return r;
  return {
    ok: true,
    data: (r.data ?? [])
      .map(readPolicy)
      .filter((p): p is LegacyPolicy => p !== null),
  };
}

/* ── The office-hours extension point ─────────────────────────────────────── */

/**
 * Where the new office-calendar model attaches.
 *
 * The new project's `OfficeHours` (`lib/domain/office.ts`) is richer than
 * legacy's document: it stores minutes rather than strings, a real IANA
 * timezone rather than a hard-coded offset, mid-day breaks, day overrides for
 * holidays and special openings, and a version history with an audit trail.
 *
 * **Legacy's document is not upgraded in place.** Writing those fields back
 * would put data in `cowork_settings/office` that the engine does not read and
 * cannot maintain, and the next write from the legacy client would drop them.
 *
 * So this converts legacy's settings into the new shape for **display and
 * calculation in the new UI**, while the engine keeps computing its own
 * deadlines from its own document. Where the two disagree, the engine wins,
 * because the engine is what actually moves a deadline.
 *
 * Two facts legacy simply does not carry, and which therefore come back empty:
 * mid-day breaks and day overrides. A holiday that the new UI would honour is
 * invisible to legacy's own maths — which is exactly why
 * `attendance.fetchBlockedDates` exists as the separate, real source for
 * holidays and leave.
 */
export interface NewOfficeHoursShape {
  startMinuteOfDay: number | null;
  endMinuteOfDay: number | null;
  workingDays: number[];
  timezone: string;
  /** Always empty — legacy stores no mid-day breaks. */
  breaks: never[];
  /** Always empty — holidays come from `fetchBlockedDates`, not this document. */
  dayOverrides: never[];
}

export function toNewOfficeHours(
  settings: LegacyOfficeSettings,
): NewOfficeHoursShape {
  return {
    startMinuteOfDay: minutesOfDay(settings.inTime),
    endMinuteOfDay: minutesOfDay(settings.outTime),
    workingDays: workingWeekdays(settings),
    timezone: settings.assumedTimezone,
    breaks: [],
    dayOverrides: [],
  };
}

/**
 * What the new model expresses that legacy cannot store.
 *
 * For a settings screen to explain why an option is unavailable rather than
 * silently omitting it.
 */
export const OFFICE_HOURS_GAPS: readonly string[] = [
  "Mid-day breaks: the new model supports them; cowork_settings/office has no field for them.",
  "Holidays and special openings: legacy keeps these in HR (CompanyHoliday), reached through the blocked-dates endpoint, not in office settings.",
  "Timezone: legacy hard-codes an IST offset in four places and stores no zone, so daylight saving cannot be represented.",
  "Version history: the new model versions every change with an author; legacy overwrites the document.",
];
