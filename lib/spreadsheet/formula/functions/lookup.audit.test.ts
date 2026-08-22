/**
 * Adversarial audit of the lookup functions against Google Sheets / Excel
 * semantics. Assertions state the CORRECT spreadsheet answer.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { evalWith } from "@/lib/spreadsheet/formula/functions/_harness";

/* A: sorted keys, B: labels — same table shape the base tests use. */
const TABLE = {
  A1: "10", A2: "20", A3: "30", A4: "40",
  B1: "ten", B2: "twenty", B3: "thirty", B4: "forty",
};

test("MATCH: case-insensitive text, no cross-type matches, defaults", () => {
  assert.equal(evalWith('=MATCH("TEN",B1:B4,0)', TABLE), "1"); // case-insensitive
  assert.equal(evalWith('=MATCH("10",A1:A4,0)', TABLE), "#N/A"); // text never equals a number
  assert.equal(evalWith("=MATCH(25,A1:A4)", TABLE), "2"); // type omitted -> 1
  assert.equal(evalWith("=MATCH(5,A1:A4,1)", TABLE), "#N/A"); // below all keys
  // Descending data with type -1: smallest value >= lookup.
  assert.equal(
    evalWith("=MATCH(25,A1:A4,-1)", { A1: "40", A2: "30", A3: "20", A4: "10" }),
    "2",
  );
});

test("MATCH approximate returns the LAST of equal keys (sorted duplicates)", () => {
  // Sheets/Excel: with {10,20,20,30} and lookup 20, match_type 1 lands on the
  // last equal entry - position 3.
  assert.equal(
    evalWith("=MATCH(20,A1:A4,1)", { A1: "10", A2: "20", A3: "20", A4: "30" }),
    "3",
  );
});

test("MATCH propagates an error in the match-type argument", () => {
  assert.equal(evalWith("=MATCH(10,A1:A4,1/0)", TABLE), "#DIV/0!");
});

test("INDEX: zero row or column selects a whole column or row", () => {
  assert.equal(evalWith("=INDEX(A1:B4,0,2)", TABLE), "ten"); // whole column 2, top shown
  assert.equal(evalWith("=SUM(INDEX(A1:B4,0,1))", TABLE), "100"); // column consumed by SUM
  assert.equal(evalWith("=INDEX(A1:B4,2,0)", TABLE), "20"); // whole row 2, first shown
});

test("INDEX with row 0 AND column 0 selects the whole range", () => {
  // Sheets: both indexes 0 mean the WHOLE range - the cell shows its top-left
  // value and aggregates see every cell.
  assert.equal(evalWith("=INDEX(A1:B4,0,0)", TABLE), "10");
});

test("INDEX with row 0 and the column omitted selects the whole range", () => {
  assert.equal(evalWith("=INDEX(A1:A4,0)", TABLE), "10");
});

test("INDEX with row 0 nests into aggregates", () => {
  assert.equal(evalWith("=SUM(INDEX(A1:A4,0))", TABLE), "100");
});

test("INDEX: in-bounds edges and past-the-end", () => {
  assert.equal(evalWith("=INDEX(A1:B4,5,1)", TABLE), "#REF!"); // past the end (Excel code)
  assert.equal(evalWith("=INDEX(A1:C1,2)", { A1: "x", B1: "y", C1: "z" }), "y"); // 1-row position
});

test("INDEX with a negative index is #VALUE!", () => {
  // Sheets/Excel: a NEGATIVE index is #VALUE!, not #REF!.
  assert.equal(evalWith("=INDEX(A1:B4,-1,1)", TABLE), "#VALUE!");
});

test("INDEX with a non-numeric index is #VALUE!, not a crash", () => {
  // Sheets/Excel: a non-numeric index is #VALUE! — an error value, never an
  // exception out of the engine.
  assert.equal(evalWith('=INDEX(A1:B4,"x",1)', TABLE), "#VALUE!");
});

test("VLOOKUP: exact/approximate basics and the is_sorted default", () => {
  const words = { A1: "cat", A2: "car", A3: "dog", B1: "1", B2: "2", B3: "3" };
  assert.equal(evalWith('=VLOOKUP("CAT",A1:B3,2,FALSE)', words), "1"); // case-insensitive
  assert.equal(evalWith("=VLOOKUP(25,A1:B4,2)", TABLE), "twenty"); // omitted flag -> approximate
  assert.equal(evalWith("=VLOOKUP(9,A1:B4,2,TRUE)", TABLE), "#N/A"); // below all keys
  assert.equal(evalWith("=VLOOKUP(45,A1:B4,2,TRUE)", TABLE), "forty"); // above all keys
  assert.equal(evalWith("=VLOOKUP(30,A1:B4,2,0)", TABLE), "thirty"); // 0 means exact
  assert.equal(evalWith("=VLOOKUP(10,A1:B4,0,FALSE)", TABLE), "#VALUE!"); // index < 1
});

test("VLOOKUP propagates an error in the index argument", () => {
  assert.equal(evalWith("=VLOOKUP(10,A1:B4,1/0,FALSE)", TABLE), "#DIV/0!");
});

test("VLOOKUP rejects a non-numeric index argument", () => {
  assert.equal(evalWith('=VLOOKUP(10,A1:B4,"two",FALSE)', TABLE), "#VALUE!");
});

test("HLOOKUP: approximate over the first row; row index bounds", () => {
  const cells = { A1: "10", B1: "20", C1: "30", A2: "a", B2: "b", C2: "c" };
  assert.equal(evalWith("=HLOOKUP(25,A1:C2,2,TRUE)", cells), "b");
  assert.equal(evalWith("=HLOOKUP(20,A1:C2,3,FALSE)", cells), "#REF!"); // row out of range
});

test("XLOOKUP: found-with-default, wildcard case-insensitivity, documented fallback", () => {
  assert.equal(evalWith('=XLOOKUP(20,A1:A4,B1:B4,"missing")', TABLE), "twenty"); // default unused
  assert.equal(evalWith("=XLOOKUP(99,A1:A4,B1:B4)", TABLE), "#N/A"); // no default
  const words = { A1: "cat", A2: "car", A3: "dog", B1: "1", B2: "2", B3: "3" };
  assert.equal(evalWith('=XLOOKUP("CA?",A1:A3,B1:B3,"-",2)', words), "1"); // wildcards ignore case
  assert.equal(evalWith('=XLOOKUP("z*",A1:A3,B1:B3,"none",2)', words), "none");
  // Documented divergence (lookup.ts header): approximate match modes fall back
  // to EXACT, so mode -1 misses 25 and takes the if_not_found value where
  // Sheets would return "twenty".
  assert.equal(evalWith('=XLOOKUP(25,A1:A4,B1:B4,"nf",-1)', TABLE), "nf");
});
