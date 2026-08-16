import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula, evalWith } from "./_harness";

test("ABS / SUM / MIN / MAX / POWER / MOD", () => {
  assert.equal(evalFormula("=ABS(-7)"), "7");
  assert.equal(evalWith("=SUM(A1:A3)", { A1: "1", A2: "2", A3: "3" }), "6");
  assert.equal(evalWith("=MIN(A1:A3)", { A1: "5", A2: "2", A3: "9" }), "2");
  assert.equal(evalWith("=MAX(A1:A3)", { A1: "5", A2: "2", A3: "9" }), "9");
  assert.equal(evalFormula("=POWER(2,10)"), "1024");
  assert.equal(evalFormula("=MOD(7,3)"), "1");
  assert.equal(evalFormula("=MOD(-7,3)"), "2"); // sign of divisor
  assert.equal(evalFormula("=MOD(1,0)"), "#DIV/0!");
});

test("ROUND / ROUNDUP / ROUNDDOWN", () => {
  assert.equal(evalFormula("=ROUND(2.345,2)"), "2.35");
  assert.equal(evalFormula("=ROUND(2.5,0)"), "3");
  assert.equal(evalFormula("=ROUNDUP(2.001,2)"), "2.01");
  assert.equal(evalFormula("=ROUNDDOWN(2.999,2)"), "2.99");
  assert.equal(evalFormula("=ROUND(-2.5,0)"), "-3");
});

test("CEILING / FLOOR", () => {
  assert.equal(evalFormula("=CEILING(2.1)"), "3");
  assert.equal(evalFormula("=CEILING(12,5)"), "15");
  assert.equal(evalFormula("=FLOOR(2.9)"), "2");
  assert.equal(evalFormula("=FLOOR(12,5)"), "10");
  assert.equal(evalFormula("=FLOOR(1,0)"), "#DIV/0!");
});

test("INT truncates toward −∞; TRUNC toward zero", () => {
  assert.equal(evalFormula("=INT(2.9)"), "2");
  assert.equal(evalFormula("=INT(-2.1)"), "-3");
  assert.equal(evalFormula("=TRUNC(-2.9)"), "-2");
  assert.equal(evalFormula("=TRUNC(3.14159,2)"), "3.14");
});

test("RAND in [0,1); RANDBETWEEN in [min,max]", () => {
  for (let i = 0; i < 20; i++) {
    const r = Number(evalFormula("=RAND()"));
    assert.ok(r >= 0 && r < 1, `RAND ${r}`);
    const b = Number(evalFormula("=RANDBETWEEN(3,7)"));
    assert.ok(b >= 3 && b <= 7 && Number.isInteger(b), `RANDBETWEEN ${b}`);
  }
  assert.equal(evalFormula("=RANDBETWEEN(7,3)"), "#NUM!"); // max < min
});

test("errors propagate through math", () => {
  assert.equal(evalWith("=ABS(A1)", { A1: "=1/0" }), "#DIV/0!");
  assert.equal(evalFormula("=SUM(1,#REF!)"), "#REF!");
});
