import assert from "node:assert/strict";
import { test } from "node:test";
import { toC1Config, toC1Units, toC2Units } from "./scoreMap.ts";

/* Fixtures are the LIVE payloads captured at /legacy/validate on 2026-07-29,
   verbatim. Written against real responses, not route files. */

const C1_LIVE = {
  success: true, employeeId: "GR0045", quarter: 3, year: 2026,
  c1Net: null, c1Max: 40, qualityRate: null, qualityPct: null, taskCount: 0,
  rating: { label: "—", color: "#999999", bgColor: "#1E1E1E", class: "none" },
  tasks: [],
};

const C2_LIVE = {
  success: true, employeeId: "GR0045",
  c2Net: null, c2Max: 59, ptsEarned: 0, ptsPastDeadline: 0,
  hitRate: null, hitRatePct: null, taskCount: 0,
  rating: { label: "—" }, tasks: [],
};

/** Two scored tasks, in the engine's own per-task shape. */
const C1_TASKS = [
  { taskId: "T567", title: "Fabric catalogue numbering", taskScore: 0.8, deadlinesMissed: 1 },
  { taskId: "T628", title: "polo", taskScore: 1, deadlinesMissed: 0 },
];

const CONFIG_LIVE = {
  success: true, c1MaxPoints: 40, c1BaseScore: 1,
  c1DeadlineDeduction: 0.2, c1ExtensionDeduction: 0.3,
  c1ReworkDeduction: 0.2, c1RejectScore: 0.4,
};

/* ── The distinction the live payload settled ─────────────────────────────── */

test("an unscored quarter stays NULL and never becomes zero", () => {
  /* c1Net/c2Net arrive as null. Null means "not scored"; zero means "scored and
     earned nothing". On a performance screen those are different statements
     about somebody's quarter, and coercing one into the other is a false claim. */
  assert.deepEqual(toC1Units({ ...C1_LIVE, tasks: [{ taskId: "x", title: "x", taskScore: null }] })[0].earnedPoints, null);
  assert.equal(toC2Units(C2_LIVE)[0].earnedPoints, null);
});

test("a scored quarter passes the engine's figure through untouched", () => {
  assert.equal(toC1Units({ ...C1_LIVE, tasks: [{ taskId: "a", taskScore: 31.5 }] })[0].earnedPoints, 31.5);
  assert.equal(toC1Units({ ...C1_LIVE, tasks: [{ taskId: "a", taskScore: 0 }] })[0].earnedPoints, 0, "a real zero survives");
});

test("maxima come from the engine, not from a constant", () => {
  /* C2 still carries a maximum because its endpoint states one. C1's per-task
     rows do not — see "no per-task maximum is invented". */
  assert.equal(toC2Units(C2_LIVE)[0].maximumPoints, 59);
});

/* ── Period ───────────────────────────────────────────────────────────────── */

test("C1 takes its period from the response", () => {
  assert.equal(toC1Units({ ...C1_LIVE, tasks: C1_TASKS })[0].periodKey, "2026-Q3");
});

test("C2 has NO quarter or year, so its period comes from the caller", () => {
  /* Confirmed against the live payload — the C2 response carries neither.
     Inventing "the current quarter" could label a score with a period the
     engine did not put it in. */
  assert.equal("quarter" in C2_LIVE, false);
  assert.equal(toC2Units(C2_LIVE)[0].periodKey, "");
  assert.equal(toC2Units(C2_LIVE, "2026-Q3")[0].periodKey, "2026-Q3");
});

test("a C1 response missing year or quarter claims no period", () => {
  assert.equal(
    toC1Units({ ...C1_LIVE, quarter: undefined, tasks: C1_TASKS })[0].periodKey,
    "",
  );
});

/* ── Shape ────────────────────────────────────────────────────────────────── */

