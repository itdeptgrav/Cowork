import assert from "node:assert/strict";
import { test } from "node:test";
import { overtimeCreditFor, overtimeMinutes } from "./credit.ts";

/**
 * Overtime is credited as an OFFSET, not a bonus (O5). These fix the pure
 * arithmetic; the projection is what clamps a day to its 1.0 maximum, so a
 * credit here can cancel a same-day deduction but never lift a day above full.
 * Tests pass rate and grace explicitly so they never depend on live config.
 */

const RATE = 0.01;
const GRACE = 15;

test("minutes past the scheduled end are counted; earlier or equal is zero", () => {
  assert.equal(overtimeMinutes("18:00", "19:00"), 60);
  assert.equal(overtimeMinutes("18:00", "18:00"), 0);
  assert.equal(overtimeMinutes("18:00", "17:30"), 0);
});

test("a missing clock on either side yields no overtime", () => {
  assert.equal(overtimeMinutes(null, "19:00"), 0);
  assert.equal(overtimeMinutes("18:00", null), 0);
  assert.equal(overtimeMinutes("18:00", "not-a-time"), 0);
});

test("the grace period is removed before crediting", () => {
  const c = overtimeCreditFor("18:00", "18:10", { rate: RATE, grace: GRACE });
  assert.equal(c.minutes, 10);
  assert.equal(c.chargeableMinutes, 0);
  assert.equal(c.points, 0);
});

test("credit is proportional to chargeable overtime", () => {
  const c = overtimeCreditFor("18:00", "19:15", { rate: RATE, grace: GRACE });
  assert.equal(c.minutes, 75);
  assert.equal(c.chargeableMinutes, 60);
  assert.equal(c.points, 0.6);
});

test("points round to two places", () => {
  const c = overtimeCreditFor("18:00", "18:38", { rate: RATE, grace: GRACE });
  // 38 − 15 = 23 chargeable × 0.01 = 0.23
  assert.equal(c.points, 0.23);
});
