import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type GoalNode,
  assignedPoints,
  goalNodeView,
  nodePointsFor,
  nodeRefusal,
  remainingPoints,
  approvalOutcome,
  reportRefusal,
  submitRefusal,
  submittedLate,
  unspentWarning,
  weightForRemaining,
} from "./goalNodes.ts";

/**
 * C2 · the roadmap's arithmetic.
 *
 * Carried from the old Cowork's node editor, where the same rules lived in a
 * `canSave` expression and an `exceedsPool` boolean that could only be checked
 * by opening a slide-over. Two decisions were taken while carrying them, and
 * both are held below: node weights are TYPED rather than distributed by the
 * 40%-final formula, and the budget guard excludes the node being edited so an
 * edit is judged on what it adds rather than on what it becomes.
 */

const POOL = 40; /* a task worth 40 points */

const node = (
  id: string,
  weightPercent: number,
  over: Partial<GoalNode> = {},
): GoalNode => ({
  id,
  heading: `Step ${id}`,
  description: "What this step involves.",
  deadline: "2026-09-01T10:00:00.000Z",
  weightPercent,
  ...over,
});

/* ── What a node is worth ─────────────────────────────────────────────────── */

test("a node is worth its share of the task's pool", () => {
  assert.equal(nodePointsFor(25, POOL), 10);
  assert.equal(nodePointsFor(50, POOL), 20);
  assert.equal(nodePointsFor(100, POOL), 40, "the whole goal");
});

test("nothing sensible is worth nothing, rather than a wrong number", () => {
  for (const [w, t] of [
    [0, POOL],
    [-10, POOL],
    [25, 0],
    [Number.NaN, POOL],
    [25, Number.NaN],
  ] as const) {
    assert.equal(nodePointsFor(w, t), 0, `${w}% of ${t}`);
  }
});

/* ── What is left ─────────────────────────────────────────────────────────── */

test("the assigned points are the sum of the nodes", () => {
  assert.equal(assignedPoints([node("a", 25), node("b", 50)], POOL), 30);
});

test("the remainder is the pool less what the nodes hold", () => {
  assert.equal(
    remainingPoints({ nodes: [node("a", 25), node("b", 50)], taskMaxPoints: POOL }),
    10,
  );
});

test("an overspent roadmap reports nothing left, never a negative allowance", () => {
  assert.equal(
    remainingPoints({
      nodes: [node("a", 80), node("b", 80)],
      taskMaxPoints: POOL,
    }),
    0,
  );
});

test("a node being EDITED is not counted against itself", () => {
  /* The rule that makes editing possible once the pool is nearly spent. The
     roadmap holds 40 of 40; raising node b from 20 to 24 must be judged on the
     4 points it adds, not on the 24 it becomes. */
  const nodes = [node("a", 50), node("b", 50)];
  assert.equal(
    remainingPoints({ nodes, taskMaxPoints: POOL }),
    0,
    "nothing is left while both are counted",
  );
  assert.equal(
    remainingPoints({ nodes, taskMaxPoints: POOL, excludeNodeId: "b" }),
    20,
    "b's own 20 points are available to b",
  );
});

/* ── The refusal ──────────────────────────────────────────────────────────── */

const base = {
  heading: "Research",
  description: "Read the brief and write up findings.",
  deadline: "2026-09-01T10:00:00.000Z",
  weightPercent: 25,
  taskMaxPoints: POOL,
  nodes: [] as GoalNode[],
};

test("a complete node that fits is allowed", () => {
  assert.equal(nodeRefusal(base), null);
});

test("every missing field is named, one at a time", () => {
  assert.match(nodeRefusal({ ...base, heading: "  " }) ?? "", /heading/i);
  assert.match(
    nodeRefusal({ ...base, description: "" }) ?? "",
    /what this step involves/i,
  );
  assert.match(nodeRefusal({ ...base, deadline: null }) ?? "", /deadline/i);
});

test("the deadline refusal says why it matters", () => {
  /* Points are earned only on time, so "give it a deadline" without the reason
     reads as bureaucracy rather than as the thing the score turns on. */
  assert.match(
    nodeRefusal({ ...base, deadline: null }) ?? "",
    /on or before/i,
  );
});

test("a share of zero or less is refused", () => {
  for (const w of [0, -5, Number.NaN]) {
    assert.ok(nodeRefusal({ ...base, weightPercent: w }), `${w} was allowed`);
  }
});

