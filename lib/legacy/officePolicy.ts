/**
 * `cowork_settings/office` — the rules Cowork owns about how work is timed.
 *
 * **One document, and every field in it is already load-bearing.** This is not
 * a new settings store: legacy has written this document from
 * `app/coworking/task-settings/page.js` for as long as it has existed, and code
 * in this repository already reads all four fields:
 *
 * | Field | Read by |
 * |---|---|
 * | `schedule` | `officeDueDate` deadline arithmetic; duty-status lateness |
 * | `maxTaskActionGapMinutes` | `calcDueDate`'s anchor |
 * | `breaks` | working-time subtraction in every deadline |
 * | `maxBreakMinutesPerDay` | the break allowance credited back to deadlines |
 *
 * **No REST route.** Legacy writes it straight from the browser, which puts it
 * in the same documented exception class as the timer and the duty document —
 * reads are Firestore, writes are HTTP, *except* where the engine has no
 * endpoint at all.
 *
 * **Why not the domain's `OfficeHours`.** That type models one start time, one
 * end time and a list of working weekdays. Legacy's schedule is per-day, so a
 * company that closes early on Saturday is representable in the engine and not
 * in the domain type. Mapping through it would silently discard that, and the
 * discarded hours are ones deadlines are computed from. So this speaks the
 * document's own shape.
 */

export const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type DayKey = (typeof DAY_KEYS)[number];

export interface DaySchedule {
  isOff: boolean;
  /** `HH:MM`, IST. The schedule is authored for an IST office. */
  inTime: string;
  outTime: string;
}

export interface RecurringBreak {
  name: string;
  /** `HH:MM`. Subtracted from every working day. */
  start: string;
  end: string;
}

export interface OfficePolicy {
  schedule: Record<DayKey, DaySchedule>;
  /**
   * How long a task may sit untouched before its deadline anchors to the gap
   * rather than to now.
   *
   * `calcDueDate` uses it: a task created hours ago and only now started is
   * anchored at `createdAt + gap`, not at `createdAt`, so a forgotten task does
   * not arrive already overdue.
   */
  maxTaskActionGapMinutes: number;
  breaks: RecurringBreak[];
  /** Per person, per day. Legacy defaults to 60 when unset. */
  maxBreakMinutesPerDay: number;
  /**
   * Whether going Online requires sharing an entire screen — OWNER SWITCH.
   *
   * **True is the product's own position and the default**: Online means a
   * manager can see what you are working on, and a status nobody can verify is
   * a status people learn to leave switched on. Every article, refusal and
   * control in the presence area says so.
   *
   * False makes presence an ordinary declaration — press Online, you are
   * online, nothing is captured and nothing is watched. That is not a weaker
   * version of the same feature; it is a different promise, and the reason it
   * exists is that not every team monitoring is appropriate for. A workspace
   * that turns it off has decided that, and the pill, the menu and the manager's
   * panel all have to stop implying otherwise.
   *
   * Absent means true — a workspace that has never opened the settings page
   * gets the monitored behaviour it has always had.
   */
  requireScreenShare: boolean;
  updatedBy: string | null;
}

