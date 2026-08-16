import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula } from "./_harness";

test("DATE builds a serial that YEAR/MONTH/DAY read back", () => {
  assert.equal(evalFormula("=YEAR(DATE(2026,8,16))"), "2026");
  assert.equal(evalFormula("=MONTH(DATE(2026,8,16))"), "8");
  assert.equal(evalFormula("=DAY(DATE(2026,8,16))"), "16");
  // Serial matches the display layer's scale (25569 = 1970-01-01).
  assert.equal(evalFormula("=DATE(1970,1,1)"), "25569");
});

test("DATE normalises overflow (month 13 → next January)", () => {
  assert.equal(evalFormula("=MONTH(DATE(2026,13,1))"), "1");
  assert.equal(evalFormula("=YEAR(DATE(2026,13,1))"), "2027");
});

test("WEEKDAY types: 1970-01-01 was a Thursday", () => {
  assert.equal(evalFormula("=WEEKDAY(25569)"), "5"); // type 1: Sun=1 → Thu=5
  assert.equal(evalFormula("=WEEKDAY(25569,2)"), "4"); // type 2: Mon=1 → Thu=4
  assert.equal(evalFormula("=WEEKDAY(25569,3)"), "3"); // type 3: Mon=0 → Thu=3
});

test("TODAY is a whole day; NOW is today plus a fraction", () => {
  const today = Number(evalFormula("=TODAY()"));
  const now = Number(evalFormula("=NOW()"));
  assert.ok(Number.isInteger(today), `TODAY ${today}`);
  assert.ok(now >= today && now < today + 1, `NOW ${now} vs TODAY ${today}`);
  assert.ok(Number(evalFormula("=YEAR(TODAY())")) >= 2020);
});
