/**
 * Working windows, as durations rather than dates.
 *
 * ## Why an assignee is never asked for a date
 *
 * The question "when will this be done?" asks somebody to do arithmetic they
 * cannot do: it depends on the office schedule, on public holidays, on the
 * approved leave of whoever is asked, and on how much of the working day is
 * already committed. Legacy knows all of that — `approve-sender-timer` runs an
 * office-hours calculation before it settles a date — and the assignee does
 * not.
 *
 * What the assignee genuinely knows is **how long the work takes**. So that is
 * the only thing asked for, and the date is derived.
 *
 * ## The date still goes to the engine, and why
 *
 * `POST /task/:id/propose-deadline` returns 400 without `proposedDate`
 * (`taskForward.js:1658`), and the engine does **not** derive one from
 * `windowSecs`. So the client sends both: the duration, which is the real
 * subject of the negotiation, and a date derived from it.
 *
 * `deriveDueAt` is deliberately naive — elapsed time from now, no weekend or
 * holiday skipping. It is **a display and payload value, not the authority**.
 * The engine recalculates against the office schedule when the window is
 * approved, and its answer wins. Reimplementing the working calendar here would
 * produce a second, subtly different date and put it on screen next to the real
 * one.
 */

export interface WindowOption {
  id: string;
  label: string;
  secs: number;
}

/**
 * The offered durations.
 *
 * A working day is eight hours and a week is five of them, matching how the
 * figures are discussed rather than elapsed time — "three days" means three
 * days of work, not seventy-two hours.
 */
export const WORKING_DAY_SECS = 8 * 3600;

export const WINDOW_OPTIONS: readonly WindowOption[] = [
  { id: "4h", label: "4 hours", secs: 4 * 3600 },
  { id: "1d", label: "1 working day", secs: WORKING_DAY_SECS },
  { id: "3d", label: "3 working days", secs: 3 * WORKING_DAY_SECS },
  { id: "1w", label: "1 week", secs: 5 * WORKING_DAY_SECS },
];

/** Whether a duration matches one of the presets. */
export function optionForSecs(secs: number): WindowOption | null {
  return WINDOW_OPTIONS.find((o) => o.secs === secs) ?? null;
}

/**
 * A window in the words people use for it.
 *
 * Prefers the preset's own label so that a two-day window offered by a manager
 * and a two-day window chosen from the list read identically — the assignee
 * should not have to work out that "16 hours" is the thing their manager called
 * two days.
 */
export function describeWindow(secs: number | null | undefined): string {
  if (!secs || secs <= 0) return "No window set";
  const preset = optionForSecs(secs);
  if (preset) return preset.label;

  const days = secs / WORKING_DAY_SECS;
  if (Number.isInteger(days)) {
    return `${days} working day${days === 1 ? "" : "s"}`;
  }
  const hours = secs / 3600;
  /* One decimal at most: "2.5 hours" is useful, "2.4999 hours" is noise. */
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded} hour${rounded === 1 ? "" : "s"}`;
}

/**
 * The date a window implies, from a given moment.
 *
 * Naive by design — see the header. `fromMs` is passed rather than read from
 * the clock so this stays pure and testable.
 */
export function deriveDueAt(windowSecs: number, fromMs: number): string {
  return new Date(fromMs + windowSecs * 1000).toISOString();
}
