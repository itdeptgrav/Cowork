/**
 * Who reviews a submission, and at which stage.
 *
 * **The bug this was written for.** The chain was derived from who had ALREADY
 * reviewed — `tlReview.reviewedBy`, then `ceoReview.reviewedBy` — which is empty
 * until somebody reviews. So `reviewChain.includes(me)` was false for everyone,
 * every submission refused every reviewer, and the review step could never
 * begin. A task submitted by UMUNG on work RISHEE RAY had assigned told RISHEE
 * RAY that *"this submission is with someone else"*, when it was with them.
 *
 * The chain has to be resolved **forward** — from the flow legacy stamped on the
 * task at submission time — not read backwards out of the decisions already
 * taken.
 *
 * ---
 *
 * `_reviewFlow` (`taskForward.service.js:1137`) decides the shape, and legacy
 * stores its answer on the task as `reviewFlow` when the completion is
 * submitted. Three shapes, and the root creator's ROLE picks between them:
 *
 * | Flow | When | Stages |
 * |---|---|---|
 * | `tl_final` | a team lead created it | the lead, alone |
 * | `ceo_direct` | the chief executive created it, no parent and no forward | the chief executive, alone |
 * | `tl_then_ceo` | anything else — including a CEO task that was forwarded or is a subtask | the lead, then the chief executive |
 *
 * That third row is why the reported case resolves to one stage rather than
 * two: a task the CEO raised directly has no parent and no forward, so it is
 * `ceo_direct` and the CEO is the only reviewer.
 */

export type ReviewFlow = "tl_final" | "ceo_direct" | "tl_then_ceo";

/** Which kind of person occupies a stage. Resolved to ids by the repository. */
export type ReviewerRole = "creator" | "assignee_manager" | "chief_executive";

/**
 * The flow for a task.
 *
 * The STORED value wins. `submitCompletionRequest` writes `reviewFlow` at the
 * moment of submission, and that is the flow the submission was made under —
 * re-deriving it later would let a task that has since been re-parented change
 * who was supposed to review work that was already handed in.
 *
 * Everything below the stored value is legacy's own derivation, in its order,
 * including the older boolean flags it still honours for tasks created before
 * `rootCreatedByRole` existed.
 */
export function readReviewFlow(doc: Record<string, unknown>): ReviewFlow {
  const stored = doc.reviewFlow;
  if (stored === "tl_final" || stored === "ceo_direct" || stored === "tl_then_ceo") {
    return stored;
  }

  const forwarded = !!doc.forwardedBy;
  const hasParent = !!doc.parentTaskId;
  const rootRole = doc.rootCreatedByRole ?? doc.assignedByRole;

  if (rootRole === "tl") return "tl_final";
  if (rootRole === "ceo") {
    return !hasParent && !forwarded ? "ceo_direct" : "tl_then_ceo";
  }

  /* Legacy flags, for tasks predating the role fields. */
  if (doc.createdByTl === true) return "tl_final";
  if (doc.createdByCeo === true) {
    return forwarded ? "tl_then_ceo" : "ceo_direct";
  }

  /* Legacy's own last resort. It calls this the "safe default" — two stages
     asks for more scrutiny than one, so guessing here withholds an approval
     rather than granting one. */
  return "tl_then_ceo";
}

/** The stages, in order. */
export function stagesOf(flow: ReviewFlow): ReviewerRole[] {
  switch (flow) {
    case "tl_final":
      return ["creator"];
    case "ceo_direct":
      return ["chief_executive"];
    case "tl_then_ceo":
      return ["assignee_manager", "chief_executive"];
  }
}

/**
 * How many stages have been decided.
 *
 * Legacy records at most one review per level — `tlReview` and `ceoReview` —
 * so the count of filled slots is the count of completed stages. A rejection
 * fills the slot too: it is a decision, and it ends the review rather than
 * passing it on.
 */
export function completedStages(doc: Record<string, unknown>): number {
  let done = 0;
  if (doc.tlReview && typeof doc.tlReview === "object") done += 1;
  if (doc.ceoReview && typeof doc.ceoReview === "object") done += 1;
  return done;
}

/**
 * The 1-based stage awaiting a decision.
 *
 * Clamped to the chain's length so a task with more recorded reviews than
 * stages — which a re-submission can produce — reports the last stage rather
 * than an index past the end.
 */
export function currentStageOf(
  doc: Record<string, unknown>,
  stageCount: number,
): number {
  if (stageCount <= 0) return 1;
  return Math.min(stageCount, completedStages(doc) + 1);
}

/**
 * May this person decide the stage that is open?
 *
 * Two conditions, and the second is the one legacy got wrong. Its
 * `review-completion` route has **no check at all** — spec defect P1, "anyone
 * can approve any task" — so this is deliberately narrower than the engine.
 * What it must not be is narrower than the WORKFLOW, which is what the empty
 * chain made it.
 *
 * Self-review is refused separately and unconditionally: nobody signs off their
 * own work, whatever the chain says, and legacy's own defect list names that as
 * the critical one.
 */
export function mayReview(input: {
  chain: string[];
  currentStage: number;
  viewerId: string | null;
  submittedById: string;
}): boolean {
  if (!input.viewerId) return false;
  if (input.submittedById === input.viewerId) return false;
  return input.chain[input.currentStage - 1] === input.viewerId;
}
