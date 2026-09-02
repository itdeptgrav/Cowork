import type { TaskView } from "@/lib/repositories/types";

/**
 * How many submissions on this task are still waiting on a review decision.
 *
 * This is what the Submission tab badges — a persistent "something is pending
 * here" count, distinct from the tab-activity badge (which means "new since you
 * last looked" and clears the moment you open the tab). A submission awaiting
 * review stays pending until it is approved, reworked or rejected, so the count
 * stays up until the decision is made rather than until the tab is read.
 *
 * ## Two shapes of submission, and why both are counted here
 *
 *  · **The whole task.** A task submitted for review sits at `in_review` with
 *    no output of its own. The legacy repository does NOT put this in
 *    `openSubmissions` — that array is per-OUTPUT there — so the status is the
 *    only signal, and it is the authoritative one: `in_review` means a
 *    submission is on a reviewer's desk.
 *  · **Per output.** A task with outputs can have several submissions open at
 *    once — Gopalpur waiting while Puri is already approved. Those live in
 *    `openSubmissions` (documented as "submissions still awaiting a decision"),
 *    and each open one is a separate pending item.
 *
 * Counted apart and summed so neither path double-counts the other: the
 * whole-task submission carries `outputId: null` and is excluded from the
 * per-output tally, which only sums entries that name an output.
 */
export function pendingSubmissionCount(view: TaskView): number {
  const wholeTask = view.task.status === "in_review" ? 1 : 0;
  const perOutput = (view.openSubmissions ?? []).filter(
    (s) => s.outputId != null,
  ).length;
  return wholeTask + perOutput;
}

/** Is anything on this task awaiting a review decision? */
export function hasPendingSubmission(view: TaskView): boolean {
  return pendingSubmissionCount(view) > 0;
}
