/**
 * Adversarial audit of the array functions (UNIQUE / FILTER / SORT) against
 * Google Sheets semantics. Spilling is a documented non-feature: a cell shows
 * an array's top-left element, and aggregates flatten it. Assertions state the
 * CORRECT spreadsheet answer.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { evalWith } from "@/lib/spreadsheet/formula/functions/_harness";

const COL = { A1: "3", A2: "1", A3: "3", A4: "2", A5: "1" };

test("UNIQUE: case-insensitive for text, type-strict for numbers vs numeric text", () => {
  // "Apple" and "APPLE" are ONE value to UNIQUE (Sheets compares text
  // case-insensitively), so the result has a single row and INDEX row 2 is out
  // of range. (COUNTA cannot probe this - see stat-counta-array.)
  assert.equal(
    evalWith("=INDEX(UNIQUE(A1:A2),2,1)", { A1: '="Apple"', A2: '="APPLE"' }),
    "#REF!",
  );
  // The number 5 and the string "5" stay distinct: a second row exists.
  assert.equal(evalWith("=INDEX(UNIQUE(A1:A2),2,1)", { A1: "5", A2: '="5"' }), "5");
});

test("UNIQUE: blanks, multi-column rows, exactly-once with no survivors", () => {
  assert.equal(evalWith("=SUM(UNIQUE(A1:A3))", { A1: "2", A3: "2" }), "2"); // one 2 + one blank
  // Rows (1,2),(1,2),(1,3) -> two unique ROWS -> sum 1+2+1+3.
  assert.equal(
    evalWith("=SUM(UNIQUE(A1:B3))", { A1: "1", B1: "2", A2: "1", B2: "2", A3: "1", B3: "3" }),
    "7",
  );
  // Every row repeats, so exactly-once leaves nothing: #N/A, as Sheets reports.
  assert.equal(evalWith("=UNIQUE(A1:A2,FALSE,TRUE)", { A1: "1", A2: "1" }), "#N/A");
});

test("FILTER: numeric conditions, text conditions error, empty result", () => {
  const cells = { A1: "1", A2: "2", A3: "4", B1: "0", B2: "2", B3: "0" };
  assert.equal(evalWith("=SUM(FILTER(A1:A3,B1:B3))", cells), "2"); // nonzero number is truthy
  assert.equal(
    evalWith("=FILTER(A1:A2,B1:B2)", { A1: "1", A2: "2", B1: "x", B2: "1" }),
    "#VALUE!", // text is not a boolean
  );
  assert.equal(
    evalWith("=FILTER(A1:A2,B1:B2)", { A1: "1", A2: "2", B1: "0", B2: "0" }),
    "#N/A", // nothing matched, no if_empty
  );
  assert.equal(
    evalWith("=FILTER(A1:A2,B1:B2,1/0)", { A1: "1", A2: "2", B1: "0", B2: "0" }),
    "#DIV/0!", // if_empty is evaluated when needed, errors included
  );
});

test("FILTER rejects a condition range of a different height", () => {
  // Sheets: FILTER(A1:A3, B1:B2) is "mismatched range sizes" -> #VALUE!.
  assert.equal(
    evalWith("=FILTER(A1:A3,B1:B2)", { A1: "1", A2: "2", A3: "4", B1: "1", B2: "1" }),
    "#VALUE!",
  );
});

test("SORT: ascending default, multi-column key, stability, cross-type order", () => {
  assert.equal(evalWith("=SORT(A1:A5,1,TRUE)", COL), "1");
  // Sort rows by column 2: (y,1) comes first.
  const grid = { A1: "x", B1: "3", A2: "y", B2: "1", A3: "z", B3: "2" };
  assert.equal(evalWith("=SORT(A1:B3,2,TRUE)", grid), "y");
  // Stable on ties: (c,0) first, then (b,1),(a,1) in original order.
  const ties = { A1: "b", B1: "1", A2: "a", B2: "1", A3: "c", B3: "0" };
  assert.equal(evalWith("=INDEX(SORT(A1:B3,2,TRUE),2,1)", ties), "b");
  // Numbers sort before text ascending.
  assert.equal(evalWith("=SORT(A1:A3)", { A1: '="b"', A2: "10", A3: '="a"' }), "10");
});

test("SORT: is_ascending is a BOOLEAN - FALSE must sort descending", () => {
  // Sheets: SORT(range, 1, FALSE) sorts descending, so the top value is 3.
  assert.equal(evalWith("=SORT(A1:A5,1,FALSE)", COL), "3");
});

test("SORT: a sort_index past the last column is an error", () => {
  // Sheets: SORT(A1:B2,5,TRUE) -> #VALUE! (index out of range).
  assert.equal(
    evalWith("=SORT(A1:B2,5,TRUE)", { A1: "2", B1: "x", A2: "1", B2: "y" }),
    "#VALUE!",
  );
});

test("SORT: a sort_index of 0 is an error", () => {
  assert.equal(evalWith("=SORT(A1:A2,0,TRUE)", { A1: "2", A2: "1" }), "#VALUE!");
});

test("arrays nest into aggregates", () => {
  assert.equal(evalWith("=SUM(UNIQUE(A1:A5))", COL), "6"); // {3,1,2}
  assert.equal(evalWith("=AVERAGE(UNIQUE(A1:A5))", COL), "2");
  assert.equal(evalWith("=SUM(SORT(A1:A5,1,TRUE))", COL), "10"); // order-independent
});
