import assert from "node:assert/strict";
import { test } from "node:test";
import { adjustFormula, shiftReference } from "@/lib/spreadsheet/formula/references";

test("copy adjusts a relative reference (=A1*2 down one row → =A2*2)", () => {
  // B1 → B2 is a delta of one row, zero columns.
  assert.equal(adjustFormula("=A1*2", 1, 0), "=A2*2");
});

test("copy adjusts across rows and columns together", () => {
  // =A1+B1 moved two rows down and one column right.
  assert.equal(adjustFormula("=A1+B1", 2, 1), "=B3+C3");
});

test("the four $-anchor shapes shift independently (requirement 8)", () => {
  const d = { row: 1, col: 1 }; // one row down, one column right
  assert.equal(adjustFormula("=A1", d.row, d.col), "=B2", "relative both → both shift");
  assert.equal(adjustFormula("=$A$1", d.row, d.col), "=$A$1", "absolute both → neither");
  assert.equal(adjustFormula("=A$1", d.row, d.col), "=B$1", "row anchored → only column");
  assert.equal(adjustFormula("=$A1", d.row, d.col), "=$A2", "column anchored → only row");
});

test("shiftReference honours each anchor on its own", () => {
  assert.equal(shiftReference("A1", 3, 4), "E4");
  assert.equal(shiftReference("$A$1", 3, 4), "$A$1");
  assert.equal(shiftReference("A$1", 3, 4), "E$1");
  assert.equal(shiftReference("$A1", 3, 4), "$A4");
});

test("only references change — operators, numbers, functions, strings pass through", () => {
  assert.equal(adjustFormula('=SUM(A1:A3)+"x"', 1, 0), '=SUM(A2:A4)+"x"');
  assert.equal(adjustFormula("=-A1^2", 0, 1), "=-B1^2");
});

test("a range's endpoints both shift", () => {
  assert.equal(adjustFormula("=SUM(A1:B2)", 5, 0), "=SUM(A6:B7)");
});

test("a zero delta, a non-formula, or an untokenizable formula is returned untouched", () => {
  assert.equal(adjustFormula("=A1*2", 0, 0), "=A1*2");
  assert.equal(adjustFormula("hello", 1, 1), "hello");
  // A stray character the tokenizer rejects → the formula is left exactly as written.
  assert.equal(adjustFormula("=A1@", 1, 0), "=A1@");
});

test("a relative component clamps at the sheet edge rather than going negative", () => {
  // A1 moved up a row cannot leave row 1.
  assert.equal(adjustFormula("=A1", -5, 0), "=A1");
});