test("ONE UNIT PER TASK — the breakdown the engine sends is not discarded", () => {
  /* **Reverses an earlier decision, deliberately.** This used to assert one
     synthetic row, on the reasoning that splitting `c1Net` across tasks would
     mean apportioning it — arithmetic that must not happen this side of the
     engine.
     The principle is right and it does not apply: the engine sends `taskScore`
     PER TASK, so listing them reads what it computed rather than dividing
     anything. Discarding the array is what left an approved task invisible in
     its own channel — the page showed a channel total with nothing behind it. */
  const units = toC1Units({ ...C1_LIVE, tasks: C1_TASKS, taskCount: 2 });
  assert.equal(units.length, 2);
  assert.deepEqual(units.map((u) => u.sourceId), ["T567", "T628"]);
  assert.deepEqual(units.map((u) => u.earnedPoints), [0.8, 1]);
});

test("each row names the task, so a number can be traced to work", () => {
  const units = toC1Units({ ...C1_LIVE, tasks: C1_TASKS });
  assert.equal(units[0].sourceLabel, "Fabric catalogue numbering");
  assert.equal(units[1].sourceLabel, "polo");
});

test("no per-task maximum is invented", () => {
  /* `c1Max` is the CHANNEL ceiling, not a task's share of it. Using it per row
     would put a denominator against every task that the engine never stated —
     the same misleading fraction the channel header carried. */
  const units = toC1Units({ ...C1_LIVE, c1Max: 40, tasks: C1_TASKS });
  assert.ok(units.every((u) => u.maximumPoints === 0));
});

test("a rejected task is marked excluded rather than scored badly", () => {
  const units = toC1Units({
    ...C1_LIVE,
    tasks: [{ taskId: "T9", title: "nope", taskScore: 0, isRejected: true }],
  });
  assert.equal(units[0].isExcluded, true);
  assert.match(units[0].exclusionReason ?? "", /not counted/i);
});

test("a quarter with no tasks yields no rows", () => {
  /* And the channel total still reaches the header through `getScoreOverview`,
     so an empty breakdown is not an absent score. */
  assert.deepEqual(toC1Units({ ...C1_LIVE, tasks: [], taskCount: 0 }), []);
});

test("components and source types are tagged for the ledger", () => {
  const c1 = toC1Units({ ...C1_LIVE, tasks: C1_TASKS });
  assert.equal(c1[0].component, "c1");
  assert.equal(c1[0].sourceType, "task");
  assert.equal(toC2Units(C2_LIVE)[0].component, "c2");
  assert.equal(toC2Units(C2_LIVE)[0].sourceType, "goal_activity");
});

test("a response with no employeeId yields nothing", () => {
  assert.deepEqual(toC1Units({ ...C1_LIVE, employeeId: undefined, tasks: C1_TASKS }), []);
  assert.deepEqual(toC2Units({ ...C2_LIVE, employeeId: undefined }), []);
});

test("the label carries the engine's own counts", () => {
  /* C1's half of this is gone with the synthetic row: a C1 label is now the
     task's own title, asserted above. C2 still summarises, because its endpoint
     sends totals rather than a per-activity breakdown. */
  assert.match(
    toC2Units({ ...C2_LIVE, ptsEarned: 12, ptsPastDeadline: 3 })[0].sourceLabel,
    /12 point\(s\) earned, 3 past deadline/,
  );
});

/* ── Configuration ────────────────────────────────────────────────────────── */

test("the live config differs from the model defaults — read, never assumed", () => {
  /* models/BandConfig.js defaults extension to 0.1 and reject to 0.3.
     The RUNNING engine returns 0.3 and 0.4. Anything written from the model
     would have been wrong, which is why this was validated first. */
  const c = toC1Config(CONFIG_LIVE);
  assert.equal(c.maxPoints, 40);
  assert.equal(c.baseScore, 1);
  assert.equal(c.deadlineDeduction, 0.2);
  assert.equal(c.extensionDeduction, 0.3, "0.3 live, 0.1 in the model");
  assert.equal(c.reworkDeduction, 0.2);
  assert.equal(c.rejectScore, 0.4, "0.4 live, 0.3 in the model");
});

test("a missing config value is zero, not a guessed default", () => {
  assert.equal(toC1Config({}).extensionDeduction, 0);
});
