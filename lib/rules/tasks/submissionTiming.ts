/**
 * How far ahead of its deadline, or behind it, a submission arrived.
 *
 * ## Measured, not read off the record
 *
 * `TaskSubmission.wasLate` exists and looks like the answer. It is not usable
 * here: the legacy read path hardcodes it to `false` in all three places it is
 * built, so on production data every submission claims to be on time. It also
 * only ever answered yes-or-no, and the question a reviewer actually has when
 * nine submissions are stacked in their inbox is *how far* — an hour over is a
 * different conversation from three days over.
 *
 * So this compares the two timestamps the engine does record honestly: when the
 * work was handed in, and when it was due.
 *
 * ## Null is a real answer
 *
 * A task with no deadline set cannot be late, and an unparseable date is not
 * evidence of anything. Both return null and the caller shows nothing — never
 * "on time", which would be a claim, and never "0m late", which would be a
 * claim dressed as a measurement.
 *
 * ## The minute of tolerance
 *
 * Landing within a minute of a deadline is hitting it. Without the tolerance
 * the common case reads "0m late", which is both noise and, at the boundary, a
 * coin flip between "late" and "early" decided by clock skew.
 */

export type SubmissionTimingKind = "early" | "late" | "on_time";

export interface SubmissionTiming {
  kind: SubmissionTimingKind;
  /** Whole seconds between the deadline and the submission, always positive. */
  secs: number;
  /** What to print: "2d 3h early", "5h late", "on time". */
  label: string;
}

/** Inside this, it was on time. See the note above. */
const TOLERANCE_MS = 60_000;

export function submissionTiming(input: {
  submittedAt: string | null | undefined;
  dueAt: string | null | undefined;
}): SubmissionTiming | null {
  const submitted = msOf(input.submittedAt);
  const due = msOf(input.dueAt);
  if (submitted === null || due === null) return null;

  const diff = due - submitted;
  if (Math.abs(diff) < TOLERANCE_MS)
    return { kind: "on_time", secs: 0, label: "on time" };

  const secs = Math.round(Math.abs(diff) / 1000);
  const kind: SubmissionTimingKind = diff > 0 ? "early" : "late";
  return { kind, secs, label: `${spanOf(secs)} ${kind === "early" ? "early" : "late"}` };
}

function msOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A span at the coarsest honest resolution: `2d 3h`, `5h 20m`, `12m`.
 *
 * **Days, unlike `formatDuration`.** That helper tops out at hours, which is
 * right for effort logged against a task and wrong here: work handed in three
 * days late reads as "75h", and nobody converts that in their head while
 * scanning a list.
 *
 * Two units at most. "2d 3h 14m" is a measurement; a reviewer needs a
 * magnitude, and the third unit is never what decides anything.
 */
function spanOf(secs: number): string {
  const d = Math.floor(secs / 86_400);
  const h = Math.floor((secs % 86_400) / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  /* Rounding can land a 59-minute-59-second span on 60. Showing "60m" beside
     an "1h 2m" on the next row is one value in two shapes. */
  if (m >= 60) return "1h";
  return `${m}m`;
}
