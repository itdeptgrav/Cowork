import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula, evalWith } from "./_harness";

test("ROW and COLUMN answer for the formula's own cell, or a reference's anchor", () => {
  /* The harness evaluates in ZZ900. */
  assert.equal(evalFormula("=ROW()"), "900");
  assert.equal(evalFormula("=COLUMN()"), "702");
  assert.equal(evalFormula("=ROW(B7)"), "7");
  assert.equal(evalFormula("=COLUMN(B7)"), "2");
  assert.equal(evalFormula("=ROW(C3:D9)"), "3");
  assert.equal(evalFormula("=ROWS(C3:D9)"), "7");
  assert.equal(evalFormula("=COLUMNS(C3:D9)"), "2");
  assert.equal(evalFormula("=ROW(5)"), "#VALUE!");
});

test("CHOOSE evaluates only the chosen branch", () => {
  assert.equal(evalFormula('=CHOOSE(2, "a", "b", "c")'), "b");
  assert.equal(evalFormula('=CHOOSE(2, 1/0, "b")'), "b");
  assert.equal(evalFormula('=CHOOSE(4, "a", "b")'), "#VALUE!");
  assert.equal(evalWith("=SUM(CHOOSE(1, A1:A3, B1:B3))", { A1: "1", A2: "2", A3: "3" }), "6");
});

test("LOOKUP finds the largest entry at or below the value", () => {
  const cells = { A1: "1", A2: "5", A3: "10", B1: "low", B2: "mid", B3: "high" };
  assert.equal(evalWith("=LOOKUP(7, A1:A3, B1:B3)", cells), "mid");
  assert.equal(evalWith("=LOOKUP(10, A1:A3, B1:B3)", cells), "high");
  assert.equal(evalWith("=LOOKUP(0, A1:A3, B1:B3)", cells), "#N/A");
  assert.equal(evalWith("=LOOKUP(5, A1:B3)", cells), "mid", "an array form answers from the last column");
});

test("XMATCH by mode and direction", () => {
  const cells = { A1: "10", A2: "20", A3: "30", A4: "20" };
  assert.equal(evalWith("=XMATCH(20, A1:A4)", cells), "2");
  assert.equal(evalWith("=XMATCH(20, A1:A4, 0, -1)", cells), "4");
  assert.equal(evalWith("=XMATCH(25, A1:A4, -1)", cells), "2");
  assert.equal(evalWith("=XMATCH(25, A1:A4, 1)", cells), "3");
  assert.equal(evalWith("=XMATCH(25, A1:A4)", cells), "#N/A");
  assert.equal(evalWith('=XMATCH("b*", A1:A3, 2)', { A1: "apple", A2: "banana", A3: "cherry" }), "2");
});

test("ADDRESS builds A1 text in each anchoring style", () => {
  assert.equal(evalFormula("=ADDRESS(2, 3)"), "$C$2");
  assert.equal(evalFormula("=ADDRESS(2, 3, 2)"), "C$2");
  assert.equal(evalFormula("=ADDRESS(2, 3, 3)"), "$C2");
  assert.equal(evalFormula("=ADDRESS(2, 3, 4)"), "C2");
  assert.equal(evalFormula('=ADDRESS(2, 28, 4, TRUE, "Sales Data")'), "'Sales Data'!AB2");
  assert.equal(evalFormula("=ADDRESS(0, 1)"), "#VALUE!");
});

test("shape functions return arrays the aggregates can consume", () => {
  const grid = { A1: "1", B1: "2", A2: "3", B2: "4" };
  assert.equal(evalWith("=INDEX(TRANSPOSE(A1:B2), 1, 2)", grid), "3");
  assert.equal(evalWith("=ROWS(TRANSPOSE(A1:B2))", grid), "2");
  assert.equal(evalFormula("=SUM(SEQUENCE(4))"), "10");
  assert.equal(evalFormula("=INDEX(SEQUENCE(2, 3, 10, 5), 2, 3)"), "35");
  assert.equal(evalFormula("=SEQUENCE(0)"), "#VALUE!");
  const byCol = { A1: "b", A2: "a", A3: "c", B1: "2", B2: "1", B3: "3" };
  assert.equal(evalWith("=INDEX(SORTBY(A1:A3, B1:B3), 1, 1)", byCol), "a");
  assert.equal(evalWith("=INDEX(SORTBY(A1:A3, B1:B3, -1), 1, 1)", byCol), "c");
  assert.equal(evalWith("=ROWS(FLATTEN(A1:B2))", grid), "4");
  assert.equal(evalWith("=INDEX(FLATTEN(A1:B2), 2, 1)", grid), "2", "row-major order");
});
