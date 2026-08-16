import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula, evalWith } from "./_harness";

test("CONCATENATE / LEN", () => {
  assert.equal(evalFormula('=CONCATENATE("a","b","c")'), "abc");
  assert.equal(evalWith("=CONCATENATE(A1,A2)", { A1: "foo", A2: "bar" }), "foobar");
  assert.equal(evalFormula('=LEN("hello")'), "5");
  assert.equal(evalFormula("=LEN(12345)"), "5");
});

test("LEFT / RIGHT / MID", () => {
  assert.equal(evalFormula('=LEFT("spreadsheet",6)'), "spread");
  assert.equal(evalFormula('=LEFT("x")'), "x"); // default 1
  assert.equal(evalFormula('=RIGHT("spreadsheet",5)'), "sheet");
  assert.equal(evalFormula('=MID("spreadsheet",7,5)'), "sheet");
  assert.equal(evalFormula('=MID("abc",0,1)'), "#VALUE!");
});

test("LOWER / UPPER / TRIM", () => {
  assert.equal(evalFormula('=LOWER("MixED")'), "mixed");
  assert.equal(evalFormula('=UPPER("MixED")'), "MIXED");
  assert.equal(evalFormula('=TRIM("  a   b  ")'), "a b");
});

test("SUBSTITUTE (all, and nth instance)", () => {
  assert.equal(evalFormula('=SUBSTITUTE("a-b-c","-","+")'), "a+b+c");
  assert.equal(evalFormula('=SUBSTITUTE("a-b-c","-","+",2)'), "a-b+c");
  assert.equal(evalFormula('=SUBSTITUTE("a-b-c","-","+",9)'), "a-b-c"); // no such instance
});

test("FIND is case-sensitive; SEARCH is not", () => {
  assert.equal(evalFormula('=FIND("s","spreadsheet")'), "1");
  assert.equal(evalFormula('=FIND("S","spreadsheet")'), "#VALUE!"); // case-sensitive
  assert.equal(evalFormula('=SEARCH("S","spreadsheet")'), "1"); // case-insensitive
  assert.equal(evalFormula('=FIND("sheet","spreadsheet")'), "7");
});

test("TEXT: numeric and date formats (documented subset)", () => {
  assert.equal(evalFormula("=TEXT(1234.5,\"0.00\")"), "1234.50");
  assert.equal(evalFormula("=TEXT(1234.5,\"#,##0.00\")"), "1,234.50");
  assert.equal(evalFormula("=TEXT(0.25,\"0%\")"), "25%");
  // 25569 = 1970-01-01 on the shared serial scale.
  assert.equal(evalFormula('=TEXT(25569,"yyyy-mm-dd")'), "1970-01-01");
});

test("VALUE parses numbers, percent and a currency symbol", () => {
  assert.equal(evalFormula('=VALUE("1,234.5")'), "1234.5");
  assert.equal(evalFormula('=VALUE("50%")'), "0.5");
  assert.equal(evalFormula('=VALUE("$42")'), "42");
  assert.equal(evalFormula('=VALUE("abc")'), "#VALUE!");
});

test("text functions propagate errors", () => {
  assert.equal(evalWith("=LEN(A1)", { A1: "=1/0" }), "#DIV/0!");
});
