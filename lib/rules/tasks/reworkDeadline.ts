/**
 * The deadline a task gets when it is sent back for rework.
 *
 * **You keep the time you had left when you handed it in.** OWNER DECISION,
 * 16 Aug 2026 — settled after two wrong turns the same day, both recorded below
 * because the reasoning is what stops them being taken again.
 *
 * The window is `deadline − submittedAt`, run from the moment the reviewer sent
 * it back. Submit an hour early and you get an hour to redo it; submit with a
 * minute to spare and you get a minute. **Finishing early is what earns rework
 * time**, which is the incentive the rule exists to create.
 *
 * ## The two wrong turns, so they are not repeated
 *
 * The brief read "a fresh 1-hour deadline **instead of** the remaining time",
 * and it came with an example: deadline 6:00, submitted 5:00, sent back 5:45,
 * due 6:45. Those two contradict each other and the example is the truth —
 * 6:00 − 5:00 is exactly one hour, so `5:45 + leftover` **is** 6:45. The
 * example could not tell the two rules apart, and the words pointed the wrong
 * way. It was rewritten to a flat hour, then to the task's whole budget, before
 * the owner's own numbers on T043 and T044 made it plain: every figure they had
 * quoted was the leftover.
 *
 * ## What is kept from those attempts
 *
 * 1. **The on-time gate**, which the original had no version of. Without it a
 *    late submission produces a NEGATIVE leftover and a deadline in the past —
 *    instantly overdue, timer blocked, for a rework nobody had started. A late
 *    submission now keeps its date and needs an extension, which is deliberate.
 * 2. **Office time.** The leftover is walked through the working calendar like
 *    every other deadline here, so four minutes left at 5:58 against a 6:00
 *    close finishes tomorrow morning rather than at 6:02 with nobody at a desk.
 *    The original added raw milliseconds to a snapped start.
 * 3. **The test is on the SUBMISSION, never the review.** Hand in on time and
 *    the reviewer takes three hours to look — the leftover is still measured
 *    from your submission and still granted, running from when they replied. A
 *    slow review cannot cost somebody time they had earned.
 * 4. **The new date replaces the old one everywhere**, scoring included, and
 *    each further round moves it again.
 */

/**
 * Why a rework did not move the deadline.
 *
 * Named rather than collapsed into a boolean because the three cases need
 * different things said to different people: the late case is a rule the
 * assignee must understand, and the two missing-data cases are faults nobody
 * should be blamed for.
 */
export type ReworkDeadlineHeld =
  /** The submission missed its deadline. The rule, working. */
  | "submitted_late"
  /** No deadline to compare against — a task that never had one. */
  | "no_deadline"
  /** No submission timestamp, so on-time cannot be established either way. */
  | "no_submission";

export type ReworkDeadlineOutcome =
  | { moved: true; newDueAtIso: string; windowSecs: number }
  | { moved: false; reason: ReworkDeadlineHeld };

export function reworkDeadline(input: {
  /** When the submission under review was handed in. */
  submittedAtMs: number | null;
  /** The task's deadline as it stands now. */
  currentDueAtMs: number | null;
  /** When the reviewer pressed send-back. */
  reworkAtMs: number;
  /**
   * The office-calendar walk, injected.
   *
   * Kept out of this module so the rule stays pure and the SAME walker serves
   * it as serves the deadline chain — a second implementation of working hours
   * is a second answer to when the office is open.
   */
  addWorkingSecs: (fromMs: number, secs: number) => string;
}): ReworkDeadlineOutcome {
  const { submittedAtMs, currentDueAtMs, reworkAtMs } = input;

  /* Both are needed to answer "was this on time", and neither is invented. A
     missing figure leaves the deadline exactly where it was, which is the
     cautious direction: it never hands out time that was not earned. */
  if (!Number.isFinite(currentDueAtMs as number) || currentDueAtMs === null) {
    return { moved: false, reason: "no_deadline" };
  }
  if (!Number.isFinite(submittedAtMs as number) || submittedAtMs === null) {
    return { moved: false, reason: "no_submission" };
  }

  /* Inclusive. Handing in exactly ON the deadline is on time — the rule is
     "before the deadline passed", and at the stroke it has not passed. */
  if ((submittedAtMs as number) > (currentDueAtMs as number)) {
    return { moved: false, reason: "submitted_late" };
  }

  /**
   * **The time you had left when you handed it in.**
   *
   * Non-negative by construction: the gate above has already established the
   * submission beat the deadline, which is the same statement as this
   * subtraction being positive. That is why the gate is not merely a policy —
   * it is what makes the arithmetic safe. Without it a late submission yields a
   * negative window and a deadline BEFORE the rework, which is how the original
   * rule produced instantly-overdue tasks.
   *
   * Floored to whole seconds rather than rounded: rounding up would hand back a
   * fraction of a second nobody had, and the figure is read as a clock time.
   */
  const windowSecs = Math.floor(
    ((currentDueAtMs as number) - (submittedAtMs as number)) / 1000,
  );

  return {
    moved: true,
    newDueAtIso: input.addWorkingSecs(reworkAtMs, windowSecs),
    windowSecs,
  };
}

/**
 * What the people involved are told.
 *
 * The held cases matter more than the moved one. A deadline that silently did
 * not move is the reported complaint waiting to happen — the assignee sees a
 * blocked timer on a task they were just asked to redo, with nothing on screen
 * connecting the two.
 */
export function reworkDeadlineMessage(
  outcome: ReworkDeadlineOutcome,
): string | null {
  if (outcome.moved) return null;
  switch (outcome.reason) {
    case "submitted_late":
      return "This was handed in after its deadline, so the deadline does not move for rework. The task stays overdue and its timer stays blocked — ask for more time before starting the rework.";
    case "no_deadline":
      return "This task has no deadline, so there is none to reset for the rework.";
    case "no_submission":
      return "The submission has no recorded time, so whether it beat the deadline cannot be established. The deadline is left as it was.";
  }
}

/**
 * The one-line explanation beside a rework that DID reset the clock.
 *
 * Names the RULE, not only the number. "+00:11:36" says what happened; this
 * says why that figure and not another, which is the half that stops the next
 * question — and the figure is now the task's own budget, so a reader who
 * recognises it will otherwise wonder whether it is a coincidence.
 */
export function reworkGrantNote(windowSecs?: number | null): string {
  return Number.isFinite(windowSecs) && (windowSecs as number) > 0
    ? `Handed in with ${formatWindow(windowSecs as number)} to spare, so the rework gets that time back as office time, counted from when it was sent back.`
    : "Handed in before the deadline, so the rework gets back the time that was left, as office time counted from when it was sent back.";
}

/** `HH:MM:SS` for a window, matching how a budget is written elsewhere. */
function formatWindow(secs: number): string {
  const whole = Math.max(0, Math.round(secs));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor((whole % 3600) / 60))}:${pad(whole % 60)}`;
}
