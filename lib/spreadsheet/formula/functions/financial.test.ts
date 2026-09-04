import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula, evalWith } from "./_harness";

test("PMT, PV, FV and NPER agree with the textbook loan", () => {
  /* A 20,000 loan at 5% a year over 60 months. */
  assert.equal(evalFormula("=ROUND(PMT(5%/12, 60, 20000), 2)"), "-377.42");
  assert.equal(evalFormula("=ROUND(PV(5%/12, 60, -377.42), 0)"), "20000");
  assert.equal(evalFormula("=ROUND(FV(5%/12, 60, -377.42, 20000), 0)"), "0");
  assert.equal(evalFormula("=ROUND(NPER(5%/12, -377.42, 20000), 0)"), "60");
  assert.equal(evalFormula("=PMT(0, 10, 1000)"), "-100");
  assert.equal(evalFormula("=PMT(5%, 0, 1000)"), "#DIV/0!");
});

test("RATE is solved numerically and rounds back to the input", () => {
  assert.equal(evalFormula("=ROUND(RATE(60, -377.42, 20000) * 12, 4)"), "0.05");
  assert.equal(evalFormula("=RATE(10, 100, 100)"), "#NUM!", "money in with no money out has no rate");
});

test("IPMT and PPMT split the payment and sum to it", () => {
  assert.equal(evalFormula("=ROUND(IPMT(5%/12, 1, 60, 20000), 2)"), "-83.33");
  assert.equal(evalFormula("=ROUND(IPMT(5%/12, 1, 60, 20000) + PPMT(5%/12, 1, 60, 20000), 2)"), "-377.42");
  assert.equal(evalFormula("=IPMT(5%/12, 61, 60, 20000)"), "#NUM!");
  assert.equal(evalFormula("=ROUND(CUMIPMT(5%/12, 60, 20000, 1, 60, 0), 2)"), "-2645.48");
  assert.equal(evalFormula("=ROUND(CUMPRINC(5%/12, 60, 20000, 1, 60, 0), 0)"), "-20000");
});

test("NPV, IRR and friends over a cash-flow column", () => {
  const cells = { A1: "-1000", A2: "300", A3: "400", A4: "500" };
  assert.equal(evalWith("=ROUND(NPV(10%, A2:A4) + A1, 2)", cells), "-21.04");
  assert.equal(evalWith("=ROUND(IRR(A1:A4), 4)", cells), "0.089");
  assert.equal(evalWith("=IRR(A2:A4)", cells), "#NUM!", "all inflows never balance");
  assert.equal(evalWith("=ROUND(MIRR(A1:A4, 10%, 12%), 4)", cells), "0.0982");
  const dated = { ...cells, B1: "45000", B2: "45365", B3: "45730", B4: "46096" };
  assert.equal(evalWith("=ROUND(XNPV(10%, A1:A4, B1:B4), 2)", dated), "-21.13");
  assert.equal(evalWith("=ROUND(XIRR(A1:A4, B1:B4), 4)", dated), "0.0889");
});

test("depreciation schedules", () => {
  assert.equal(evalFormula("=SLN(10000, 1000, 5)"), "1800");
  assert.equal(evalFormula("=SYD(10000, 1000, 5, 1)"), "3000");
  assert.equal(evalFormula("=DDB(10000, 1000, 5, 1)"), "4000");
  assert.equal(evalFormula("=DDB(10000, 1000, 5, 2)"), "2400");
  assert.equal(evalFormula("=ROUND(DB(10000, 1000, 5, 1), 0)"), "3690");
  assert.equal(evalFormula("=SLN(1, 1, 0)"), "#DIV/0!");
});

test("rate conversions and growth", () => {
  assert.equal(evalFormula("=ROUND(EFFECT(5%, 12), 6)"), "0.051162");
  assert.equal(evalFormula("=ROUND(NOMINAL(0.051162, 12), 4)"), "0.05");
  assert.equal(evalFormula("=ROUND(RRI(10, 1000, 2000), 4)"), "0.0718");
  assert.equal(evalFormula("=ROUND(PDURATION(7.18%, 1000, 2000), 1)"), "10");
  assert.equal(evalFormula("=DOLLARDE(1.02, 16)"), "1.125");
  assert.equal(evalFormula("=DOLLARFR(1.125, 16)"), "1.02");
});
