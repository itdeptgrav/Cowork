/**
 * Adversarial audit of the text functions against Google Sheets / Excel
 * semantics. Assertions state the CORRECT spreadsheet answer.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula, evalWith } from "@/lib/spreadsheet/formula/functions/_harness";

test("CONCATENATE coerces numbers, booleans and blanks", () => {
  assert.equal(evalFormula('=CONCATENATE("a",1,TRUE)'), "a1TRUE");
  assert.equal(evalWith('=CONCATENATE("x",A9)'), "x"); // blank is ""
  assert.equal(evalWith("=CONCATENATE(A1:A3)", { A1: "a", A3: "c" }), "ac"); // range, blank skipped as ""
});

test("LEN of non-text values", () => {
  assert.equal(evalWith("=LEN(A1)"), "0"); // blank
  assert.equal(evalFormula("=LEN(TRUE)"), "4"); // "TRUE"
  assert.equal(evalFormula("=LEN(12.5)"), "4");
});

test("LEFT / RIGHT: zero, negative and oversized counts", () => {
  assert.equal(evalFormula('=LEFT("abc",0)'), "");
  assert.equal(evalFormula('=RIGHT("abc",0)'), "");
  assert.equal(evalFormula('=LEFT("abc",10)'), "abc");
  assert.equal(evalFormula('=RIGHT("abc",10)'), "abc");
  assert.equal(evalFormula('=LEFT("abc",1.9)'), "a"); // count truncates
  assert.equal(evalFormula("=LEFT(123.45,4)"), "123.");
});

test("LEFT with a negative count is an error", () => {
  // Sheets/Excel: a negative count is a #VALUE! error, not an empty string.
  assert.equal(evalFormula('=LEFT("abc",-1)'), "#VALUE!");
});

test("RIGHT with a negative count is an error", () => {
  assert.equal(evalFormula('=RIGHT("abc",-1)'), "#VALUE!");
});

test("MID boundaries", () => {
  assert.equal(evalFormula('=MID("abc",2,100)'), "bc");
  assert.equal(evalFormula('=MID("abc",4,2)'), ""); // start past the end
  assert.equal(evalFormula('=MID("abc",1,0)'), "");
  assert.equal(evalFormula('=MID("abc",1,-1)'), "#VALUE!");
  assert.equal(evalFormula('=MID("abc",0.5,1)'), "#VALUE!"); // start < 1
  assert.equal(evalFormula('=MID("abc",1.9,2)'), "ab"); // start truncates to 1
});

test("SUBSTITUTE: case sensitivity, empty find, bad occurrence", () => {
  assert.equal(evalFormula('=SUBSTITUTE("Aa","a","x")'), "Ax"); // case-sensitive
  assert.equal(evalFormula('=SUBSTITUTE("abc","","x")'), "abc"); // empty find: unchanged
  assert.equal(evalFormula('=SUBSTITUTE("aaa","a","b",2)'), "aba");
  assert.equal(evalFormula('=SUBSTITUTE("a-b","-","+",0)'), "#VALUE!"); // occurrence < 1
  assert.equal(evalFormula('=SUBSTITUTE("a-b","-","+",-2)'), "#VALUE!");
  assert.equal(evalFormula("=SUBSTITUTE(101.5,1,2)"), "202.5"); // numbers coerce to text
});

test("FIND / SEARCH: start offsets and failure modes", () => {
  assert.equal(evalFormula('=FIND("b","abcabc",3)'), "5");
  assert.equal(evalFormula('=SEARCH("Bc","aBC")'), "2"); // case-insensitive
  assert.equal(evalFormula('=SEARCH("z","abc")'), "#VALUE!"); // not found
  assert.equal(evalFormula('=FIND("a","abc",0)'), "#VALUE!"); // start < 1
  assert.equal(evalFormula('=FIND("","abc")'), "1"); // empty needle: start position
  // Documented divergence (text.ts header): SEARCH does not support wildcards,
  // so "a*c" is a literal needle here where Sheets would match "abc".
  assert.equal(evalFormula('=SEARCH("a*c","abc")'), "#VALUE!");
});

test("TEXT: numeric patterns", () => {
  assert.equal(evalFormula('=TEXT(0.5,"0%")'), "50%");
  assert.equal(evalFormula('=TEXT(0.125,"0.0%")'), "12.5%");
  assert.equal(evalFormula('=TEXT(-1234.5,"#,##0.00")'), "-1,234.50");
  assert.equal(evalFormula('=TEXT(42,"$#,##0.00")'), "$42.00");
  assert.equal(evalFormula('=TEXT(1234.567,"0")'), "1235");
  assert.equal(evalFormula('=TEXT("abc","0")'), "abc"); // non-numeric formats to itself
});

test("TEXT: date patterns on the shared serial scale", () => {
  assert.equal(evalFormula('=TEXT(DATE(2026,3,7),"yyyy-mm-dd")'), "2026-03-07");
  assert.equal(evalFormula('=TEXT(DATE(2026,3,7),"d mmm yyyy")'), "7 Mar 2026");
  assert.equal(evalFormula('=TEXT(DATE(2026,3,7),"dddd")'), "Saturday");
});

test("VALUE: whitespace, exponent, percent, booleans", () => {
  assert.equal(evalFormula('=VALUE(" 42 ")'), "42");
  assert.equal(evalFormula('=VALUE("1e3")'), "1000");
  assert.equal(evalFormula('=VALUE("-12.5%")'), "-0.125");
  assert.equal(evalFormula('=VALUE("")'), "#VALUE!");
  assert.equal(evalFormula("=VALUE(TRUE)"), "#VALUE!"); // booleans are not numeric text
  assert.equal(evalFormula("=VALUE(7)"), "7"); // a number passes through
});
