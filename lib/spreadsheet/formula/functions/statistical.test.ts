import assert from "node:assert/strict";
import { test } from "node:test";
import { evalWith } from "./_harness";

const COL = { A1: "1", A2: "2", A3: "2", A4: "3", A5: "10" };

test("AVERAGE / COUNT / COUNTA", () => {
  assert.equal(evalWith("=AVERAGE(A1:A5)", COL), "3.6");
  assert.equal(evalWith("=COUNT(A1:A5)", COL), "5");
  assert.equal(evalWith("=COUNTA(A1:A3)", { A1: "x", A3: "y" }), "2"); // A2 blank
});

test("MEDIAN / MODE", () => {
  assert.equal(evalWith("=MEDIAN(A1:A5)", COL), "2"); // sorted 1,2,2,3,10 → 2
  assert.equal(evalWith("=MEDIAN(A1:A4)", { A1: "1", A2: "2", A3: "3", A4: "4" }), "2.5");
  assert.equal(evalWith("=MODE(A1:A5)", COL), "2");
  assert.equal(evalWith("=MODE(A1:A3)", { A1: "1", A2: "2", A3: "3" }), "#N/A");
});

test("VAR / STDEV (sample, n−1)", () => {
  const cells = { A1: "2", A2: "4", A3: "6" };
  assert.equal(evalWith("=VAR(A1:A3)", cells), "4"); // mean 4, ss 8, /2
  assert.equal(evalWith("=STDEV(A1:A3)", cells), "2");
  assert.equal(evalWith("=STDEV(A1:A1)", { A1: "5" }), "#DIV/0!"); // < 2 values
});

test("COUNTIF / SUMIF / AVERAGEIF with a criterion", () => {
  assert.equal(evalWith('=COUNTIF(A1:A5,">2")', COL), "2"); // 3 and 10
  assert.equal(evalWith('=COUNTIF(A1:A5,2)', COL), "2");
  assert.equal(evalWith('=SUMIF(A1:A5,">2")', COL), "13"); // 3 + 10
  assert.equal(evalWith('=AVERAGEIF(A1:A5,">=2")', COL), "4.25"); // (2+2+3+10)/4
});

test("SUMIF with a separate sum range", () => {
  const cells = { A1: "x", A2: "y", A3: "x", B1: "10", B2: "20", B3: "30" };
  assert.equal(evalWith('=SUMIF(A1:A3,"x",B1:B3)', cells), "40"); // rows 1 and 3
});

test("COUNTIFS / SUMIFS / AVERAGEIFS over parallel ranges", () => {
  const cells = {
    A1: "apple", A2: "apple", A3: "pear",
    B1: "5", B2: "15", B3: "20",
  };
  assert.equal(evalWith('=COUNTIFS(A1:A3,"apple",B1:B3,">10")', cells), "1"); // apple & >10 → row 2
  assert.equal(evalWith('=SUMIFS(B1:B3,A1:A3,"apple")', cells), "20"); // 5 + 15
  assert.equal(evalWith('=AVERAGEIFS(B1:B3,A1:A3,"apple")', cells), "10");
});

test("wildcard criteria (* and ?)", () => {
  const cells = { A1: "cat", A2: "car", A3: "dog" };
  assert.equal(evalWith('=COUNTIF(A1:A3,"ca*")', cells), "2");
  assert.equal(evalWith('=COUNTIF(A1:A3,"c?t")', cells), "1");
});
