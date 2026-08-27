/**
 * Adversarial audit of the logical functions against Google Sheets / Excel
 * semantics. Assertions state the CORRECT spreadsheet answer.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula, evalWith } from "@/lib/spreadsheet/formula/functions/_harness";

test("IF condition coercion", () => {
  assert.equal(evalFormula('=IF("TRUE",1,2)'), "1"); // text TRUE coerces
  assert.equal(evalFormula('=IF("yes",1,2)'), "#VALUE!"); // other text does not
  assert.equal(evalFormula("=IF(5,1,2)"), "1"); // nonzero number is true
  assert.equal(evalWith("=IF(A1,1,2)"), "2"); // blank is false
  assert.equal(evalFormula("=IF(FALSE,1)"), "FALSE"); // missing else yields FALSE
  assert.equal(evalFormula("=IF(1/0,1,2)"), "#DIV/0!");
});

test("AND over a range ignores text cells, per Sheets", () => {
  // A1 holds the STRING "yes" (a text-producing formula), A2 a real boolean.
  // Sheets/Excel ignore text cells inside a RANGE argument: AND sees only TRUE.
  assert.equal(evalWith("=AND(A1:A2)", { A1: '="yes"', A2: "TRUE" }), "TRUE");
});

test("OR over a range ignores text cells, per Sheets", () => {
  // The text cell is skipped, the 0 makes it FALSE.
  assert.equal(evalWith("=OR(A1:A2)", { A1: "0", A2: '="x"' }), "FALSE");
});

test("AND over a range with no usable value at all is #VALUE!", () => {
  assert.equal(evalWith("=AND(A1:A2)"), "#VALUE!");
});

test("AND / OR / XOR direct-argument coercion", () => {
  assert.equal(evalFormula('=AND(1,"TRUE")'), "TRUE");
  assert.equal(evalFormula('=AND("abc")'), "#VALUE!");
  assert.equal(evalFormula("=XOR(2,0)"), "TRUE"); // one truthy
  assert.equal(evalFormula("=XOR(1,1,1)"), "TRUE"); // odd count
  assert.equal(evalFormula("=XOR(1,1)"), "FALSE");
});

test("NOT coercion", () => {
  assert.equal(evalFormula("=NOT(0)"), "TRUE");
  assert.equal(evalFormula('=NOT("abc")'), "#VALUE!");
});

test("IFERROR: fallback rules", () => {
  assert.equal(evalFormula('=IFERROR(1/0,1/0)'), "#DIV/0!"); // error in fallback surfaces
  assert.equal(evalFormula('=IFERROR("",1)'), ""); // empty string is not an error
  // Sheets (and this catalog) make value_if_error OPTIONAL: IFERROR(x) shows
  // blank when x errors.
  assert.equal(evalFormula("=IFERROR(1/0)"), "");
});

test("IFS: blanks are false, errors propagate, arity", () => {
  assert.equal(evalWith("=IFS(A9,1,TRUE,2)"), "2"); // blank condition -> false
  assert.equal(evalFormula("=IFS(1/0,1,TRUE,2)"), "#DIV/0!");
  assert.equal(evalFormula('=IFS("x",1)'), "#VALUE!"); // non-boolean condition
  assert.equal(evalFormula("=IFS(TRUE,1,FALSE)"), "#VALUE!"); // odd arg count (engine arity error)
});

test("SWITCH: equality semantics", () => {
  assert.equal(evalFormula('=SWITCH("A","a",1,2)'), "1"); // text match is case-insensitive
  assert.equal(evalFormula('=SWITCH(1,"1",10,99)'), "99"); // number does not match text "1"
  assert.equal(evalFormula('=SWITCH(TRUE,1,"one","fb")'), "fb"); // TRUE does not match 1
  assert.equal(evalFormula("=SWITCH(1/0,1,2)"), "#DIV/0!");
});
