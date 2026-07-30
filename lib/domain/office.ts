import type { EmployeeId } from "./identity";

/**
 * When an organisation works.
 *
 * **One configuration per organisation, versioned, never overwritten.** Every
 * deadline, budget and remaining-time figure in the product is computed from
 * this, so a silent edit would retroactively change what a past calculation
 * meant with no way to explain the difference. Each change appends a version
 * carrying who made it, when, and what it replaced.
 *
 * Times are **minutes from local midnight**, not strings. `09:00` is `540`.
 * Arithmetic on minutes is exact; arithmetic on `"09:00"` is parsing plus a
 * timezone assumption at every call site. The timezone is named separately and
 * applied once, by `OfficeCalendar`.
 */

/** A span of the working day, in minutes from local midnight. */
export interface TimeWindow {
  startMinuteOfDay: number;
  endMinuteOfDay: number;
}

/**
 * A day that overrides the weekly pattern.
 *
 * One shape covers both directions, which is what keeps public holidays and
 * special working Saturdays from needing two mechanisms:
 *
 *  · `working: false` — a closure. The weekly pattern said open; this says not.
 *  · `working: true` with `hours` — an exceptional opening, optionally on
 *    different hours from the usual day.
 *
 * Empty today. The shape exists so adding holidays later is data entry rather
 * than a schema change.
 */
export interface OfficeDayOverride {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  working: boolean;
  label: string;
  /** Null means "the usual hours for that weekday". */
  hours: TimeWindow | null;
}

export interface OfficeHours {
  /** Minutes from local midnight. 540 = 09:00. */
  startMinuteOfDay: number;
  /** Minutes from local midnight. 1080 = 18:00. */
  endMinuteOfDay: number;
  /**
   * Which weekdays are worked. `0` = Sunday … `6` = Saturday.
   *
   * Numbers rather than names so the comparison against a date's weekday is
   * direct, and so a locale cannot change what "Monday" means.
   */
  workingDays: number[];
  /** IANA zone, e.g. `Asia/Kolkata`. Every calculation resolves through it. */
  timezone: string;
  /**
   * Non-working spans inside the working day — lunch, a shift changeover.
   *
   * A list, because one break is a special case of several and modelling the
   * common case as a single field forces a migration the first time somebody
   * has two.
   */
  breaks: TimeWindow[];
  /** Public holidays and special openings. Empty until somebody adds one. */
  dayOverrides: OfficeDayOverride[];
  /**
   * When work outside the normal day is expected rather than exceptional.
   *
   * Null today and read by nothing. Recorded now because after-duty work
   * already has meaning in this product — it consumes budget — and a future
   * rule that treats a sanctioned evening shift differently needs somewhere to
   * say so without reshaping the record.
   */
  overtimeWindow: TimeWindow | null;
}

/**
 * One published configuration.
 *
 * Append-only. `previous` is stored rather than derived so a version explains
 * itself without the reader having to fetch its predecessor — the same reason
 * the score ledger keeps its own before/after.
 */
export interface OfficeHoursVersion {
  id: string;
  organisationId: string;
  /** 1-based, contiguous per organisation. The latest is the live one. */
  version: number;
  config: OfficeHours;
  /** Null on the first version — there was nothing before it. */
  previous: OfficeHours | null;
  changedById: EmployeeId;
  changedByName: string;
  changedAt: string;
  /**
   * Why the change was made, when somebody said.
   *
   * Optional: a correction on the first day needs no essay. An audit trail that
   * demands one gets "asdf".
   */
  note: string | null;
}

/**
 * What an organisation gets before anybody configures anything.
 *
 * Matches the seed's `Asia/Kolkata` timezone and legacy's IST assumption, so a
 * migrated organisation behaves as the product already did rather than
 * acquiring a new working week on upgrade.
 */
export const DEFAULT_OFFICE_HOURS: OfficeHours = {
  startMinuteOfDay: 9 * 60,
  endMinuteOfDay: 18 * 60,
  /* Monday–Friday. */
  workingDays: [1, 2, 3, 4, 5],
  timezone: "Asia/Kolkata",
  breaks: [],
  dayOverrides: [],
  overtimeWindow: null,
};
