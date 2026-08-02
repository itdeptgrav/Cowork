import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketWorkByDay, todayWindow } from "./workTime.ts";
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

test("expected hours are the office span minus breaks", () => {
  const days = bucketWorkByDay(
    [wc("2026-08-03T10:00:00.000Z", "2026-08-03T13:00:00.000Z", 3 * 3600)],
    policy,
  );
  // 09:30–18:30 is 9h, minus a 30-min lunch = 8.5h.
  assert.equal(days[0].expectedHours, 8.5);
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

test("today's window runs from first login to close, minus breaks", () => {
  const w = todayWindow(
    [wc("2026-08-03T10:00:00.000Z", "2026-08-03T13:00:00.000Z", 3 * 3600)],
    policy,
    "2026-08-03",
  );
  assert.equal(w.isOff, false);
  assert.equal(w.loginMinute, 600); // 10:00
  assert.equal(w.closeMinute, 1110); // 18:30
  assert.equal(w.workedHours, 3);
  // 10:00→18:30 is 8.5h, minus a 30-min lunch = 8h.
  assert.equal(w.windowHours, 8);
});

test("with no login today the window falls back to office open", () => {
  const w = todayWindow([], policy, "2026-08-03");
  assert.equal(w.loginMinute, null);
  assert.equal(w.workedHours, 0);
  // 09:30→18:30 is 9h, minus lunch = 8.5h.
  assert.equal(w.windowHours, 8.5);
});
