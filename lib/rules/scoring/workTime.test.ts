import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketWorkByDay, liveRunSecsForDay, todayWindow } from "./workTime.ts";
import type { OfficePolicy } from "../../legacy/officePolicy.ts";
import type { WorkCommit } from "../../domain/tasks.ts";

/**
 * Real work commits → per-day work, the input the Timer SOP engine judges.
 * The date range walked is the span of real commits, so a day inside it with no
 * commit is a genuine zero-work day (a no-show, in legacy terms).
 */

const DAY = { isOff: false, inTime: "09:30", outTime: "18:30" };
const policy: OfficePolicy = {
  schedule: {
    sunday: { ...DAY, isOff: true },
    monday: DAY,
    tuesday: DAY,
    wednesday: DAY,
    thursday: DAY,
    friday: DAY,
    saturday: { ...DAY, isOff: true },
  },
  breaks: [{ name: "Lunch", start: "13:00", end: "13:30" }],
  maxTaskActionGapMinutes: 120,
  requireScreenShare: true,
  maxBreakMinutesPerDay: 60,
  updatedBy: null,
};

function wc(startISO: string, endISO: string, secs: number): WorkCommit {
  return {
    organisationId: "org-1",
    id: `wc-${startISO}`,
    taskId: "t-1",
    employeeId: "e-1",
    startedAt: startISO,
    endedAt: endISO,
    durationSecs: secs,
    message: null,
    attachmentIds: [],
    pauseReason: "manual",
  };
}

// 2026-08-03 is a Monday; 2026-08-02 a Sunday (off).
test("worked hours come from the commit duration, bucketed by day", () => {
  const days = bucketWorkByDay(
    [wc("2026-08-03T10:00:00.000Z", "2026-08-03T13:00:00.000Z", 3 * 3600)],
    policy,
  );
  assert.equal(days.length, 1);
  assert.equal(days[0].date, "2026-08-03");
  assert.equal(days[0].workedHours, 3);
  assert.equal(days[0].isOff, false);
});

test("expected hours are the office span minus breaks and the allowance", () => {
  const days = bucketWorkByDay(
    [wc("2026-08-03T10:00:00.000Z", "2026-08-03T13:00:00.000Z", 3 * 3600)],
    policy,
  );
  // 09:30–18:30 is 9h, minus a 30-min lunch, minus the 60-min daily break
  // allowance = 7.5h.
  assert.equal(days[0].expectedHours, 7.5);
});

test("the break allowance comes off the expected day as well as the breaks", () => {
  const generous = { ...policy, maxBreakMinutesPerDay: 90 };
  const days = bucketWorkByDay(
    [wc("2026-08-03T10:00:00.000Z", "2026-08-03T13:00:00.000Z", 3 * 3600)],
    generous,
  );
  // 9h span − 0.5h lunch − 1.5h allowance = 7h.
  assert.equal(days[0].expectedHours, 7);
});

test("time after office close is counted as overtime", () => {
  const days = bucketWorkByDay(
    [wc("2026-08-03T17:00:00.000Z", "2026-08-03T19:00:00.000Z", 2 * 3600)],
    policy,
  );
  // Closes 18:30; 18:30–19:00 = 0.5h after.
  assert.equal(days[0].afterOfficeHours, 0.5);
});

test("all worked time on an off day is overtime", () => {
  const days = bucketWorkByDay(
    [wc("2026-08-02T10:00:00.000Z", "2026-08-02T12:00:00.000Z", 2 * 3600)],
    policy,
  );
  assert.equal(days[0].isOff, true);
  assert.equal(days[0].afterOfficeHours, 2);
});

test("a day inside the range with no commit is a real zero-work day", () => {
  const days = bucketWorkByDay(
    [
      wc("2026-08-03T10:00:00.000Z", "2026-08-03T12:00:00.000Z", 2 * 3600),
      wc("2026-08-05T10:00:00.000Z", "2026-08-05T12:00:00.000Z", 2 * 3600),
    ],
    policy,
  );
  const midday = days.find((d) => d.date === "2026-08-04");
  assert.ok(midday, "the gap day is present");
  assert.equal(midday!.workedHours, 0);
});

