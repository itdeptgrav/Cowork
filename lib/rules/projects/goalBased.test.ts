import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGoalBased,
  formatGoalTarget,
  readGoalBased,
  GOAL_TYPE_LABEL,
} from "./goalBased.ts";
import type { GoalBasedConfig } from "@/lib/domain/projects";

/**
 * "Taskgoal" is a descriptive marker, and these tests hold the things that make
 * it safe: it is null unless a real objective was given, it fits ANY goal type
 * (not only a numeric target), and it never touches the C2 goal task. There is
 * no scoring, ordering or deadline logic to test here — by design there is none.
 */

/** A full numeric config, so a test can state just the fields it cares about. */
function numeric(over: Partial<GoalBasedConfig> = {}): GoalBasedConfig {
  return {
    objective: "x",
    goalType: "numeric",
    successCriteria: null,
    currentStatus: null,
    metric: null,
    unit: null,
    targetValue: null,
    startValue: null,
    ...over,
  };
}

test("buildGoalBased requires an objective", () => {
  assert.equal(buildGoalBased({ objective: "" }), null);
  assert.equal(buildGoalBased({ objective: "   " }), null);
  assert.equal(
    buildGoalBased({
      objective: "",
      metric: "users",
      targetValue: "500",
    }),
    null,
  );
});

test("buildGoalBased defaults to a numeric goal and keeps its numbers", () => {
  const g = buildGoalBased({
    objective: "  Grow active users  ",
    metric: "  users  ",
    unit: "  monthly  ",
    targetValue: "500",
    startValue: "120",
  });
  assert.deepEqual(
    g,
    numeric({
      objective: "Grow active users",
      metric: "users",
      unit: "monthly",
      targetValue: 500,
      startValue: 120,
    }),
  );
});

test("a non-numeric goal drops the numeric fields, whatever was typed", () => {
  /* The form hides them for these types, but a value typed before switching
     type must not sneak through — the rule is the backstop. */
  const g = buildGoalBased({
    objective: "Launch the new website",
    goalType: "milestone",
    successCriteria: "Signed off and live",
    currentStatus: "In staging",
    metric: "users",
    unit: "monthly",
    targetValue: "500",
    startValue: "120",
  });
  assert.deepEqual(g, {
    objective: "Launch the new website",
    goalType: "milestone",
    successCriteria: "Signed off and live",
    currentStatus: "In staging",
    metric: null,
    unit: null,
    targetValue: null,
    startValue: null,
  });
});

test("buildGoalBased carries success criteria and status for any type", () => {
  const g = buildGoalBased({
    objective: "Improve onboarding",
    goalType: "qualitative",
    successCriteria: "  New hires productive in a week  ",
    currentStatus: "  Two weeks today  ",
  });
  assert.equal(g?.goalType, "qualitative");
  assert.equal(g?.successCriteria, "New hires productive in a week");
  assert.equal(g?.currentStatus, "Two weeks today");
});

test("an unknown goal type falls back to numeric", () => {
  assert.equal(buildGoalBased({ objective: "x", goalType: "nonsense" })?.goalType, "numeric");
  assert.equal(buildGoalBased({ objective: "x" })?.goalType, "numeric");
});

test("buildGoalBased treats blanks and bad numbers as not-set, never as errors", () => {
  const g = buildGoalBased({
    objective: "Ship the thing",
    goalType: "numeric",
    metric: "",
    unit: "",
    targetValue: "",
    startValue: "not a number",
  });
  assert.deepEqual(g, numeric({ objective: "Ship the thing" }));
});

test("buildGoalBased rejects negative numbers, and accepts zero", () => {
  const neg = buildGoalBased({ objective: "x", targetValue: -5, startValue: -1 });
  assert.equal(neg?.targetValue, null);
  assert.equal(neg?.startValue, null);
  const zero = buildGoalBased({ objective: "x", startValue: 0, targetValue: 0 });
  assert.equal(zero?.startValue, 0);
  assert.equal(zero?.targetValue, 0);
});

test("formatGoalTarget reads both, target-only, or nothing", () => {
  assert.equal(
    formatGoalTarget(numeric({ metric: "users", unit: "monthly", startValue: 120, targetValue: 500 })),
    "120 → 500 monthly users",
  );
  assert.equal(
    formatGoalTarget(numeric({ metric: "users", targetValue: 500 })),
    "Target 500 users",
  );
  // No target number → nothing to show; the objective line carries it.
  assert.equal(formatGoalTarget(numeric({ metric: "users", startValue: 120 })), null);
  assert.equal(formatGoalTarget(null), null);
  assert.equal(formatGoalTarget(undefined), null);
});

test("readGoalBased round-trips a stored record and drops malformed ones", () => {
  const stored = numeric({
    objective: "Grow active users",
    metric: "users",
    unit: "monthly",
    targetValue: 500,
    startValue: 120,
  });
  assert.deepEqual(readGoalBased(stored), stored);

  assert.equal(readGoalBased(null), null);
  assert.equal(readGoalBased("nope"), null);
  assert.equal(readGoalBased({ metric: "users" }), null);
  assert.equal(readGoalBased({ objective: "" }), null);
});

test("readGoalBased defaults a record with no type to numeric — the old shape", () => {
  /* Every Taskgoal stored before goal types existed had only the numeric
     fields. It must read back as a numeric goal with its numbers intact. */
  assert.deepEqual(
    readGoalBased({ objective: "Old goal", metric: "users", targetValue: 500 }),
    numeric({ objective: "Old goal", metric: "users", targetValue: 500 }),
  );
});

test("readGoalBased keeps a non-numeric record's words and drops stray numbers", () => {
  assert.deepEqual(
    readGoalBased({
      objective: "Launch v2",
      goalType: "milestone",
      successCriteria: "Live in prod",
      currentStatus: "Beta",
      // A stray number on a non-numeric record is ignored on read.
      targetValue: 99,
    }),
    {
      objective: "Launch v2",
      goalType: "milestone",
      successCriteria: "Live in prod",
      currentStatus: "Beta",
      metric: null,
      unit: null,
      targetValue: null,
      startValue: null,
    },
  );
});

test("every goal type has a label", () => {
  assert.deepEqual(Object.keys(GOAL_TYPE_LABEL).sort(), [
    "milestone",
    "numeric",
    "other",
    "qualitative",
  ]);
  for (const label of Object.values(GOAL_TYPE_LABEL)) {
    assert.ok(label.length > 0);
  }
});
