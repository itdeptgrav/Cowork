import assert from "node:assert/strict";
import { test } from "node:test";

import {
  claimedPercent,
  goalPoolView,
  remainingPercent,
  taskMaxPointsFor,
  weightageRefusal,
} from "./goalPoints.ts";

/**
 * C2 · what a goal task is worth.
 *
 * The arithmetic carried from the old Cowork, where it lived inside a React
 * `useEffect` in `CreateTaskModal.jsx` and could only be checked by opening the
 * form. Two decisions were taken while carrying it, and both are held here:
 * every goal task scores C2 (no Gold flag), and node weights are typed rather
 * than distributed by a 40%-final formula.
 */

test("a share of the pool is worth that share of the points", () => {
  assert.equal(taskMaxPointsFor(20, 200), 40);
  assert.equal(taskMaxPointsFor(50, 200), 100);
  assert.equal(taskMaxPointsFor(100, 200), 200, "the whole pool");
});

test("the figure is rounded to what the engine stores", () => {
  /* A third of a 100-point pool is 33.333…, and the engine keeps two places.
     A figure shown to more places than it is stored to is a figure that stops
     matching the moment it is written down. */
  assert.equal(taskMaxPointsFor(33.333, 100), 33.33);
});

test("nothing sensible produces nothing, rather than a wrong number", () => {
  for (const [w, g] of [
    [0, 200],
    [-5, 200],
    [20, 0],
    [20, -1],
    [Number.NaN, 200],
    [20, Number.NaN],
  ] as const) {
    assert.equal(taskMaxPointsFor(w, g), 0, `${w}% of ${g}`);
  }
});

/* ── What is left of the pool ─────────────────────────────────────────────── */

test("the claimed share is the sum of the live goals", () => {
  assert.equal(
    claimedPercent([
      { weightagePercent: 20 },
      { weightagePercent: 30 },
      { weightagePercent: 12.5 },
    ]),
    62.5,
  );
});

test("a goal with no usable share claims nothing", () => {
  assert.equal(
    claimedPercent([
      { weightagePercent: 20 },
      { weightagePercent: 0 },
      { weightagePercent: Number.NaN },
    ]),
    20,
  );
});

test("the remainder never goes below zero", () => {
  assert.equal(remainingPercent(62.5), 37.5);
  assert.equal(remainingPercent(100), 0);
  assert.equal(
    remainingPercent(140),
    0,
    "an overcommitted pool reports nothing left, not a negative allowance",
  );
});

/* ── The refusal, which is the whole point ────────────────────────────────── */

test("a share that fits is allowed", () => {
  assert.equal(
    weightageRefusal({
      weightagePercent: 20,
      remainingPercent: 40,
      globalMaxPoints: 200,
    }),
    null,
  );
});

test("a share larger than what is left is refused, and says how much is left", () => {
  /* Named, not clamped. Silently reducing it is how somebody agrees a goal
     worth forty points and finds it scoring twelve. */
  const refusal = weightageRefusal({
    weightagePercent: 60,
    remainingPercent: 40,
    globalMaxPoints: 200,
  });
  assert.match(refusal ?? "", /40%/, "the refusal does not say what is left");
  assert.match(refusal ?? "", /60%/, "the refusal does not say what was asked");
});

test("taking exactly what is left is allowed", () => {
  assert.equal(
    weightageRefusal({
      weightagePercent: 40,
      remainingPercent: 40,
      globalMaxPoints: 200,
    }),
    null,
  );
});

test("a company with no C2 pool says so, rather than refusing the number", () => {
  /* The distinction matters: the person typing has done nothing wrong, and the
     fix is somebody else's — an administrator setting the total. */
  const refusal = weightageRefusal({
    weightagePercent: 20,
    remainingPercent: 100,
    globalMaxPoints: 0,
  });
  assert.match(refusal ?? "", /administrator/i);
});

test("zero, negative and absent shares are refused", () => {
  for (const w of [0, -5, Number.NaN]) {
    assert.ok(
      weightageRefusal({
        weightagePercent: w,
        remainingPercent: 100,
        globalMaxPoints: 200,
      }),
      `${w} was allowed`,
    );
  }
});

test("more than the whole pool is refused as its own case", () => {
  const refusal = weightageRefusal({
    weightagePercent: 140,
    remainingPercent: 100,
    globalMaxPoints: 200,
  });
  assert.match(refusal ?? "", /whole year/i);
});

/* ── What the form renders ────────────────────────────────────────────────── */

test("the form view carries the figure and the refusal together", () => {
  const ok = goalPoolView({
    weightagePercent: 20,
    globalMaxPoints: 200,
    remainingPercent: 40,
  });
  assert.equal(ok.taskMaxPoints, 40);
  assert.equal(ok.refusal, null);

  const tooBig = goalPoolView({
    weightagePercent: 60,
    globalMaxPoints: 200,
    remainingPercent: 40,
  });
  assert.equal(
    tooBig.taskMaxPoints,
    120,
    "the figure is still computed, so the reader sees what they asked for",
  );
  assert.ok(tooBig.refusal, "and is told it cannot be had");
});