/** Legacy's own fallback, from `getMaxBreakSecs`. */
export const DEFAULT_MAX_BREAK_MINUTES = 60;
/** Legacy's own fallback, from `calcDueDate`. */
export const DEFAULT_ACTION_GAP_MINUTES = 120;

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function minutesOf(time: string): number | null {
  const m = TIME.exec(time.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * A stored document as a policy, with legacy's defaults for anything absent.
 *
 * Absent is not an error here: a workspace that has never opened the settings
 * page has no document, and legacy treats that as "the defaults apply" rather
 * than as broken. Reading it as an error would put an error state on a
 * perfectly ordinary new workspace.
 */
export function readOfficePolicy(
  doc: Record<string, unknown> | null,
): OfficePolicy {
  const rawSchedule =
    doc?.schedule && typeof doc.schedule === "object"
      ? (doc.schedule as Record<string, unknown>)
      : {};

  const schedule = {} as Record<DayKey, DaySchedule>;
  for (const day of DAY_KEYS) {
    const raw = rawSchedule[day];
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    schedule[day] = {
      /* Weekends default to off and weekdays to on — legacy's own shape for a
         document that has never been saved. */
      isOff:
        typeof r.isOff === "boolean"
          ? r.isOff
          : day === "sunday" || day === "saturday",
      inTime: typeof r.inTime === "string" && TIME.test(r.inTime) ? r.inTime : "09:30",
      outTime:
        typeof r.outTime === "string" && TIME.test(r.outTime) ? r.outTime : "18:30",
    };
  }

  const breaks = Array.isArray(doc?.breaks) ? doc.breaks : [];

  return {
    schedule,
    maxTaskActionGapMinutes:
      positiveNumber(doc?.maxTaskActionGapMinutes) ?? DEFAULT_ACTION_GAP_MINUTES,
    breaks: breaks
      .map((b) => {
        const r = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
        const start = typeof r.start === "string" ? r.start : "";
        const end = typeof r.end === "string" ? r.end : "";
        if (!TIME.test(start) || !TIME.test(end)) return null;
        return {
          name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : "Break",
          start,
          end,
        };
      })
      .filter((b): b is RecurringBreak => b !== null),
    maxBreakMinutesPerDay:
      positiveNumber(doc?.maxBreakMinutesPerDay) ?? DEFAULT_MAX_BREAK_MINUTES,
    /* Absent means TRUE. A workspace with no document has not decided to switch
       monitoring off — it has never opened the page — and defaulting the other
       way would quietly drop the requirement for everybody on the first read. */
    requireScreenShare: doc?.requireScreenShare !== false,
    updatedBy: typeof doc?.updatedBy === "string" ? doc.updatedBy : null,
  };
}

function positiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Why this policy cannot be saved, or null.
 *
 * Legacy validates one thing before writing — a break's end must be after its
 * start — and throws with the break's name. The rest is added because these
 * values feed deadline arithmetic directly: an out-time before an in-time
 * produces a working day of negative length, and `addWorkingSecs` walking a
 * negative day is how a deadline lands in the past.
 */
export function validateOfficePolicy(policy: OfficePolicy): string | null {
  for (const day of DAY_KEYS) {
    const cfg = policy.schedule[day];
    if (cfg.isOff) continue;
    const start = minutesOf(cfg.inTime);
    const end = minutesOf(cfg.outTime);
    if (start === null || end === null) {
      return `${label(day)} has a time that is not HH:MM.`;
    }
    if (end <= start) {
      return `${label(day)} closes at or before it opens. A working day has to have length, or every deadline computed from it lands in the past.`;
    }
  }

  for (const b of policy.breaks) {
    const start = minutesOf(b.start);
    const end = minutesOf(b.end);
    if (start === null || end === null) {
      return `"${b.name}" break has a time that is not HH:MM.`;
    }
    /* Legacy's own check and its own wording. */
    if (end <= start) {
      return `"${b.name}" break: end time must be after start time.`;
    }
  }

  if (!(policy.maxBreakMinutesPerDay > 0)) {
    return "The daily break allowance must be more than zero minutes.";
  }
  if (!(policy.maxTaskActionGapMinutes > 0)) {
    return "The task action gap must be more than zero minutes.";
  }
  return null;
}

/** The document to merge. Field names are legacy's and are not up for tidying. */
export function writeOfficePolicy(
  policy: OfficePolicy,
  updatedBy: string,
): Record<string, unknown> {
  return {
    schedule: policy.schedule,
    maxTaskActionGapMinutes: policy.maxTaskActionGapMinutes,
    breaks: policy.breaks,
    maxBreakMinutesPerDay: policy.maxBreakMinutesPerDay,
    requireScreenShare: policy.requireScreenShare,
    updatedBy,
    /* A real Date rather than `serverTimestamp()`: this is written from the
       browser like legacy's own page, and the field is only ever displayed. */
    updatedAt: new Date(),
  };
}

export function label(day: DayKey): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

/** Working days, for the summary line. */
export function workingDayCount(policy: OfficePolicy): number {
  return DAY_KEYS.filter((d) => !policy.schedule[d].isOff).length;
}
