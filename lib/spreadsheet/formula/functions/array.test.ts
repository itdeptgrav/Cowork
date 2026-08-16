import assert from "node:assert/strict";
import { test } from "node:test";
import { evalWith } from "./_harness";

const COL = { A1: "3", A2: "1", A3: "3", A4: "2", A5: "1" };

test("UNIQUE shows its top-left (no spill), and flattens when aggregated", () => {
  // A cell shows the first unique value; the array itself does not spill.
  assert.equal(evalWith("=UNIQUE(A1:A5)", COL), "3");
  // Nested, the whole unique set is available: unique of {3,1,2} = 6.
  assert.equal(evalWith("=SUM(UNIQUE(A1:A5))", COL), "6");
});

test("UNIQUE with exactly-once keeps values that appear a single time", () => {
  // {3,1,3,2,1}: only 2 appears exactly once.
  assert.equal(evalWith("=SUM(UNIQUE(A1:A5,FALSE,TRUE))", COL), "2");
});

test("FILTER keeps matching rows; ifEmpty when none", () => {
  // `include` is a RANGE of booleans (a helper column) — inline array
  // comparisons like `A1:A5>100` are NOT supported (no array broadcasting).
  const cells = { ...COL, B1: "1", B2: "0", B3: "1", B4: "0", B5: "1" };
  // Keep A where B is truthy → A1(3), A3(3), A5(1) → sum 7, first shown is 3.
  assert.equal(evalWith("=FILTER(A1:A5,B1:B5)", cells), "3");
  assert.equal(evalWith("=SUM(FILTER(A1:A5,B1:B5))", cells), "7");
  // No rows kept → the ifEmpty value.
  const none = { A1: "1", A2: "2", A3: "3", B1: "0", B2: "0", B3: "0" };
  assert.equal(evalWith('=FILTER(A1:A3,B1:B3,"none")', none), "none");
});

test("SORT orders rows ascending or descending", () => {
  // Ascending → first is the smallest (1); descending → largest (3).
  assert.equal(evalWith("=SORT(A1:A5)", COL), "1");
  assert.equal(evalWith("=SORT(A1:A5,1,-1)", COL), "3");
});

test("SUM over a SORTed range equals the plain sum (order-independent check)", () => {
  assert.equal(evalWith("=SUM(SORT(A1:A5))", COL), "10");
});