test("a share larger than what is left is refused, with both figures", () => {
  const refusal = nodeRefusal({
    ...base,
    weightPercent: 100,
    nodes: [node("a", 80)],
  });
  assert.match(refusal ?? "", /8 of this goal's 40 points/, "what is left");
  assert.match(refusal ?? "", /asks for 40/, "what was asked");
});

test("taking exactly what is left is allowed", () => {
  assert.equal(
    nodeRefusal({ ...base, weightPercent: 20, nodes: [node("a", 80)] }),
    null,
  );
});

test("a goal with no points says so, rather than blaming the share", () => {
  assert.match(
    nodeRefusal({ ...base, taskMaxPoints: 0 }) ?? "",
    /no points to share out/i,
  );
});

test("editing a node judges only what it adds", () => {
  /* The whole roadmap is spent. Editing b down is fine; editing it up beyond
     its own share is not. */
  const nodes = [node("a", 50), node("b", 50)];
  assert.equal(
    nodeRefusal({ ...base, weightPercent: 40, nodes, excludeNodeId: "b" }),
    null,
    "reducing b was refused",
  );
  assert.ok(
    nodeRefusal({ ...base, weightPercent: 60, nodes, excludeNodeId: "b" }),
    "raising b past the pool was allowed",
  );
});

/* ── What the editor shows ────────────────────────────────────────────────── */

test("the view carries the figure, the remainder and the refusal together", () => {
  const v = goalNodeView({ ...base, weightPercent: 25, nodes: [node("a", 50)] });
  assert.equal(v.points, 10);
  assert.equal(v.remaining, 20);
  assert.equal(v.refusal, null);
});

test("the figure is still computed when the node is refused", () => {
  /* So the reader sees what they asked for beside why they cannot have it. */
  const v = goalNodeView({ ...base, weightPercent: 100, nodes: [node("a", 80)] });
  assert.equal(v.points, 40);
  assert.ok(v.refusal);
});

test("the 'use the rest' share spends exactly what is left", () => {
  const nodes = [node("a", 25), node("b", 25)];
  const w = weightForRemaining({ nodes, taskMaxPoints: POOL });
  assert.equal(w, 50);
  assert.equal(
    nodeRefusal({ ...base, weightPercent: w, nodes }),
    null,
    "the share it offers is refused by the guard",
  );
  assert.equal(
    remainingPoints({ nodes: [...nodes, node("c", w)], taskMaxPoints: POOL }),
    0,
    "and leaves nothing stranded",
  );
});

test("'use the rest' on an empty roadmap offers the whole goal", () => {
  assert.equal(weightForRemaining({ nodes: [], taskMaxPoints: POOL }), 100);
});

/* ── Handing the roadmap over ─────────────────────────────────────────────── */

test("an empty roadmap cannot be handed over", () => {
  assert.match(submitRefusal([]) ?? "", /at least one step/i);
});

test("one step is enough", () => {
  /* The old Cowork's only rule, carried. Everything else a step needs is
     already guaranteed — `nodeRefusal` will not let one exist without a
     heading, a description, a deadline and a share that fits. */
  assert.equal(submitRefusal([node("a", 25)]), null);
});

test("unspent points are said, not refused", () => {
  /* A goal sharing out 30 of 40 can only ever earn 30, and that may be exactly
     what was meant. Blocking it would put the rule above the intent. */
  const nodes = [node("a", 75)];
  assert.equal(submitRefusal(nodes), null, "unspent points blocked the handover");

  const warning = unspentWarning({ nodes, taskMaxPoints: POOL });
  assert.match(warning ?? "", /10 of this goal's 40/, "what is unspent");
  assert.match(warning ?? "", /at most 30/, "what it can therefore earn");
});

test("a fully shared-out roadmap warns about nothing", () => {
  assert.equal(
    unspentWarning({ nodes: [node("a", 100)], taskMaxPoints: POOL }),
    null,
  );
});

test("an empty roadmap warns about nothing — the refusal covers it", () => {
  /* Two messages about the same missing thing is one too many. */
  assert.equal(unspentWarning({ nodes: [], taskMaxPoints: POOL }), null);
});

test("a goal with no pool warns about nothing", () => {
  assert.equal(
    unspentWarning({ nodes: [node("a", 50)], taskMaxPoints: 0 }),
    null,
  );
});

/* ── Doing the work, and being paid for it ────────────────────────────────── */

test("a report needs something written in it", () => {
  assert.match(reportRefusal("   ") ?? "", /say what you did/i);
  assert.equal(reportRefusal("Drafted the brief and sent it."), null);
});

test("on or before the deadline is not late; after it is", () => {
  const deadline = "2026-09-01T10:00:00.000Z";
  assert.equal(
    submittedLate({ submittedAt: "2026-09-01T09:59:59.000Z", deadline }),
    false,
  );
  assert.equal(
    submittedLate({ submittedAt: deadline, deadline }),
    false,
    "exactly on the deadline earns",
  );
  assert.equal(
    submittedLate({ submittedAt: "2026-09-01T10:00:01.000Z", deadline }),
    true,
  );
});

test("a step with no deadline cannot be late", () => {
  assert.equal(
    submittedLate({ submittedAt: "2026-09-01T10:00:00.000Z", deadline: null }),
    false,
  );
  assert.equal(
    submittedLate({ submittedAt: null, deadline: "2026-09-01T10:00:00.000Z" }),
    false,
  );
});

test("an unreadable date is not treated as late", () => {
  /* The safe direction. Refusing somebody's points over a timestamp nobody can
     parse would be a penalty for a data fault. */
  assert.equal(
    submittedLate({ submittedAt: "not a date", deadline: "2026-09-01T10:00:00.000Z" }),
    false,
  );
});

test("approving on time earns the points, and says so", () => {
  const o = approvalOutcome({
    submittedAt: "2026-09-01T09:00:00.000Z",
    deadline: "2026-09-01T10:00:00.000Z",
    points: 10,
  });
  assert.equal(o.earns, true);
  assert.equal(o.points, 10);
  assert.match(o.label, /earns 10 points/);
});

test("approving late earns nothing, and says that before it is done", () => {
  /* Late is zero, not reduced. The work is still approved — refusing to
     acknowledge it would be a second, different punishment. */
  const o = approvalOutcome({
    submittedAt: "2026-09-01T11:00:00.000Z",
    deadline: "2026-09-01T10:00:00.000Z",
    points: 10,
  });
  assert.equal(o.earns, false);
  assert.equal(o.points, 0);
  assert.match(o.label, /after the deadline/i);
  assert.match(o.label, /10 points are not earned/);
});

test("a step carrying no points says that rather than promising zero", () => {
  const o = approvalOutcome({
    submittedAt: "2026-09-01T09:00:00.000Z",
    deadline: "2026-09-01T10:00:00.000Z",
    points: 0,
  });
  assert.match(o.label, /carries no points/i);
  assert.equal(o.earns, false);
});
