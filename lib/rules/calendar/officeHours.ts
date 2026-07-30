import type { OfficeHours, TimeWindow } from "@/lib/domain";

/**
 * What makes an office-hours configuration usable.
 *
 * Pure and shared: the settings form refuses before a round trip, the
 * repository refuses regardless, and a future server route re-runs the same
 * function. A broken configuration reaching storage would make every deadline
 * in the organisation uncomputable, so this is strict about the cases that
 * produce a zero-length or inverted working day.
 */

const DAY_MINUTES = 24 * 60;

function windowRefusal(w: TimeWindow, label: string): string | null {
  if (!Number.isInteger(w.startMinuteOfDay) || !Number.isInteger(w.endMinuteOfDay))
    return `${label} must be whole minutes.`;
  if (w.startMinuteOfDay < 0 || w.endMinuteOfDay > DAY_MINUTES)
    return `${label} must fall inside a single day.`;
  if (w.endMinuteOfDay <= w.startMinuteOfDay)
    return `${label} must end after it starts.`;
  return null;
}

function overlaps(a: TimeWindow, b: TimeWindow): boolean {
  return (
    a.startMinuteOfDay < b.endMinuteOfDay && b.startMinuteOfDay < a.endMinuteOfDay
  );
}

/** Whether a string is a zone this runtime can actually resolve. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Why this configuration cannot be published, or null.
 *
 * Returns the FIRST problem rather than every problem: the reader is fixing one
 * field, and five complaints about a four-input form read as noise.
 */
export function officeHoursRefusal(config: OfficeHours): string | null {
  const day = windowRefusal(
    {
      startMinuteOfDay: config.startMinuteOfDay,
      endMinuteOfDay: config.endMinuteOfDay,
    },
    "The working day",
  );
  if (day) return day;

  if (!Array.isArray(config.workingDays) || config.workingDays.length === 0)
    return "Choose at least one working day, or no work can ever be scheduled.";
  if (config.workingDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
    return "Working days must be days of the week.";
  if (new Set(config.workingDays).size !== config.workingDays.length)
    return "A day cannot appear twice.";

  if (!isValidTimezone(config.timezone))
    return `“${config.timezone}” is not a timezone this system recognises.`;

  for (const b of config.breaks) {
    const bad = windowRefusal(b, "A break");
    if (bad) return bad;
    if (
      b.startMinuteOfDay < config.startMinuteOfDay ||
      b.endMinuteOfDay > config.endMinuteOfDay
    )
      return "A break must fall inside the working day.";
  }
  /* Overlapping breaks would be double-subtracted by the calendar, quietly
     shortening the working day by the overlap. */
  for (let i = 0; i < config.breaks.length; i++)
    for (let j = i + 1; j < config.breaks.length; j++)
      if (overlaps(config.breaks[i], config.breaks[j]))
        return "Two breaks overlap. Merge them into one.";

  if (workingMinutesPerDay(config) <= 0)
    return "Breaks consume the whole working day, leaving no time to work.";

  if (config.overtimeWindow) {
    const bad = windowRefusal(config.overtimeWindow, "The overtime window");
    if (bad) return bad;
  }

  for (const o of config.dayOverrides) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date))
      return `“${o.date}” is not a calendar date.`;
    if (o.hours) {
      const bad = windowRefusal(o.hours, `Hours for ${o.date}`);
      if (bad) return bad;
    }
  }

  return null;
}

/** Minutes actually workable on a normal working day. */
export function workingMinutesPerDay(config: OfficeHours): number {
  return (
    config.endMinuteOfDay -
    config.startMinuteOfDay -
    config.breaks.reduce(
      (sum, b) => sum + (b.endMinuteOfDay - b.startMinuteOfDay),
      0,
    )
  );
}

/** A readable summary of what changed, for the audit list. */
export function describeChange(
  before: OfficeHours | null,
  after: OfficeHours,
): string[] {
  if (!before) return ["Office hours set for the first time."];
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const out: string[] = [];
  if (before.startMinuteOfDay !== after.startMinuteOfDay)
    out.push(`Start ${hhmm(before.startMinuteOfDay)} → ${hhmm(after.startMinuteOfDay)}`);
  if (before.endMinuteOfDay !== after.endMinuteOfDay)
    out.push(`End ${hhmm(before.endMinuteOfDay)} → ${hhmm(after.endMinuteOfDay)}`);
  if (before.timezone !== after.timezone)
    out.push(`Timezone ${before.timezone} → ${after.timezone}`);
  if (before.workingDays.join() !== after.workingDays.join())
    out.push(`Working days ${before.workingDays.length} → ${after.workingDays.length}`);
  if (before.breaks.length !== after.breaks.length)
    out.push(`Breaks ${before.breaks.length} → ${after.breaks.length}`);
  if (before.dayOverrides.length !== after.dayOverrides.length)
    out.push(`Holidays ${before.dayOverrides.length} → ${after.dayOverrides.length}`);
  return out.length ? out : ["No effective change."];
}
