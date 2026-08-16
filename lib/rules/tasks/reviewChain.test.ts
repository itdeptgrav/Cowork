import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  completedStages,
  currentStageOf,
  mayReview,
  readReviewFlow,
  stagesOf,
} from "./reviewChain.ts";

/**
 * Who may review a submission.
 *
 * **The reported fault.** A task RISHEE RAY assigned, submitted by UMUNG, told
 * RISHEE RAY that *"this submission is with someone else"*. The chain was
 * derived from who had ALREADY reviewed — `tlReview.reviewedBy`, then
 * `ceoReview.reviewedBy` — which is empty until somebody reviews. So
 * `reviewChain.includes(me)` was false for everyone, every fresh submission
 * refused every reviewer, and the review step could never begin.
 *
 * The chain has to be resolved FORWARD, from the flow legacy stamps on the task
 * at submission time. These tests pin that resolution, and the reported case
 * has one of its own.
 */

/* ── The reported scenario ────────────────────────────────────────────────── */

test("a task the chief executive raised directly is reviewed BY them", () => {
  /* The screenshot's case. `_reviewFlow` (`taskForward.service.js:1143`): a
     `ceo` root role with no parent and no forward is `ceo_direct`, one stage.
     RISHEE RAY is the CEO and the owner, so RISHEE RAY is the reviewer — and
     was being told the submission was with somebody else. */
  const doc = { rootCreatedByRole: "ceo" };
  assert.equal(readReviewFlow(doc), "ceo_direct");
  assert.deepEqual(stagesOf("ceo_direct"), ["chief_executive"]);

  assert.equal(
    mayReview({
      chain: ["GR0000"],
      currentStage: 1,
      viewerId: "GR0000",
      submittedById: "UMUNG",
    }),
    true,
    "the owner-and-chief-executive must be able to review",
  );
});

test("an empty chain refuses everyone — the shape of the original bug", () => {
  /* Kept as a test because the failure was silent: nothing errored, everybody
     was simply refused. */
  for (const viewer of ["GR0000", "GR0045", "UMUNG"]) {
    assert.equal(
      mayReview({ chain: [], currentStage: 1, viewerId: viewer, submittedById: "x" }),
      false,
    );
  }
});

/* ── Flow resolution ──────────────────────────────────────────────────────── */

test("the stored flow wins over re-derivation", () => {
  /* `submitCompletionRequest` writes `reviewFlow` at the moment of submission.
     Re-deriving later would let a task that has since been re-parented change
     who was supposed to review work already handed in. */
  assert.equal(
    readReviewFlow({ reviewFlow: "tl_final", rootCreatedByRole: "ceo" }),
    "tl_final",
  );
});

test("a team lead's task is reviewed by that lead alone", () => {
  assert.equal(readReviewFlow({ rootCreatedByRole: "tl" }), "tl_final");
  assert.deepEqual(stagesOf("tl_final"), ["creator"]);
});

test("two stages are never DERIVED — the assigner's approval is final", () => {
  /**
   * **REVERSED — OWNER DECISION, 16 Aug 2026.**
   *
   * These cases used to resolve to `tl_then_ceo`: an assigner whose role
   * string read "employee" got a two-stage chain, so their approval credited
   * nothing while a "tl" assigner's identical approval completed the task.
   * Reported as "point not credited on a completed task" — T053, approved by
   * its assigner at 15:13 and scored null, because the assigner's stored role
   * was "employee". Role strings no longer decide anything here.
   */
  assert.equal(
    readReviewFlow({ rootCreatedByRole: "ceo", parentTaskId: "t-1" }),
    "tl_final",
  );
  assert.equal(
    readReviewFlow({ rootCreatedByRole: "ceo", forwardedBy: "GR0045" }),
    "tl_final",
  );
  assert.equal(readReviewFlow({}), "tl_final");
  assert.equal(readReviewFlow({ rootCreatedByRole: "employee" }), "tl_final");
});

test("assignedByRole stands in when rootCreatedByRole is absent", () => {
  assert.equal(readReviewFlow({ assignedByRole: "tl" }), "tl_final");
});

test("the older boolean flags are still honoured", () => {
  /* Tasks created before `rootCreatedByRole` existed carry these instead —
     and the forwarded-CEO case now lands one stage like everything else. */
  assert.equal(readReviewFlow({ createdByTl: true }), "tl_final");
  assert.equal(readReviewFlow({ createdByCeo: true }), "ceo_direct");
  assert.equal(
    readReviewFlow({ createdByCeo: true, forwardedBy: "x" }),
    "tl_final",
  );
});

test("a submission stamped under the old rule still renders its two stages", () => {
  /* The STORED value wins, and that is what keeps history honest: a July task
     really did go lead-then-CEO, and its review record must keep saying so.
     Only the derivation stopped producing it. */
  assert.equal(
    readReviewFlow({ reviewFlow: "tl_then_ceo", rootCreatedByRole: "employee" }),
    "tl_then_ceo",
  );
  assert.deepEqual(stagesOf("tl_then_ceo"), [
    "assignee_manager",
    "chief_executive",
  ]);
});

