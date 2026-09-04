import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula, evalWith } from "./_harness";

test("roots, logs and powers", () => {
  assert.equal(evalFormula("=SQRT(16)"), "4");
  assert.equal(evalFormula("=SQRT(-1)"), "#NUM!");
  assert.equal(evalFormula("=ROUND(EXP(1), 5)"), "2.71828");
  assert.equal(evalFormula("=LN(1)"), "0");
  assert.equal(evalFormula("=LOG(8, 2)"), "3");
  assert.equal(evalFormula("=LOG(100)"), "2");
  assert.equal(evalFormula("=LOG10(1000)"), "3");
  assert.equal(evalFormula("=LOG(0)"), "#NUM!");
  assert.equal(evalFormula("=ROUND(PI(), 4)"), "3.1416");
  assert.equal(evalFormula("=SIGN(-7)"), "-1");
});

test("trigonometry in radians, with the degree helpers", () => {
  assert.equal(evalFormula("=ROUND(SIN(PI()/2), 6)"), "1");
  assert.equal(evalFormula("=ROUND(COS(0), 6)"), "1");
  assert.equal(evalFormula("=ROUND(TAN(RADIANS(45)), 6)"), "1");
  assert.equal(evalFormula("=DEGREES(PI())"), "180");
  assert.equal(evalFormula("=ROUND(ATAN2(1, 1), 4)"), "0.7854");
  assert.equal(evalFormula("=ATAN2(0, 0)"), "#DIV/0!");
  assert.equal(evalFormula("=ASIN(2)"), "#NUM!");
});

test("products and sums of squares over ranges", () => {
  assert.equal(evalWith("=PRODUCT(A1:A3)", { A1: "2", A2: "3", A3: "4" }), "24");
  assert.equal(evalWith("=PRODUCT(A1:A3)", { A1: "2", A2: "x", A3: "4" }), "8", "text in a range is skipped");
  assert.equal(evalWith("=SUMSQ(A1:A2)", { A1: "3", A2: "4" }), "25");
  assert.equal(
    evalWith("=SUMPRODUCT(A1:A3, B1:B3)", { A1: "1", A2: "2", A3: "3", B1: "4", B2: "5", B3: "6" }),
    "32",
  );
  assert.equal(evalWith("=SUMPRODUCT(A1:A3, B1:B2)", { A1: "1", A2: "2", A3: "3", B1: "4", B2: "5" }), "#VALUE!");
});

test("integer arithmetic: QUOTIENT, GCD, LCM, MROUND, EVEN, ODD", () => {
  assert.equal(evalFormula("=QUOTIENT(17, 5)"), "3");
  assert.equal(evalFormula("=QUOTIENT(-17, 5)"), "-3");
  assert.equal(evalFormula("=QUOTIENT(1, 0)"), "#DIV/0!");
  assert.equal(evalFormula("=GCD(12, 18, 24)"), "6");
  assert.equal(evalFormula("=LCM(4, 6)"), "12");
  assert.equal(evalFormula("=GCD(-4, 6)"), "#NUM!");
  assert.equal(evalFormula("=MROUND(17, 5)"), "15");
  assert.equal(evalFormula("=MROUND(-7, 3)"), "#NUM!");
  assert.equal(evalFormula("=EVEN(3)"), "4");
  assert.equal(evalFormula("=EVEN(-3)"), "-4");
  assert.equal(evalFormula("=ODD(4)"), "5");
});

test("combinatorics", () => {
  assert.equal(evalFormula("=FACT(5)"), "120");
  assert.equal(evalFormula("=FACT(5.9)"), "120");
  assert.equal(evalFormula("=FACT(-1)"), "#NUM!");
  assert.equal(evalFormula("=FACTDOUBLE(7)"), "105");
  assert.equal(evalFormula("=COMBIN(5, 2)"), "10");
  assert.equal(evalFormula("=PERMUT(5, 2)"), "20");
  assert.equal(evalFormula("=COMBIN(2, 5)"), "#NUM!");
});

test("CEILING.MATH and FLOOR.MATH take any sign and honour mode", () => {
  assert.equal(evalFormula("=CEILING.MATH(-5.5)"), "-5");
  assert.equal(evalFormula("=CEILING.MATH(-5.5, 1, 1)"), "-6");
  assert.equal(evalFormula("=FLOOR.MATH(-5.5)"), "-6");
  assert.equal(evalFormula("=FLOOR.MATH(-5.5, 1, 1)"), "-5");
  assert.equal(evalFormula("=CEILING.MATH(7, 5)"), "10");
});

test("Roman numerals both ways", () => {
  assert.equal(evalFormula("=ROMAN(1994)"), "MCMXCIV");
  assert.equal(evalFormula("=ROMAN(4000)"), "#VALUE!");
  assert.equal(evalFormula('=ARABIC("MCMXCIV")'), "1994");
  assert.equal(evalFormula('=ARABIC("-XI")'), "-11");
  assert.equal(evalFormula('=ARABIC("hello")'), "#VALUE!");
});

test("SUBTOTAL picks the aggregate by code", () => {
  const cells = { A1: "2", A2: "4", A3: "6", A4: "x" };
  assert.equal(evalWith("=SUBTOTAL(9, A1:A4)", cells), "12");
  assert.equal(evalWith("=SUBTOTAL(109, A1:A4)", cells), "12");
  assert.equal(evalWith("=SUBTOTAL(1, A1:A4)", cells), "4");
  assert.equal(evalWith("=SUBTOTAL(2, A1:A4)", cells), "3");
  assert.equal(evalWith("=SUBTOTAL(3, A1:A4)", cells), "4");
  assert.equal(evalWith("=SUBTOTAL(4, A1:A4)", cells), "6");
  assert.equal(evalWith("=SUBTOTAL(5, A1:A4)", cells), "2");
  assert.equal(evalWith("=SUBTOTAL(6, A1:A4)", cells), "48");
  assert.equal(evalWith("=SUBTOTAL(7, A1:A4)", cells), "2");
  assert.equal(evalWith("=SUBTOTAL(10, A1:A4)", cells), "4");
  assert.equal(evalWith("=SUBTOTAL(12, A1:A4)", cells), "#VALUE!");
});

test("BASE and DECIMAL convert between radixes", () => {
  assert.equal(evalFormula("=BASE(255, 16)"), "FF");
  assert.equal(evalFormula("=BASE(5, 2, 8)"), "00000101");
  assert.equal(evalFormula('=DECIMAL("FF", 16)'), "255");
  assert.equal(evalFormula('=DECIMAL("zz", 36)'), "1295");
  assert.equal(evalFormula("=BASE(-1, 2)"), "#NUM!");
});
