/**
 * Adjusting a task's estimated time when its requirements change.
 *
 * ## Why a person types the figure
 *
 * Adding a requirement does not tell anybody how much longer the work will
 * take, and removing one does not tell anybody how much shorter. "Check the
 * tariff tables" might be ten minutes or two days, and no rule derived from the
 * text could tell the difference. So nothing here guesses: the amount is asked
 * for, and a requirement change with no answer leaves the estimate exactly
 * where it was.
 *
 * ## Why it is a DELTA and not a new total
 *
 * The person changing a requirement knows what that one change is worth. They
 * do not necessarily know the current total, and asking them to restate it
 * invites a typo that silently rewrites a commitment — "7.5" entered where 6
 * stood adds an hour and a half nobody intended, and looks identical to a
 * deliberate correction afterwards.
 *
 * A signed adjustment can be read back later as what it was: a requirement was
 * added and ninety minutes went with it.
 */

/** Hours and minutes as typed, before either is known to be a number. */
export interface EtInput {
  hours: string | number;
  minutes: string | number;
}

export type EtDirection = "add" | "subtract";

/** The longest single adjustment allowed, so a slipped key cannot add a year. */
export const MAX_ADJUSTMENT_SECS = 30 * 24 * 3600;

/**
 * Whole seconds from a typed hours/minutes pair, or null when it is not a
 * usable figure.
 *
 * Null rather than 0 for unusable input: zero is a legitimate thing to type and
 * means "no change", which is a different answer from "that is not a number"
 * and deserves a different message.
 */
export function parseEtInput(input: EtInput): number | null {
  const h = readPart(input.hours);
  const m = readPart(input.minutes);
  if (h === null || m === null) return null;
  return h * 3600 + m * 60;
}

function readPart(raw: string | number): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : null;
  }
  const text = String(raw ?? "").trim();
  /* Empty is zero — somebody entering "30" in minutes should not have to type
     a 0 into hours as well. */
  if (text === "") return 0;
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export type EtValidation =
  | { ok: true; secs: number }
  | { ok: false; message: string };

/**
 * Is this a figure the prompt may be saved with?
 *
 * The messages are the ones shown under the field, so they name what to do
 * rather than what went wrong: "Enter hours and minutes as whole numbers" tells
 * somebody who typed "1.5" what will work.
 */
export function validateEtInput(input: EtInput): EtValidation {
  const secs = parseEtInput(input);
  if (secs === null) {
    return { ok: false, message: "Enter hours and minutes as whole numbers." };
  }
  if (secs === 0) {
    return { ok: false, message: "Enter how much time to add or subtract." };
  }
  if (secs > MAX_ADJUSTMENT_SECS) {
    return { ok: false, message: "That is more than 30 days — check the figure." };
  }
  return { ok: true, secs };
}

/**
 * The estimate after an adjustment. **Never negative.**
 *
 * Subtracting more than the task has leaves it at zero rather than going below
 * it. A negative budget is not a smaller estimate — it is a number every
 * downstream calculation would carry into a deadline, a remaining-time figure
 * and a score, and none of them have a meaning for it.
 */
export function applyEtAdjustment(
  currentSecs: number,
  direction: EtDirection,
  deltaSecs: number,
): number {
  const current = Math.max(0, Math.round(Number(currentSecs) || 0));
  const delta = Math.max(0, Math.round(Number(deltaSecs) || 0));
  return direction === "add"
    ? current + delta
    : Math.max(0, current - delta);
}

/** The signed delta actually applied — which is not the delta asked for when a
 *  subtraction was clamped at zero. This is what gets recorded, so the history
 *  says what happened rather than what was requested. */
export function appliedDeltaSecs(
  currentSecs: number,
  direction: EtDirection,
  deltaSecs: number,
): number {
  return applyEtAdjustment(currentSecs, direction, deltaSecs) -
    Math.max(0, Math.round(Number(currentSecs) || 0));
}

/** Would this subtraction be clamped? The prompt says so before it is saved. */
export function wouldClamp(
  currentSecs: number,
  direction: EtDirection,
  deltaSecs: number,
): boolean {
  if (direction !== "subtract") return false;
  const current = Math.max(0, Math.round(Number(currentSecs) || 0));
  return Math.max(0, Math.round(Number(deltaSecs) || 0)) > current;
}

/**
 * Seconds as a person would say them: "6h", "1h 30m", "45m", "None".
 *
 * Hours and minutes only — a task estimate of several days still reads more
 * usefully in hours here, because that is the unit the field is typed in and
 * the unit the timer counts in.
 */
export function formatEt(secs: number): string {
  const total = Math.max(0, Math.round(Number(secs) || 0));
  if (total === 0) return "None";
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  /* 59.6 minutes rounds to 60, which would read "1h 60m". */
  if (m === 60) return `${h + 1}h`;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** "6h → 7h 30m", for the line under the prompt's buttons. */
export function previewEt(
  currentSecs: number,
  direction: EtDirection,
  deltaSecs: number,
): string {
  return `${formatEt(currentSecs)} → ${formatEt(
    applyEtAdjustment(currentSecs, direction, deltaSecs),
  )}`;
}
