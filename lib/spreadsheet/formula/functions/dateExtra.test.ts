import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula, evalWith } from "./_harness";

test("DATEVALUE reads the forms people type, and nothing looser", () => {
  assert.equal(evalFormula('=DATEVALUE("2026-09-04")'), "46269");
  assert.equal(evalFormula('=DATEVALUE("9/4/2026")'), "46269");
  assert.equal(evalFormula('=DATEVALUE("4 Sep 2026")'), "46269");
  assert.equal(evalFormula('=DATEVALUE("September 4, 2026")'), "46269");
  assert.equal(evalFormula('=DATEVALUE("next tuesday")'), "#VALUE!");
  assert.equal(evalFormula('=YEAR(DATEVALUE("2026-09-04"))'), "2026");
});

test("time of day: TIME, TIMEVALUE, HOUR, MINUTE, SECOND", () => {
  assert.equal(evalFormula("=TIME(13, 45, 30) * 86400"), "49530");
  assert.equal(evalFormula("=HOUR(TIME(13, 45, 30))"), "13");
  assert.equal(evalFormula("=MINUTE(TIME(13, 45, 30))"), "45");
  assert.equal(evalFormula("=SECOND(TIME(13, 45, 30))"), "30");
  assert.equal(evalFormula('=HOUR(TIMEVALUE("1:45 pm"))'), "13");
  assert.equal(evalFormula('=HOUR(TIMEVALUE("2026-09-04 08:15"))'), "8");
  assert.equal(evalFormula("=TIME(25, 0, 0) * 24"), "1", "hours wrap past midnight");
});

test("month arithmetic clamps to the month's length", () => {
  assert.equal(evalFormula("=EDATE(DATE(2026, 1, 31), 1)"), String(evalFormula("=DATE(2026, 2, 28)")));
  assert.equal(evalFormula("=EDATE(DATE(2026, 3, 15), -3)"), String(evalFormula("=DATE(2025, 12, 15)")));
  assert.equal(evalFormula("=EOMONTH(DATE(2026, 2, 10), 0)"), String(evalFormula("=DATE(2026, 2, 28)")));
  assert.equal(evalFormula("=EOMONTH(DATE(2024, 1, 10), 1)"), String(evalFormula("=DATE(2024, 2, 29)")));
  assert.equal(evalFormula("=DAYS(DATE(2026, 3, 1), DATE(2026, 2, 1))"), "28");
  assert.equal(evalFormula("=DAYS360(DATE(2026, 1, 31), DATE(2026, 3, 31))"), "60");
});

test("DATEDIF in every unit", () => {
  const a = "DATE(2024, 3, 15)";
  const b = "DATE(2026, 9, 4)";
  assert.equal(evalFormula(`=DATEDIF(${a}, ${b}, "Y")`), "2");
  assert.equal(evalFormula(`=DATEDIF(${a}, ${b}, "M")`), "29");
  assert.equal(evalFormula(`=DATEDIF(${a}, ${b}, "D")`), "903");
  assert.equal(evalFormula(`=DATEDIF(${a}, ${b}, "YM")`), "5");
  assert.equal(evalFormula(`=DATEDIF(${a}, ${b}, "MD")`), "20");
  assert.equal(evalFormula(`=DATEDIF(${a}, ${b}, "YD")`), "173");
  assert.equal(evalFormula(`=DATEDIF(${b}, ${a}, "D")`), "#NUM!");
});

test("working days skip weekends and listed holidays", () => {
  /* 2026-09-04 is a Friday. */
  assert.equal(evalFormula("=NETWORKDAYS(DATE(2026, 9, 4), DATE(2026, 9, 11))"), "6");
  assert.equal(evalWith("=NETWORKDAYS(DATE(2026, 9, 4), DATE(2026, 9, 11), A1)", { A1: "46272" }), "5", "Monday the 7th is a holiday");
  assert.equal(evalFormula("=WORKDAY(DATE(2026, 9, 4), 1)"), String(evalFormula("=DATE(2026, 9, 7)")));
  assert.equal(evalFormula("=WORKDAY(DATE(2026, 9, 4), -1)"), String(evalFormula("=DATE(2026, 9, 3)")));
  assert.equal(evalFormula("=WEEKDAY(WORKDAY(DATE(2026, 9, 4), 5))"), "6", "five working days on is next Friday");
});

test("week numbers and year fractions", () => {
  assert.equal(evalFormula("=WEEKNUM(DATE(2026, 1, 1))"), "1");
  assert.equal(evalFormula("=WEEKNUM(DATE(2026, 9, 4))"), "36");
  assert.equal(evalFormula("=ISOWEEKNUM(DATE(2026, 1, 1))"), "1");
  assert.equal(evalFormula("=ISOWEEKNUM(DATE(2027, 1, 1))"), "53");
  assert.equal(evalFormula("=YEARFRAC(DATE(2026, 1, 1), DATE(2026, 7, 1))"), "0.5");
  assert.equal(evalFormula("=ROUND(YEARFRAC(DATE(2026, 1, 1), DATE(2026, 7, 1), 1), 4)"), "0.4959");
  assert.equal(evalFormula("=YEARFRAC(DATE(2026, 1, 1), DATE(2027, 1, 1), 3)"), "1");
  assert.equal(evalFormula("=YEARFRAC(DATE(2026, 1, 1), DATE(2026, 1, 1), 9)"), "#NUM!");
});

test("names and the two halves of a serial", () => {
  assert.equal(evalFormula("=MONTHNAME(DATE(2026, 9, 4))"), "September");
  assert.equal(evalFormula("=DAYNAME(DATE(2026, 9, 4))"), "Friday");
  assert.equal(evalFormula("=DATEPART(46269.75)"), "46269");
  assert.equal(evalFormula("=TIMEPART(46269.75)"), "0.75");
});
