import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allOutputsApproved,
  hasStartableOutput,
  isOutputWorkable,
  isTaskBlocked,
  mayReview,
  outputState,
  reworkShare,
  taskHasWorkableOutput,
  type OutputSubmissionFact,
} from "./outputs.ts";

const GOP = "out-content-gopalpur";
const PURI = "out-content-puri";

function sub(
  over: Partial<OutputSubmissionFact> & Pick<OutputSubmissionFact, "outputId">,
): OutputSubmissionFact {
  return { attempt: 1, decision: null, isFinal: true, ...over };
}

/* ── one output's state ─────────────────────────────────────────────────── */

test("an output nobody has submitted has not started", () => {
  assert.equal(outputState(GOP, []), "not_started");
});

test("submitted and undecided is in review", () => {
  assert.equal(outputState(GOP, [sub({ outputId: GOP })]), "in_review");
});

test("a final-stage approval approves it", () => {
  assert.equal(
    outputState(GOP, [sub({ outputId: GOP, decision: "approved" })]),
    "approved",
  );
});

test("a MID-chain approval does not — it is still in review", () => {
  /**
   * The case that would hand work downstream before anybody had finished
   * checking it. Stage 1 of a two-stage chain approving means it has moved to
   * the second reviewer, not that it is delivered.
   */
  assert.equal(
    outputState(GOP, [
      sub({ outputId: GOP, decision: "approved", isFinal: false }),
    ]),
    "in_review",
  );
});

test("rework and rejection are reported as themselves", () => {
  assert.equal(
    outputState(GOP, [sub({ outputId: GOP, decision: "rework" })]),
    "rework",
  );
  assert.equal(
    outputState(GOP, [sub({ outputId: GOP, decision: "rejected" })]),
    "rejected",
  );
});

test("the LATEST attempt decides, not the first", () => {
  /* Returned once, then resubmitted. Reporting the older decision would show
     somebody's corrected work as still wrong. */
  assert.equal(
    outputState(GOP, [
      sub({ outputId: GOP, attempt: 1, decision: "rework" }),
      sub({ outputId: GOP, attempt: 2, decision: null }),
    ]),
    "in_review",
  );
});

test("another output's submissions never count toward this one", () => {
  /* The whole reason `outputId` exists. Before it, one task's submissions
     shared a single `attempt` sequence and could not be told apart. */
  assert.equal(
    outputState(GOP, [sub({ outputId: PURI, decision: "approved" })]),
    "not_started",
  );
});

test("a task-level submission is not an output's submission", () => {
  assert.equal(
    outputState(GOP, [sub({ outputId: null, decision: "approved" })]),
    "not_started",
  );
});

/* ── workability ────────────────────────────────────────────────────────── */

test("an output needing nothing is always workable", () => {
  assert.equal(isOutputWorkable({ needsOutputIds: [] }, new Set()), true);
});

test("an output is workable once every input is approved", () => {
  assert.equal(
    isOutputWorkable({ needsOutputIds: [GOP] }, new Set([GOP])),
    true,
  );
  assert.equal(isOutputWorkable({ needsOutputIds: [GOP] }, new Set()), false);
});

test("every input must be approved, not just one", () => {
  assert.equal(
    isOutputWorkable({ needsOutputIds: [GOP, PURI] }, new Set([GOP])),
    false,
  );
});

test("an unknown input id is not approved", () => {
  /* Releasing on missing data would start a clock against work whose input may
     not exist at all. */
  assert.equal(
    isOutputWorkable({ needsOutputIds: ["gone"] }, new Set([GOP])),
    false,
  );
});

/* ── what it means for the task ─────────────────────────────────────────── */

test("a task with no outputs is workable — every task in the product today", () => {
  assert.equal(taskHasWorkableOutput([], new Set()), true);
});

test("a task is workable while ANY output is", () => {
  /**
   * Umang's case. Three of her four outputs are waiting on Anant; Gopalpur is
   * ready. Dropping her whole task because one input is missing would be wrong
   * in the ordinary case rather than the exception.
   */
  const outputs = [
    { needsOutputIds: [GOP] },
    { needsOutputIds: [PURI] },
    { needsOutputIds: ["out-content-konark"] },
  ];
  assert.equal(taskHasWorkableOutput(outputs, new Set([GOP])), true);
});

test("a task drops out only when every output is waiting", () => {
  const outputs = [{ needsOutputIds: [GOP] }, { needsOutputIds: [PURI] }];
  assert.equal(taskHasWorkableOutput(outputs, new Set()), false);
});

/* ── completion ─────────────────────────────────────────────────────────── */

