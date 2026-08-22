/**
 * Adversarial audit of the date functions against Google Sheets semantics
 * (Sheets has no Excel 1900 leap bug, and offsets years 0-1899 by +1900).
 * Assertions state the CORRECT spreadsheet answer.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula } from "@/lib/spreadsheet/formula/functions/_harness";

test("DATE normalises month/day overflow and underflow", () => {
  assert.equal(evalFormula("=MONTH(DATE(2026,14,1))"), "2"); // month 14 -> Feb next year
  assert.equal(evalFormula("=YEAR(DATE(2026,14,1))"), "2027");
  assert.equal(evalFormula("=MONTH(DATE(2026,0,5))"), "12"); // month 0 -> Dec previous year
  assert.equal(evalFormula("=YEAR(DATE(2026,0,5))"), "2025");
  assert.equal(evalFormula("=DAY(DATE(2026,1,32))"), "1"); // Jan 32 -> Feb 1
  assert.equal(evalFormula("=MONTH(DATE(2026,1,32))"), "2");
  assert.equal(evalFormula("=DAY(DATE(2026,1,0))"), "31"); // day 0 -> last day of Dec 2025
  assert.equal(evalFormula("=MONTH(DATE(2026,1,0))"), "12");
  assert.equal(evalFormula("=YEAR(DATE(2026,1,0))"), "2025");
});

test("DATE leap-year handling (no Excel 1900 bug, per Sheets)", () => {
  assert.equal(evalFormula("=DAY(DATE(2024,2,29))"), "29"); // real leap day
  assert.equal(evalFormula("=MONTH(DATE(2024,2,29))"), "2");
  assert.equal(evalFormula("=DAY(DATE(2023,2,29))"), "1"); // rolls to Mar 1
  assert.equal(evalFormula("=DAY(DATE(2000,2,29))"), "29"); // 400-year rule
  assert.equal(evalFormula("=DAY(DATE(1900,2,29))"), "1"); // 1900 was NOT a leap year (Sheets)
  assert.equal(evalFormula("=MONTH(DATE(1900,2,29))"), "3");
});

test("DATE year offset: 0-1899 shift into the 1900s", () => {
  assert.equal(evalFormula("=YEAR(DATE(0,1,1))"), "1900");
  assert.equal(evalFormula("=YEAR(DATE(126,1,1))"), "2026");
  assert.equal(evalFormula("=YEAR(DATE(1899,12,31))"), "3799"); // 1899 + 1900
  assert.equal(evalFormula("=YEAR(DATE(1900,1,1))"), "1900"); // 1900 is literal
});

test("DATE truncates fractional parts", () => {
  assert.equal(evalFormula("=DAY(DATE(2026,1,15.9))"), "15");
  assert.equal(evalFormula("=MONTH(DATE(2026,3.7,1))"), "3");
});

test("WEEKDAY types on a known Monday and Sunday", () => {
  // 2026-08-17 was a Monday; 2026-08-16 a Sunday.
  assert.equal(evalFormula("=WEEKDAY(DATE(2026,8,17))"), "2"); // type 1: Sun=1
  assert.equal(evalFormula("=WEEKDAY(DATE(2026,8,17),2)"), "1"); // type 2: Mon=1
  assert.equal(evalFormula("=WEEKDAY(DATE(2026,8,17),3)"), "0"); // type 3: Mon=0
  assert.equal(evalFormula("=WEEKDAY(DATE(2026,8,16))"), "1");
  assert.equal(evalFormula("=WEEKDAY(DATE(2026,8,16),2)"), "7");
  assert.equal(evalFormula("=WEEKDAY(DATE(2026,8,16),3)"), "6");
  // A time fraction does not change the day.
  assert.equal(evalFormula("=WEEKDAY(DATE(2026,8,17)+0.9)"), "2");
  // Sheets accepts only types 1-3.
  assert.equal(evalFormula("=WEEKDAY(DATE(2026,8,16),4)"), "#NUM!");
  assert.equal(evalFormula('=WEEKDAY(DATE(2026,8,16),"2")'), "7"); // numeric text type
});

test("YEAR/MONTH/DAY reject non-numeric, non-date input", () => {
  assert.equal(evalFormula('=YEAR("x")'), "#VALUE!");
  assert.equal(evalFormula("=DATE(2026,8)"), "#VALUE!"); // arity
  assert.equal(evalFormula("=DAY(1/0)"), "#DIV/0!");
});
