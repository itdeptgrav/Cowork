/**
 * Where each of a task's outputs has got to, and what that means for the task.
 *
 * An output is a thing a task hands over — "Google Doc — Gopalpur" — and it
 * goes through the same submission and review a task does. What this module
 * decides is read off those records: nothing here stores a state, so an
 * output's standing can never drift from the submissions and reviews that
 * actually happened.
 *
 * ## Why the edge runs output to output
 *
 * A task-level dependency can only mean "wait for all of it", which is not how
 * the work runs: Anant writes Gopalpur, hands it over, and writes Puri while
 * Umang designs Gopalpur. So Umang's "Figma — Gopalpur" names Anant's "Google
 * Doc — Gopalpur" and nothing else, and her TASK is workable as soon as any one
 * of her outputs is.
 *
 * That is what makes this possible without subtasks. Nobody's work is split;
 * one task, one assignee, one deadline, with a list on it.
 */

export type OutputState =
  /** Never submitted. */
  | "not_started"
  /** Submitted, awaiting a decision. */
  | "in_review"
  /** Sent back. The assignee has it again, and may resubmit. */
  | "rework"
  /** Refused outright. */
  | "rejected"
  /** Approved at the final stage of the review chain. Released downstream. */
  | "approved";

/** The submission facts this module reads. A subset of `TaskSubmission`. */
export interface OutputSubmissionFact {
  outputId: string | null;
  attempt: number;
  /** The last decision on this submission, if one has been made. */
  decision: "approved" | "rework" | "rejected" | null;
  /** Whether that decision was the FINAL stage. A mid-chain approval is not one. */
  isFinal: boolean;
}

/**
 * The state of one output, from its submissions.
 *
 * The LATEST attempt decides. An output returned once and resubmitted is in
 * review, not in rework — reporting the older decision would show somebody's
 * corrected work as still wrong.
 */
export function outputState(
  outputId: string,
  submissions: readonly OutputSubmissionFact[],
): OutputState {
  const mine = submissions
    .filter((s) => s.outputId === outputId)
    .sort((a, b) => b.attempt - a.attempt);
  const latest = mine[0];
  if (!latest) return "not_started";
  if (latest.decision === null) return "in_review";
  if (latest.decision === "rework") return "rework";
  if (latest.decision === "rejected") return "rejected";
  /* Approved, but only a FINAL-stage approval releases anything. A first-stage
     approval on a two-stage chain means it is still with the second reviewer,
     and treating that as delivered would hand work downstream that nobody has
     finished checking. */
  return latest.isFinal ? "approved" : "in_review";
}

/**
 * Can this output be worked on — has everything it needs been approved?
 *
 * `approvedOutputIds` is the set of outputs approved ANYWHERE, across every
 * task, because an input is by definition somebody else's output.
 *
 * An unknown id counts as NOT approved. Releasing on missing data would start
 * a clock against work whose input may not exist, and the safe direction is to
 * keep waiting and say so.
 */
export function isOutputWorkable(
  output: { needsOutputIds: readonly string[] },
  approvedOutputIds: ReadonlySet<string>,
): boolean {
  return output.needsOutputIds.every((id) => approvedOutputIds.has(id));
}

/**
 * Does this task hold a queue slot?
 *
 * **A task with outputs is workable while ANY of them is**, and drops out only
 * when every one is waiting on somebody. That is what keeps Umang's single task
 * live while three of her four outputs are blocked — the alternative, dropping
 * her whole task because one input is missing, would be wrong in the ordinary
 * case rather than the exception.
 *
 * A task with no outputs is workable, unchanged. That is every task in the
 * product today.
 */
export function taskHasWorkableOutput(
  outputs: readonly { needsOutputIds: readonly string[] }[],
  approvedOutputIds: ReadonlySet<string>,
): boolean {
  if (outputs.length === 0) return true;
  return outputs.some((o) => isOutputWorkable(o, approvedOutputIds));
}

