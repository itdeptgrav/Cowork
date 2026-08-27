/**
 * Adversarial audit of the statistical functions and the criteria language
 * against Google Sheets / Excel semantics. Assertions state the CORRECT
 * spreadsheet answer.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula, evalWith } from "@/lib/spreadsheet/formula/functions/_harness";

test("AVERAGE: coercion and empty input", () => {
  assert.equal(evalWith("=AVERAGE(A1:A2)", { A1: "x", A2: "y" }), "#DIV/0!"); // no numbers
  assert.equal(evalFormula("=AVERAGE(2,TRUE)"), "1.5"); // direct TRUE is 1
  assert.equal(evalWith("=AVERAGE(A1:A2)", { A1: "2", A2: "TRUE" }), "2"); // bool cell ignored
});

test("COUNT: ranges filter to numbers, direct booleans count", () => {
  // Range: number counted; text, boolean, blank not.
  assert.equal(
    evalWith("=COUNT(A1:A4)", { A1: "1", A2: "x", A3: "TRUE" }),
    "1",
  );
  assert.equal(evalFormula("=COUNT(1,TRUE)"), "2"); // direct booleans DO count
});

test("COUNT of non-numeric text is 0, not an error", () => {
  // Sheets/Excel: COUNT never errors on unparseable input - it just does not
  // count it.
  assert.equal(evalFormula('=COUNT("abc")'), "0");
});

test("COUNT ignores error cells in a range instead of propagating them", () => {
  // Sheets/Excel: error cells in a range are not counted, and do NOT propagate.
  assert.equal(evalWith("=COUNT(A1:A2)", { A1: "1", A2: "=1/0" }), "1");
});

test("COUNTA counts errors and empty strings but not blanks", () => {
  assert.equal(evalWith("=COUNTA(A1:A3)", { A1: "=1/0" }), "1"); // error counted, no propagation
  assert.equal(evalWith("=COUNTA(A1:A2)", { A1: '=""' }), "1"); // "" is non-empty
});

test("COUNTA flattens a nested array argument, like the other aggregates", () => {
  // Sheets: COUNTA over UNIQUE's result counts the elements (2 texts here).
  assert.equal(evalWith("=COUNTA(UNIQUE(A1:A2))", { A1: "x", A2: "y" }), "2");
});

test("MEDIAN of even counts; no numbers is #NUM!", () => {
  assert.equal(evalFormula("=MEDIAN(3,1,4,2)"), "2.5"); // mean of middle pair
  assert.equal(evalWith("=MEDIAN(A1:A3)", { A1: "1", A2: "x", A3: "3" }), "2"); // text ignored
  // Sheets/Excel: MEDIAN with no numeric data is #NUM!.
  assert.equal(evalWith("=MEDIAN(A1:A2)", { A1: "x", A2: "y" }), "#NUM!");
});

test("MODE: first-seen wins ties; direct args work", () => {
  assert.equal(evalFormula("=MODE(2,2,3,3)"), "2"); // first value to reach the top count
  assert.equal(evalFormula("=MODE(1,2,1)"), "1");
  assert.equal(evalFormula("=MODE(1,2,3)"), "#N/A"); // no repeats
});

test("VAR / STDEV sample statistics", () => {
  assert.equal(evalFormula("=VAR(5,5)"), "0");
  assert.equal(evalFormula("=VAR(2,4,6,8)"), "6.66666666666667"); // 20/3, displayed
  assert.equal(evalFormula("=VAR(7)"), "#DIV/0!"); // below two values
});

test("criteria: a numeric comparison must skip text cells", () => {
  // A1 holds the STRING "apple". Sheets/Excel: ">5" compares NUMBERS only, so
  // only the numeric 7 matches — no lexicographic fallback.
  assert.equal(evalWith('=COUNTIF(A1:A2,">5")', { A1: "apple", A2: "7" }), "1");
});

test("criteria: a numeric comparison must skip boolean cells", () => {
  // TRUE is not a number and ">5" must not match it.
  assert.equal(evalWith('=COUNTIF(A1:A2,">5")', { A1: "TRUE", A2: "7" }), "1");
});

test("criteria: wildcards match text only, never numbers", () => {
  // A1 is the NUMBER 12, A2 the STRING "12x". Wildcards apply to text values
  // only in Sheets/Excel, so "1*" matches just A2.
  assert.equal(evalWith('=COUNTIF(A1:A2,"1*")', { A1: "12", A2: '="12x"' }), "1");
});

test("criteria: comparison, inequality and cell-held criteria", () => {
  const nums = { A1: "1", A2: "2.5", A3: "3" };
  assert.equal(evalWith('=COUNTIF(A1:A3,"<=2.5")', nums), "2");
  assert.equal(evalWith('=COUNTIF(A1:A3,"<>x")', { A1: "x", A2: "y", A3: "z" }), "2");
  assert.equal(evalWith("=COUNTIF(A1:A3,B1)", { ...nums, B1: ">2" }), "2"); // criterion from a cell
  assert.equal(evalWith('=COUNTIF(A1:A2,">=b")', { A1: "apple", A2: "banana" }), "1"); // text order
  assert.equal(evalWith('=COUNTIF(A1:A2,"=2.5")', nums), "1"); // explicit equals
});

test("criteria: text equality is case-insensitive; errors in the range do not propagate", () => {
  assert.equal(
    evalWith('=SUMIF(A1:A2,"x",B1:B2)', { A1: "X", A2: "x", B1: "1", B2: "2" }),
    "3",
  );
  // An error cell simply fails every criterion; COUNTIF still answers.
  assert.equal(evalWith('=COUNTIF(A1:A2,">5")', { A1: "=1/0", A2: "7" }), "1");
});

test("SUMIF / AVERAGEIF: unmatched error rows stay untouched; empty matches", () => {
  // The error sits in a row the criterion does NOT match, so it never surfaces.
  assert.equal(
    evalWith('=SUMIF(A1:A2,"a",B1:B2)', { A1: "a", A2: "b", B1: "10", B2: "=1/0" }),
    "10",
  );
  assert.equal(evalWith('=AVERAGEIF(A1:A2,">99")', { A1: "1", A2: "2" }), "#DIV/0!");
  assert.equal(
    evalWith('=SUMIFS(B1:B2,A1:A2,"zz")', { A1: "a", A2: "b", B1: "1", B2: "2" }),
    "0",
  );
});

test("COUNTIF arity error matches the Sheets #N/A convention", () => {
  assert.equal(evalWith("=COUNTIF(A1:A2)", { A1: "1" }), "#N/A");
});
