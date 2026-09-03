/**
 * Whether a task is overdue — judged at the moment the work was handed in.
 *
 * **The bug this exists to fix.** Overdue was `dueAt < now`, exempting only
 * completed and cancelled tasks. So work submitted on Tuesday for a Wednesday
 * deadline sat in review, and on Thursday morning it grew an Overdue chip. The
 * person had done nothing wrong and had nothing they could do: the task was
 * with a reviewer, its timer closed, and the badge was accusing them of being
 * late for a hand-in they had made early.
 *
 * That is not a display quirk. `isOverdue` is what the Tasks list sorts and
 * filters by, what the overdue counter on a manager's screen totals, and what
 * `TasksOverview` puts at the top of somebody's day — so a reviewer sitting on
 * a queue silently manufactured late work for the people who had beaten their
 * deadlines.
 *
 * **The rule is that a deadline is a deadline for HANDING IN.** Once the work
 * is with a reviewer the clock has been stopped by the person who was being
 * timed; how long the review then takes is somebody else's delay and belongs to
 * the reviewer, not to the assignee's record. So the comparison is made against
 * the hand-in, and the answer stops changing.
 *
 * **What deliberately does NOT change:**
 *
 *   - Work handed in LATE stays overdue, and stays overdue through review and
 *     through rework. `reworkDeadline.ts` already states this rule to the
 *     person's face — "This was handed in after its deadline, so the deadline
 *     does not move for rework" — and it would be incoherent for the chip to
 *     disagree with the message.
 *   - Work SENT BACK is being worked on again, so it is judged against now
 *     again. The deadline is live once more, which is the whole reason
 *     `reworkDeadline` exists to move it.
 *   - Nothing here touches the deadline itself, the timer block, or scoring.
 *     This decides one badge and the lists derived from it.
 */

export function taskOverdue(input: {
  dueAtMs: number | null;
  nowMs: number;
  /** Completed or cancelled: finished work is never chased. */
  terminal: boolean;
  /**
   * When the work was handed in, and ONLY while it is still with a reviewer.
   *
   * Null the moment it comes back — a task in progress is judged against now,
   * however many times it has been submitted before.
   *
   * Null also when the engine kept no timestamp, which is the case for
   * submissions made before it recorded one. That falls back to `now`, so an
   * old record behaves exactly as it does today rather than being quietly
   * declared on time.
   */
  handedInAtMs: number | null;
}): boolean {
  const { dueAtMs, nowMs, terminal, handedInAtMs } = input;
  if (dueAtMs === null || terminal) return false;
  return (handedInAtMs ?? nowMs) > dueAtMs;
}

/**
 * The hand-in instant to judge against, or null to judge against now.
 *
 * Separate from the comparison because the two questions fail differently: this
 * one is about reading a record the engine may not have written, and the one
 * above is arithmetic. Keeping them apart lets the arithmetic be tested without
 * a task document.
 */
export function handedInAt(input: {
  status: string;
  submittedAtMs: number | null;
}): number | null {
  /* `in_review` is the only status where the work is out of the assignee's
     hands. Every other one — including a task that has been submitted and sent
     back — has somebody working on it, so the deadline is live. */
  return input.status === "in_review" ? input.submittedAtMs : null;
}