/**
 * Is there an output this person could actually sit down and work on?
 *
 * **Stricter than `taskHasWorkableOutput`, and the two are not
 * interchangeable.** That one asks whether an output's INPUTS have landed. This
 * asks the question a queue and a timer actually need: is there anything left
 * to do — an output whose inputs are approved AND which has not already been
 * handed over.
 *
 * The distinction is not academic. A task whose one released output is already
 * sitting with a reviewer has nothing anybody can start, yet its inputs are all
 * approved. Asking the looser question there kept such a task at P1 while the
 * screen beside it read "Waiting on Puri pg" — two answers to one question,
 * from two places that had each derived it themselves.
 *
 * A task with no outputs is startable: every task that predates them.
 */
export function hasStartableOutput(input: {
  outputs: readonly { id: string; needsOutputIds: readonly string[] }[];
  approvedOutputIds: ReadonlySet<string>;
  stateOf: (outputId: string) => OutputState;
}): boolean {
  if (input.outputs.length === 0) return true;
  return input.outputs.some((o) => {
    if (!isOutputWorkable(o, input.approvedOutputIds)) return false;
    const state = input.stateOf(o.id);
    /* `in_review` and `approved` are done with, from the assignee's side. */
    return state === "not_started" || state === "rework";
  });
}

/**
 * Is the task finished — every output approved?
 *
 * OWNER DECISION: a task with outputs completes when they are all approved,
 * rather than going through a second review of its own. That final pass could
 * only ever rubber-stamp work the same chain had already approved one piece at
 * a time, and a review that can only approve measures nothing.
 *
 * False for a task with no outputs: those still finish the way they always
 * have, through their own submission and review.
 */
export function allOutputsApproved(
  outputs: readonly { id: string }[],
  submissions: readonly OutputSubmissionFact[],
): boolean {
  if (outputs.length === 0) return false;
  return outputs.every((o) => outputState(o.id, submissions) === "approved");
}

/**
 * The share of the rework deduction one returned output costs.
 *
 * **Outputs divide a task's value; they do not multiply it.** The score is
 * `achieved / achievable`, so scoring each output as a whole task would be
 * self-normalising and fair on its face — but it would also make the number of
 * outputs a WEIGHT, set by whoever writes the list. Ten trivial outputs would
 * then carry ten times the weight of one hard one, and nobody would have
 * cheated to get there.
 *
 * So the task keeps the value it already has and its outputs divide it:
 *
 *  · 1 output, 1 returned  → the full deduction. Identical to today.
 *  · 4 outputs, 1 returned → a quarter of it.
 *  · 4 outputs, 4 returned → the full deduction, which is the right answer for
 *    a task that was wrong throughout.
 *
 * Returns 1 for a task with no outputs, so the existing per-occurrence rule
 * applies unscaled to every task in the product today.
 */
export function reworkShare(returned: number, totalOutputs: number): number {
  if (totalOutputs <= 0) return 1;
  return Math.min(returned, totalOutputs) / totalOutputs;
}

/**
 * Whether a review may proceed on this submission.
 *
 * The engine's own guard refuses unless the task is `in_review`, and that is
 * right for a task-level submission: it is the whole of the work, and reviewing
 * it while somebody is still editing would be reviewing a moving target.
 *
 * An OUTPUT submission is the opposite case. The task is legitimately still in
 * progress — Anant is writing Puri while Gopalpur is being read — so requiring
 * `in_review` would refuse every per-output review ever raised.
 */
export function mayReview(input: {
  outputId: string | null;
  taskStatus: string;
}): boolean {
  return input.outputId !== null || input.taskStatus === "in_review";
}

/**
 * Is this task blocked — nothing on it anybody could sit down to?
 *
 * **The same question `hasStartableOutput` answers, asked of the VIEW.** That
 * one takes raw outputs plus an approved-id set, because the queue and the
 * timer hold the documents. A rendered `TaskView` has already resolved both —
 * each output carries its own `isWorkable` and `state` — so re-deriving from
 * ids here would mean a third copy of one rule, and a third chance to disagree.
 *
 * False for a task with no outputs: every task that predates them, and nothing
 * about them is blocked.
 */
export function isTaskBlocked(
  outputs: readonly { isWorkable: boolean; state: OutputState }[],
): boolean {
  if (outputs.length === 0) return false;
  return !outputs.some(
    (o) => o.isWorkable && (o.state === "not_started" || o.state === "rework"),
  );
}
