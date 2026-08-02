import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_TIMER_SOP_CONFIG,
  computeTodayTarget,
  evaluateTimerSop,
  requiredHoursFor,
  type DayWork,
  type TimerSopConfig,
} from "./timerSop.ts";

/**
 * The Timer SOP Point Engine, ported from legacy. These pin the accumulation:
 * shortfall and overtime each build up across days and fire a point change
 * every time they cross their threshold, keeping the remainder — the exact
 * legacy behaviour (services/timerSop.service.js).
 */

const cfg = (over: Partial<TimerSopConfig> = {}): TimerSopConfig => ({
  ...DEFAULT_TIMER_SOP_CONFIG,
  enabled: true,
  dailyMinPercent: 0,
  dailyMinHours: 8,
  deficitThresholdHours: 1,
  deficitPoints: 0.1,
  overtimeThresholdHours: 1,
  overtimePoints: 0.1,
  ...over,
});

const day = (over: Partial<DayWork> = {}): DayWork => ({
  date: "2026-08-03",
  workedHours: 8,
  afterOfficeHours: 0,
  isOff: false,
  expectedHours: 8.5,
  ...over,
});

test("paused when the engine is switched off — nothing accrues", () => {
  const r = evaluateTimerSop([day({ workedHours: 0 })], cfg({ enabled: false }));
  assert.equal(r.paused, true);
  assert.equal(r.pointsDeducted, 0);
  assert.equal(r.deficitAccumHours, 0);
});

test("shortfall accumulates and each threshold crossing cuts points", () => {
  // 2h short on a single day, threshold 1h → two triggers, remainder 0.
  const r = evaluateTimerSop([day({ workedHours: 6 })], cfg());
  assert.equal(r.deficitTriggers, 2);
  assert.equal(r.pointsDeducted, 0.2);
  assert.equal(r.deficitAccumHours, 0);
});

test("the deficit remainder carries forward, not lost", () => {
  // 1.5h short → one trigger, 0.5h remainder held for next time.
  const r = evaluateTimerSop([day({ workedHours: 6.5 })], cfg());
  assert.equal(r.deficitTriggers, 1);
  assert.equal(r.pointsDeducted, 0.1);
  assert.equal(r.deficitAccumHours, 0.5);
});

test("an off day never counts toward deficit, even at zero worked", () => {
  const r = evaluateTimerSop([day({ workedHours: 0, isOff: true })], cfg());
  assert.equal(r.deficitTriggers, 0);
  assert.equal(r.pointsDeducted, 0);
});

test("overtime accumulates independently and adds points", () => {
  const r = evaluateTimerSop(
    [day({ workedHours: 8, afterOfficeHours: 2.5 })],
    cfg(),
  );
  assert.equal(r.overtimeTriggers, 2);
  assert.equal(r.pointsAdded, 0.2);
  assert.equal(r.overtimeAccumHours, 0.5);
});

test("the same day can feed both counters", () => {
  // Worked only 2h total but 1h after close: a deficit AND an overtime.
  const r = evaluateTimerSop(
    [day({ workedHours: 2, afterOfficeHours: 1 })],
    cfg(),
  );
  assert.ok(r.deficitTriggers >= 1);
  assert.equal(r.overtimeTriggers, 1);
});

test("a percentage target is measured against the day's expected span", () => {
  const c = cfg({ dailyMinPercent: 50, dailyMinHours: 99 });
  assert.equal(requiredHoursFor(day({ expectedHours: 8 }), c), 4);
});

test("today's target is a percentage of the window, and the shortfall remains", () => {
  const t = computeTodayTarget(
    {
      date: "2026-08-03",
      isOff: false,
      loginMinute: 600,
      closeMinute: 1110,
      windowHours: 8,
      workedHours: 3,
    },
    cfg({ dailyMinPercent: 90, dailyMinHours: 99 }),
  );
  assert.equal(t.targetHours, 7.2); // 90% of 8h
  assert.equal(t.remainingHours, 4.2); // 7.2 − 3
  assert.equal(t.met, false);
});

test("an off day has no target and is never a shortfall", () => {
  const t = computeTodayTarget(
    {
      date: "2026-08-02",
      isOff: true,
      loginMinute: null,
      closeMinute: 1110,
      windowHours: 0,
      workedHours: 0,
    },
    cfg(),
  );
  assert.equal(t.targetHours, 0);
  assert.equal(t.remainingHours, 0);
});

test("net points is added minus deducted", () => {
  const r = evaluateTimerSop(
    [day({ workedHours: 7, afterOfficeHours: 3 })],
    cfg(),
  );
  assert.ok(Math.abs(r.netPoints - (r.pointsAdded - r.pointsDeducted)) < 0.001);
});