test("a task with outputs finishes when they are all approved", () => {
  const outputs = [{ id: GOP }, { id: PURI }];
  const subs = [
    sub({ outputId: GOP, decision: "approved" }),
    sub({ outputId: PURI, decision: "approved" }),
  ];
  assert.equal(allOutputsApproved(outputs, subs), true);
});

test("one output short is not finished", () => {
  const outputs = [{ id: GOP }, { id: PURI }];
  assert.equal(
    allOutputsApproved(outputs, [sub({ outputId: GOP, decision: "approved" })]),
    false,
  );
});

test("a task with NO outputs never completes this way", () => {
  /* It finishes the way it always has — its own submission and review. An
     empty list must not read as "everything is approved". */
  assert.equal(allOutputsApproved([], []), false);
});

/* ── scoring ────────────────────────────────────────────────────────────── */

test("one output, one return — the full deduction, exactly as today", () => {
  assert.equal(reworkShare(1, 1), 1);
});

test("one of four returned costs a quarter", () => {
  assert.equal(reworkShare(1, 4), 0.25);
});

test("all four returned costs the full deduction", () => {
  assert.equal(reworkShare(4, 4), 1);
});

test("declaring more outputs cannot inflate the weight", () => {
  /**
   * The inequality this formula exists to prevent. Ten trivial outputs would
   * otherwise carry ten times the weight of one hard one, set by whoever wrote
   * the list — and nobody would have cheated to get there.
   */
  assert.equal(reworkShare(1, 10), 0.1);
  assert.equal(reworkShare(10, 10), 1);
});

test("a task with no outputs takes the rule unscaled", () => {
  assert.equal(reworkShare(1, 0), 1);
});

test("more returns than outputs cannot exceed the full deduction", () => {
  /* Defensive: a caller counting returns across attempts could pass a bigger
     number, and a deduction above 100% of the rule is not a thing. */
  assert.equal(reworkShare(7, 4), 1);
});

/* ── the guard ──────────────────────────────────────────────────────────── */

test("a task-level submission still needs the task to be in review", () => {
  assert.equal(mayReview({ outputId: null, taskStatus: "in_review" }), true);
  assert.equal(mayReview({ outputId: null, taskStatus: "in_progress" }), false);
});

test("an output submission may be reviewed while the task runs on", () => {
  /**
   * Anant is writing Puri while Gopalpur is being read. Requiring `in_review`
   * here would refuse every per-output review ever raised.
   */
  assert.equal(mayReview({ outputId: GOP, taskStatus: "in_progress" }), true);
});

/* ── The view's own form of the same question ─────────────────────────────── */

test("isTaskBlocked agrees with hasStartableOutput, from resolved view data", () => {
  /**
   * Two shapes, one rule. `hasStartableOutput` reads raw outputs plus an
   * approved-id set, because the queue and the timer hold documents; a rendered
   * view has already resolved both onto each output. They must never disagree,
   * so this asserts the equivalence rather than trusting it.
   */
  const cases = [
    { workable: true, state: "not_started" as const, startable: true },
    { workable: true, state: "rework" as const, startable: true },
    { workable: true, state: "in_review" as const, startable: false },
    { workable: true, state: "approved" as const, startable: false },
    { workable: false, state: "not_started" as const, startable: false },
  ];
  for (const c of cases) {
    const viaView = !isTaskBlocked([{ isWorkable: c.workable, state: c.state }]);
    const viaDocs = hasStartableOutput({
      outputs: [{ id: "o", needsOutputIds: c.workable ? [] : ["missing"] }],
      approvedOutputIds: new Set<string>(),
      stateOf: () => c.state,
    });
    assert.equal(viaView, c.startable, `view form disagreed for ${c.state}/${c.workable}`);
    assert.equal(viaDocs, c.startable, `document form disagreed for ${c.state}/${c.workable}`);
  }
});

test("a task with no outputs is never blocked", () => {
  /* Every task that predates the feature. */
  assert.equal(isTaskBlocked([]), false);
});

test("one startable output is enough — the rest may all be waiting", () => {
  assert.equal(
    isTaskBlocked([
      { isWorkable: false, state: "not_started" },
      { isWorkable: true, state: "not_started" },
      { isWorkable: false, state: "not_started" },
    ]),
    false,
  );
});

test("submitted-and-waiting is not startable, so a task of those is blocked", () => {
  /* The case that once left a task at P1 beside a row reading "Waiting on
     Puri pg": its inputs had landed, but the work was already handed over. */
  assert.equal(
    isTaskBlocked([
      { isWorkable: true, state: "in_review" },
      { isWorkable: false, state: "not_started" },
    ]),
    true,
  );
});
