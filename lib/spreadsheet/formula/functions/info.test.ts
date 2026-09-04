import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula, evalWith } from "./_harness";

test("the IS* predicates answer about a value's type and never error themselves", () => {
  assert.equal(evalFormula("=ISNUMBER(4)"), "TRUE");
  assert.equal(evalFormula('=ISNUMBER("4")'), "FALSE");
  assert.equal(evalFormula('=ISTEXT("hi")'), "TRUE");
  assert.equal(evalFormula("=ISNONTEXT(1)"), "TRUE");
  assert.equal(evalFormula("=ISLOGICAL(TRUE)"), "TRUE");
  assert.equal(evalWith("=ISBLANK(A1)", {}), "TRUE");
  assert.equal(evalWith("=ISBLANK(A1)", { A1: "x" }), "FALSE");
  assert.equal(evalFormula("=ISERROR(1/0)"), "TRUE");
  assert.equal(evalFormula("=ISERR(1/0)"), "TRUE");
  assert.equal(evalFormula("=ISERR(NA())"), "FALSE");
  assert.equal(evalFormula("=ISNA(NA())"), "TRUE");
  assert.equal(evalFormula("=ISEVEN(4)"), "TRUE");
  assert.equal(evalFormula("=ISODD(-3)"), "TRUE");
  assert.equal(evalFormula('=ISEVEN("x")'), "#VALUE!");
});

test("N, T, TYPE and ERROR.TYPE", () => {
  assert.equal(evalFormula("=N(TRUE)"), "1");
  assert.equal(evalFormula('=N("text")'), "0");
  assert.equal(evalFormula('=T("text")'), "text");
  assert.equal(evalFormula("=T(5)"), "");
  assert.equal(evalFormula("=TYPE(1)"), "1");
  assert.equal(evalFormula('=TYPE("a")'), "2");
  assert.equal(evalFormula("=TYPE(TRUE)"), "4");
  assert.equal(evalFormula("=TYPE(1/0)"), "16");
  assert.equal(evalFormula("=ERROR.TYPE(1/0)"), "2");
  assert.equal(evalFormula("=ERROR.TYPE(NA())"), "7");
  assert.equal(evalFormula("=ERROR.TYPE(1)"), "#N/A");
  assert.equal(evalFormula("=NA()"), "#N/A");
});

test("number-base conversion, including two's complement at full width", () => {
  assert.equal(evalFormula("=BIN2DEC(1010)"), "10");
  assert.equal(evalFormula("=BIN2DEC(1111111111)"), "-1");
  assert.equal(evalFormula("=DEC2BIN(10)"), "1010");
  assert.equal(evalFormula("=DEC2BIN(10, 8)"), "00001010");
  assert.equal(evalFormula("=DEC2BIN(-1)"), "1111111111");
  assert.equal(evalFormula("=DEC2BIN(1024)"), "#NUM!");
  assert.equal(evalFormula('=HEX2DEC("FF")'), "255");
  assert.equal(evalFormula("=DEC2HEX(255)"), "FF");
  assert.equal(evalFormula("=DEC2HEX(255, 4)"), "00FF");
  assert.equal(evalFormula("=OCT2DEC(17)"), "15");
  assert.equal(evalFormula("=DEC2OCT(15)"), "17");
  assert.equal(evalFormula("=BIN2HEX(1010)"), "A");
  assert.equal(evalFormula('=HEX2BIN("A")'), "1010");
  assert.equal(evalFormula("=BIN2DEC(102)"), "#NUM!");
});

test("bit arithmetic", () => {
  assert.equal(evalFormula("=BITAND(12, 10)"), "8");
  assert.equal(evalFormula("=BITOR(12, 10)"), "14");
  assert.equal(evalFormula("=BITXOR(12, 10)"), "6");
  assert.equal(evalFormula("=BITLSHIFT(1, 4)"), "16");
  assert.equal(evalFormula("=BITRSHIFT(16, 2)"), "4");
  assert.equal(evalFormula("=BITAND(-1, 1)"), "#NUM!");
  assert.equal(evalFormula("=DELTA(2, 2)"), "1");
  assert.equal(evalFormula("=GESTEP(5, 3)"), "1");
  assert.equal(evalFormula("=GESTEP(1, 3)"), "0");
});

test("CONVERT handles scale units and temperature offsets", () => {
  assert.equal(evalFormula('=CONVERT(1, "mi", "km")'), "1.609344");
  assert.equal(evalFormula('=CONVERT(100, "C", "F")'), "212");
  assert.equal(evalFormula('=ROUND(CONVERT(1, "lbm", "kg"), 4)'), "0.4536");
  assert.equal(evalFormula('=CONVERT(2, "hr", "min")'), "120");
  assert.equal(evalFormula('=CONVERT(1, "m", "kg")'), "#N/A");
  assert.equal(evalFormula('=CONVERT(1, "furlong", "m")'), "#N/A");
});