/* ── Stage progression ────────────────────────────────────────────────────── */

test("a filled review slot is a completed stage, approval or rejection", () => {
  /* A rejection is a decision too — it ends the review rather than passing it
     on, so it must not leave the stage looking open. */
  assert.equal(completedStages({}), 0);
  assert.equal(completedStages({ tlReview: { approved: true } }), 1);
  assert.equal(completedStages({ tlReview: { approved: false } }), 1);
  assert.equal(
    completedStages({ tlReview: { approved: true }, ceoReview: { approved: true } }),
    2,
  );
});

test("the open stage is the next undecided one", () => {
  assert.equal(currentStageOf({}, 2), 1);
  assert.equal(currentStageOf({ tlReview: {} }, 2), 2);
});

test("more reviews than stages reports the last stage, not an index past the end", () => {
  assert.equal(currentStageOf({ tlReview: {}, ceoReview: {} }, 1), 1);
  assert.equal(currentStageOf({ tlReview: {}, ceoReview: {} }, 2), 2);
});

/* ── The gate ─────────────────────────────────────────────────────────────── */

test("only the person at the OPEN stage may decide", () => {
  /* The second reviewer is in the chain from the start. Gating on membership
     rather than on position would let them decide before the first stage had,
     skipping it entirely. */
  const chain = ["GR0045", "GR0000"];
  assert.equal(
    mayReview({ chain, currentStage: 1, viewerId: "GR0045", submittedById: "u" }),
    true,
  );
  assert.equal(
    mayReview({ chain, currentStage: 1, viewerId: "GR0000", submittedById: "u" }),
    false,
    "the second reviewer must wait for the first",
  );
  assert.equal(
    mayReview({ chain, currentStage: 2, viewerId: "GR0000", submittedById: "u" }),
    true,
  );
});

test("nobody reviews their own submission, whatever the chain says", () => {
  /* Legacy's critical defect P1 — `review-completion` has no check at all, so
     the submitter could approve themselves. This is narrower than the engine on
     purpose. */
  assert.equal(
    mayReview({
      chain: ["GR0000"],
      currentStage: 1,
      viewerId: "GR0000",
      submittedById: "GR0000",
    }),
    false,
  );
});

test("an unresolved viewer may not review", () => {
  assert.equal(
    mayReview({ chain: ["GR0000"], currentStage: 1, viewerId: null, submittedById: "u" }),
    false,
  );
});

test("somebody outside the chain still cannot review", () => {
  /* The fix must not widen access. */
  assert.equal(
    mayReview({
      chain: ["GR0000"],
      currentStage: 1,
      viewerId: "GR0108",
      submittedById: "UMUNG",
    }),
    false,
  );
});

/* ── One predicate, every consumer ────────────────────────────────────────── */

test("the panel, the inbox and the status label all use this one function", () => {
  /* Three copies of `reviewChain[currentStage - 1] === viewerId` is three places
     for the review gate to drift apart — and the panel's copy is the one that
     told an owner their own task was somebody else's. */
  for (const file of [
    "components/features/tasks/ReviewPanel.tsx",
    "components/features/tasks/statusMeta.ts",
    "lib/rules/tasks/actionable.ts",
  ]) {
    const src = readFileSync(file, "utf8");
    assert.match(src, /mayReview\(/, `${file} should use the shared predicate`);
  }
});

test("the repository resolves the chain forward, not from past reviews", () => {
  /* The regression itself: reading `reviewedBy` to build the chain is what made
     it empty until somebody had already reviewed. */
  const repo = readFileSync("lib/repositories/legacy/index.ts", "utf8");
  const start = repo.indexOf("async #reviewChainOf");
  const block = repo.slice(start, repo.indexOf("async #resolveReviewer"));
  assert.ok(block.length > 0, "the slice anchors no longer match");
  assert.match(block, /readReviewFlow/);
  assert.match(block, /stagesOf/);
  assert.equal(
    /reviewedBy/.test(block),
    false,
    "the chain must not be built from who has already reviewed",
  );
});

test("the chief executive stage resolves by ROLE, never by a hardcoded id", () => {
  /* Legacy's `ceo-review` is guarded by `verifyCeoToken`, which asks for the
     role. A pinned employee id would break the moment the role moved. */
  const repo = readFileSync("lib/repositories/legacy/index.ts", "utf8");
  const start = repo.indexOf("async #resolveReviewer");
  const block = repo.slice(start, start + 1400);
  assert.match(block, /ROLE_ADMIN/);
  assert.equal(/"GR0000"/.test(block), false, "no hardcoded chief executive");
});
