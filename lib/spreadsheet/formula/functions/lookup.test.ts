import assert from "node:assert/strict";
import { test } from "node:test";
import { evalWith } from "./_harness";

/* A little table:  A: key, B: value.
   A1..A4 = 10,20,30,40 ; B1..B4 = ten,twenty,thirty,forty. */
const TABLE = {
  A1: "10", A2: "20", A3: "30", A4: "40",
  B1: "ten", B2: "twenty", B3: "thirty", B4: "forty",
};

test("MATCH: exact and approximate", () => {
  assert.equal(evalWith("=MATCH(30,A1:A4,0)", TABLE), "3"); // exact
  assert.equal(evalWith("=MATCH(25,A1:A4,1)", TABLE), "2"); // largest ≤ 25 → 20 at #2
  assert.equal(evalWith("=MATCH(99,A1:A4,0)", TABLE), "#N/A");
});

test("INDEX by position and by (row,col)", () => {
  assert.equal(evalWith("=INDEX(B1:B4,3)", TABLE), "thirty"); // 1-D position
  assert.equal(evalWith("=INDEX(A1:B4,2,2)", TABLE), "twenty"); // row 2, col 2
  assert.equal(evalWith("=INDEX(A1:B4,9,1)", TABLE), "#REF!"); // out of bounds
});

test("INDEX + MATCH together", () => {
  assert.equal(evalWith("=INDEX(B1:B4,MATCH(40,A1:A4,0))", TABLE), "forty");
});

test("VLOOKUP exact and approximate", () => {
  assert.equal(evalWith("=VLOOKUP(30,A1:B4,2,FALSE)", TABLE), "thirty");
  assert.equal(evalWith("=VLOOKUP(25,A1:B4,2,TRUE)", TABLE), "twenty"); // approx → 20's row
  assert.equal(evalWith("=VLOOKUP(99,A1:B4,2,FALSE)", TABLE), "#N/A");
  assert.equal(evalWith("=VLOOKUP(10,A1:B4,5,FALSE)", TABLE), "#REF!"); // col out of range
});

test("HLOOKUP searches the first row", () => {
  const cells = { A1: "x", B1: "y", C1: "z", A2: "1", B2: "2", C2: "3" };
  assert.equal(evalWith('=HLOOKUP("y",A1:C2,2,FALSE)', cells), "2");
});

test("XLOOKUP: exact, if-not-found, and wildcard mode", () => {
  assert.equal(evalWith("=XLOOKUP(20,A1:A4,B1:B4)", TABLE), "twenty");
  assert.equal(evalWith('=XLOOKUP(99,A1:A4,B1:B4,"missing")', TABLE), "missing");
  const words = { A1: "cat", A2: "car", A3: "dog", B1: "1", B2: "2", B3: "3" };
  assert.equal(evalWith('=XLOOKUP("ca*",A1:A3,B1:B3,"-",2)', words), "1"); // wildcard → first "ca…"
});