test("no commits yields no days", () => {
  assert.deepEqual(bucketWorkByDay([], policy), []);
});

test("today's window runs from first login to close, minus breaks and allowance", () => {
  const w = todayWindow(
    [wc("2026-08-03T10:00:00.000Z", "2026-08-03T13:00:00.000Z", 3 * 3600)],
    policy,
    "2026-08-03",
  );
  assert.equal(w.isOff, false);
  assert.equal(w.loginMinute, 600); // 10:00
  assert.equal(w.closeMinute, 1110); // 18:30
  assert.equal(w.workedHours, 3);
  // 10:00→18:30 is 8.5h, minus a 30-min lunch, minus the 60-min allowance = 7h.
  assert.equal(w.spanHours, 8.5);
  assert.equal(w.breakHours, 0.5);
  assert.equal(w.allowanceHours, 1);
  assert.equal(w.windowHours, 7);
});

test("with no login today the window falls back to office open", () => {
  const w = todayWindow([], policy, "2026-08-03");
  assert.equal(w.loginMinute, null);
  assert.equal(w.workedHours, 0);
  // 09:30→18:30 is 9h, minus lunch, minus the allowance = 7.5h.
  assert.equal(w.windowHours, 7.5);
});

/* 2026-08-03T06:00:00Z is 11:30 IST on the 3rd; IST midnight that day is
   2026-08-02T18:30:00Z. */
const ELEVEN_THIRTY_IST = Date.parse("2026-08-03T06:00:00.000Z");

test("a running timer contributes its elapsed seconds to the day", () => {
  assert.equal(
    liveRunSecsForDay({
      startedAtRealMs: ELEVEN_THIRTY_IST - 262_000, // 4m 22s ago
      isRunning: true,
      nowRealMs: ELEVEN_THIRTY_IST,
      date: "2026-08-03",
    }),
    262,
  );
});

test("a paused session contributes nothing — its time is already committed", () => {
  assert.equal(
    liveRunSecsForDay({
      startedAtRealMs: ELEVEN_THIRTY_IST - 262_000,
      isRunning: false,
      nowRealMs: ELEVEN_THIRTY_IST,
      date: "2026-08-03",
    }),
    0,
  );
});

test("a stale run contributes nothing, so a laptop left asleep credits no time", () => {
  assert.equal(
    liveRunSecsForDay({
      startedAtRealMs: ELEVEN_THIRTY_IST - 20 * 3600 * 1000, // 20h, past the 16h bound
      isRunning: true,
      nowRealMs: ELEVEN_THIRTY_IST,
      date: "2026-08-03",
    }),
    0,
  );
});

test("a run started yesterday counts only from this IST midnight", () => {
  // Started 22:00 IST on the 2nd; now 11:30 IST on the 3rd. Only 11.5h is today.
  assert.equal(
    liveRunSecsForDay({
      startedAtRealMs: Date.parse("2026-08-02T16:30:00.000Z"),
      isRunning: true,
      nowRealMs: ELEVEN_THIRTY_IST,
      date: "2026-08-03",
    }),
    11.5 * 3600,
  );
});

test("no session at all is zero, not a crash", () => {
  assert.equal(
    liveRunSecsForDay({
      startedAtRealMs: null,
      isRunning: true,
      nowRealMs: ELEVEN_THIRTY_IST,
      date: "2026-08-03",
    }),
    0,
  );
});

test("a longer allowance takes more off, and the window never goes negative", () => {
  const generous = { ...policy, maxBreakMinutesPerDay: 90 };
  assert.equal(todayWindow([], generous, "2026-08-03").windowHours, 7); // 9 − 0.5 − 1.5

  const absurd = { ...policy, maxBreakMinutesPerDay: 24 * 60 };
  assert.equal(todayWindow([], absurd, "2026-08-03").windowHours, 0);
});
