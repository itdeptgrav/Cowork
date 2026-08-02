import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_TIMER_SOP_CONFIG,
  computeTodayTarget,
  evaluateTimerSop,
  requiredHoursFor,
  targetProgressPercent,
  withLiveRun,
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
      spanHours: 8.5,
      breakHours: 0,
      allowanceHours: 0.5,
      windowHours: 8,
      workedHours: 3,
    },
    cfg({ dailyMinPercent: 90, dailyMinHours: 99 }),
  );
  assert.equal(t.targetHours, 7.2); // 90% of 8h
  assert.equal(t.remainingHours, 4.2); // 7.2 − 3
  assert.equal(t.met, false);
});

test("the span, breaks and allowance survive to the card, so its sum adds up", () => {
  const t = computeTodayTarget(
    {
      date: "2026-08-03",
      isOff: false,
      loginMinute: 570,
      closeMinute: 1110,
      spanHours: 9,
      breakHours: 0,
      allowanceHours: 1.5,
      windowHours: 7.5,
      workedHours: 0,
    },
    cfg({ dailyMinPercent: 95, dailyMinHours: 99 }),
  );
  assert.equal(t.spanHours, 9);
  assert.equal(t.allowanceHours, 1.5);
  assert.equal(t.windowHours, 7.5); // 9 − 1.5
  assert.equal(t.targetHours, 7.13); // 95% of 7.5
});

test("an off day has no target and is never a shortfall", () => {
  const t = computeTodayTarget(
    {
      date: "2026-08-02",
      isOff: true,
      loginMinute: null,
      closeMinute: 1110,
      spanHours: 0,
      breakHours: 0,
      allowanceHours: 1.5,
      windowHours: 0,
      workedHours: 0,
    },
    cfg(),
  );
  assert.equal(t.targetHours, 0);
  assert.equal(t.remainingHours, 0);
});

const today = (over: Partial<Parameters<typeof computeTodayTarget>[0]> = {}) =>
  computeTodayTarget(
    {
      date: "2026-08-03",
      isOff: false,
      loginMinute: 600,
      closeMinute: 1110,
      spanHours: 9.5,
      breakHours: 0,
      allowanceHours: 1.5,
      windowHours: 8,
      workedHours: 0,
      ...over,
    },
    cfg({ dailyMinPercent: 0, dailyMinHours: 8 }),
  );

test("progress is worked time over today's target", () => {
  assert.equal(targetProgressPercent(today({ workedHours: 2 })), 25);
  assert.equal(targetProgressPercent(today({ workedHours: 6 })), 75);
});

test("no timer run yet reads zero, not the same as the target being met", () => {
  assert.equal(targetProgressPercent(today({ workedHours: 0 })), 0);
});

test("progress never exceeds 100, however long the timers ran", () => {
  assert.equal(targetProgressPercent(today({ workedHours: 20 })), 100);
});

test("an off day has no target to be a percentage of", () => {
  assert.equal(
    targetProgressPercent(today({ isOff: true, workedHours: 3 })),
    0,
  );
});

test("a running timer counts toward the worked total and the remainder", () => {
  const t = withLiveRun(today({ workedHours: 2 }), 15 * 60); // 15 min running
  assert.equal(t.workedHours, 2.25);
  assert.equal(t.remainingHours, 5.75); // 8h target − 2.25
  assert.equal(targetProgressPercent(t), 28); // 2.25 / 8
});

test("nothing running leaves the figures exactly as committed", () => {
  const base = today({ workedHours: 2 });
  assert.deepEqual(withLiveRun(base, 0), base);
});

test("a running timer can be what meets the target", () => {
  const t = withLiveRun(today({ workedHours: 7.9 }), 10 * 60);
  assert.equal(t.met, true);
  assert.equal(t.remainingHours, 0);
});

test("a day off is never 'met' however long a timer runs", () => {
  const t = withLiveRun(today({ isOff: true, workedHours: 0 }), 3 * 3600);
  assert.equal(t.workedHours, 3);
  assert.equal(t.met, false);
});

test("net points is added minus deducted", () => {
  const r = evaluateTimerSop(
    [day({ workedHours: 7, afterOfficeHours: 3 })],
    cfg(),
  );
  assert.ok(Math.abs(r.netPoints - (r.pointsAdded - r.pointsDeducted)) < 0.001);
});
