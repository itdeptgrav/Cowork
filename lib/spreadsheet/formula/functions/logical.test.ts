import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula, evalWith } from "./_harness";

test("IF takes only the chosen branch (nested)", () => {
  assert.equal(evalFormula('=IF(1>0,"yes","no")'), "yes");
  assert.equal(evalFormula('=IF(1<0,"yes","no")'), "no");
  // The untaken branch's error is never raised.
  assert.equal(evalFormula("=IF(TRUE,10,1/0)"), "10");
  assert.equal(evalFormula('=IF(1>0,IF(2>1,"deep","-"),"-")'), "deep");
});

test("AND / OR / NOT", () => {
  assert.equal(evalFormula("=AND(TRUE,TRUE,1)"), "TRUE");
  assert.equal(evalFormula("=AND(TRUE,FALSE)"), "FALSE");
  assert.equal(evalFormula("=OR(FALSE,0,TRUE)"), "TRUE");
  assert.equal(evalFormula("=NOT(FALSE)"), "TRUE");
});

test("XOR is true for an odd number of trues", () => {
  assert.equal(evalFormula("=XOR(TRUE,FALSE)"), "TRUE");
  assert.equal(evalFormula("=XOR(TRUE,TRUE)"), "FALSE");
  assert.equal(evalFormula("=XOR(TRUE,TRUE,TRUE)"), "TRUE");
});

test("IFERROR catches an error and passes a value through", () => {
  assert.equal(evalFormula('=IFERROR(1/0,"safe")'), "safe");
  assert.equal(evalFormula('=IFERROR(42,"safe")'), "42");
});

test("IFS returns the first true case; #N/A if none", () => {
  assert.equal(evalWith('=IFS(A1>90,"A",A1>80,"B",A1>0,"C")', { A1: "85" }), "B");
  assert.equal(evalWith('=IFS(A1>90,"A",A1>80,"B")', { A1: "50" }), "#N/A");
});

test("SWITCH matches a case, else the default", () => {
  assert.equal(evalWith('=SWITCH(A1,1,"one",2,"two","other")', { A1: "2" }), "two");
  assert.equal(evalWith('=SWITCH(A1,1,"one",2,"two","other")', { A1: "9" }), "other");
  assert.equal(evalWith('=SWITCH(A1,1,"one")', { A1: "9" }), "#N/A");
});
