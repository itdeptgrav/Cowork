/**
 * Adversarial audit of the math functions against Google Sheets / Excel
 * semantics. Assertions state the CORRECT spreadsheet answer.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula, evalWith } from "@/lib/spreadsheet/formula/functions/_harness";

test("ABS: coercion and arg counts", () => {
  assert.equal(evalFormula("=ABS(0)"), "0");
  assert.equal(evalFormula('=ABS("-3")'), "3"); // numeric text coerces
  assert.equal(evalFormula("=ABS(TRUE)"), "1"); // direct boolean coerces
  assert.equal(evalWith("=ABS(A1)"), "0"); // blank cell is 0
  assert.equal(evalFormula('=ABS("abc")'), "#VALUE!");
  assert.equal(evalFormula("=ABS()"), "#VALUE!"); // arity error
  assert.equal(evalFormula("=ABS(1,2)"), "#VALUE!");
});

test("ROUND half away from zero, default and negative places", () => {
  assert.equal(evalFormula("=ROUND(2.5)"), "3"); // 1-arg default: 0 places
  assert.equal(evalFormula("=ROUND(-2.5)"), "-3"); // away from zero
  assert.equal(evalFormula("=ROUND(2.675,2)"), "2.68"); // decimal tie
  assert.equal(evalFormula("=ROUND(15,-1)"), "20"); // negative places, tie up
  assert.equal(evalFormula("=ROUND(149.999,-2)"), "100");
  assert.equal(evalFormula("=ROUND(2.149,1.9)"), "2.1"); // places truncates to 1
});

test("ROUNDUP / ROUNDDOWN move away from / toward zero for negatives", () => {
  assert.equal(evalFormula("=ROUNDUP(-3.2,0)"), "-4"); // away from zero
  assert.equal(evalFormula("=ROUNDDOWN(-3.9,0)"), "-3"); // toward zero
  assert.equal(evalFormula("=ROUNDUP(31,-1)"), "40");
  assert.equal(evalFormula("=ROUNDDOWN(39,-1)"), "30");
});

test("MOD sign follows the divisor; zero divisor errors", () => {
  assert.equal(evalFormula("=MOD(3,-2)"), "-1");
  assert.equal(evalFormula("=MOD(-3,2)"), "1");
  assert.equal(evalFormula("=MOD(0,5)"), "0");
  assert.equal(evalFormula("=MOD(10.5,2.5)"), "0.5");
  assert.equal(evalFormula("=MOD(5,0)"), "#DIV/0!");
});

test("POWER edge cases", () => {
  assert.equal(evalFormula("=POWER(-2,3)"), "-8");
  assert.equal(evalFormula("=POWER(-8,0.5)"), "#NUM!"); // imaginary
  assert.equal(evalFormula("=POWER(2,1024)"), "#NUM!"); // overflow
  // Sheets/Excel: 0 to a negative power is a division by zero, not #NUM!.
  assert.equal(evalFormula("=POWER(0,-1)"), "#DIV/0!");
});

test("CEILING / FLOOR sign rules", () => {
  assert.equal(evalFormula("=CEILING(-2.5,2)"), "-2"); // toward +inf, per Sheets
  assert.equal(evalFormula("=CEILING(-2.5,-2)"), "-4"); // both negative: away from zero
  assert.equal(evalFormula("=FLOOR(-2.5,2)"), "-4");
  assert.equal(evalFormula("=CEILING(4.45,0.05)"), "4.45"); // already a multiple
  assert.equal(evalFormula("=CEILING(5,0)"), "0"); // zero significance
  assert.equal(evalFormula("=FLOOR(5,0)"), "#DIV/0!");
});

test("CEILING rejects a negative significance for a positive value", () => {
  // Sheets/Excel: a positive value with a negative significance is #NUM!.
  assert.equal(evalFormula("=CEILING(7,-5)"), "#NUM!");
});

test("FLOOR rejects a negative significance for a positive value", () => {
  assert.equal(evalFormula("=FLOOR(7,-5)"), "#NUM!");
});

test("INT floors toward minus infinity; TRUNC cuts toward zero", () => {
  assert.equal(evalFormula("=INT(-0.5)"), "-1");
  assert.equal(evalFormula('=INT("3.7")'), "3");
  assert.equal(evalFormula("=TRUNC(-8.9)"), "-8");
  assert.equal(evalFormula("=TRUNC(8.9,-1)"), "0");
  assert.equal(evalFormula("=TRUNC(123.456,-2)"), "100");
});

test("RANDBETWEEN with equal bounds is deterministic", () => {
  assert.equal(evalFormula("=RANDBETWEEN(-3,-3)"), "-3");
  assert.equal(evalFormula("=RANDBETWEEN(2,2)"), "2");
});

test("SUM: direct args coerce, range cells filter to numbers", () => {
  assert.equal(evalFormula('=SUM("5",TRUE)'), "6"); // direct text/bool coerce
  // In a RANGE, text, booleans and blanks are ignored (A2 is a text-producing
  // formula so the cell holds the STRING "7").
  assert.equal(
    evalWith("=SUM(A1:A5)", { A1: "1", A2: '="7"', A3: "TRUE", A5: "2" }),
    "3",
  );
  assert.equal(evalWith("=SUM(A1:A2)", { A1: "1", A2: "=1/0" }), "#DIV/0!");
  assert.equal(evalFormula('=SUM("abc")'), "#VALUE!");
  // Sheets/Excel: an empty STRING (unlike a blank cell) is not numeric text.
  assert.equal(evalFormula('=SUM("")'), "#VALUE!");
});

test("MIN / MAX: no numbers means 0; text numbers in ranges ignored", () => {
  assert.equal(evalWith("=MIN(A1:A2)", { A1: "x", A2: "y" }), "0");
  assert.equal(evalWith("=MAX(A1:A2)", { A1: "x", A2: "y" }), "0");
  assert.equal(evalFormula('=MAX("3","5")'), "5"); // direct text coerces
  assert.equal(evalWith("=MIN(A1:A2)", { A1: "TRUE", A2: "5" }), "5"); // bool cell ignored
});
