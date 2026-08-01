import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { absenceCreditMs, workingMsBetween } from "./workingTime.ts";
import type { OfficePolicy } from "../../legacy/officePolicy.ts";

/**
 * Overnight was free time.
 *
 * Two comments in `duty.ts` said "the caller bounds it to office hours". No
 * caller did — the raw wall-clock absence was credited, so going offline at
 * 18:00 and returning at 10:00 moved every active deadline sixteen hours.
 */

const DAY = { isOff: false, inTime: "09:30", outTime: "18:00" };
const policy = (over: Partial<OfficePolicy> = {}): OfficePolicy =>
  ({
    schedule: {
      sunday: { ...DAY, isOff: true },
      monday: DAY, tuesday: DAY, wednesday: DAY, thursday: DAY, friday: DAY,
      saturday: { ...DAY, isOff: true },
    },
    breaks: [],
    maxBreakMinutesPerDay: 60,
    maxTaskActionGapMinutes: 120,
    updatedBy: null,
    ...over,
  }) as OfficePolicy;

/** An IST wall-clock instant. 2026-08-03 is a Monday. */
const ist = (date: string, time: string) =>
  Date.parse(`${date}T${time}:00.000+05:30`);
const mins = (ms: number) => Math.round(ms / 60_000);

test("time inside the working day counts in full", () => {
  assert.equal(
    mins(workingMsBetween(ist("2026-08-03", "15:00"), ist("2026-08-03", "15:30"), policy())),
    30,
  );
});

test("overnight credits only the morning, not the night", () => {
  /* The bug, in one assertion. 18:00 → 10:00 is sixteen hours of wall clock and
     thirty minutes of working time. */
  assert.equal(
    mins(workingMsBetween(ist("2026-08-03", "18:00"), ist("2026-08-04", "10:00"), policy())),
    30,
  );
});

test("a weekend contributes nothing, with no special case for weekends", () => {
  /* Friday evening to Monday morning is the same thirty minutes — the days off
     simply have no working window. */
  assert.equal(
    mins(workingMsBetween(ist("2026-08-07", "18:00"), ist("2026-08-10", "10:00"), policy())),
    30,
  );
});

test("arriving late is measurable from the day opening, with nothing stamped", () => {
  /* Why this also fixes the never-came-online case: the span is derived from
     the calendar, so there is no stamp anybody had to write in advance. */
  assert.equal(
    mins(workingMsBetween(ist("2026-08-04", "09:30"), ist("2026-08-04", "10:00"), policy())),
    30,
  );
});

test("an absence entirely outside office hours credits nothing", () => {
  assert.equal(
    mins(workingMsBetween(ist("2026-08-03", "20:00"), ist("2026-08-03", "22:00"), policy())),
    0,
  );
});

test("an absence spanning a recurring break does not credit the break", () => {
  /* Lunch is not working time. An absence over it must not be paid for it. */
  const withLunch = policy({
    breaks: [{ name: "Lunch", start: "13:00", end: "14:00" }],
  });
  assert.equal(
    mins(workingMsBetween(ist("2026-08-03", "12:30"), ist("2026-08-03", "15:00"), withLunch)),
    90,
  );
});

test("a break only partly overlapped is only partly deducted", () => {
  const withLunch = policy({
    breaks: [{ name: "Lunch", start: "13:00", end: "14:00" }],
  });
  assert.equal(
    mins(workingMsBetween(ist("2026-08-03", "13:30"), ist("2026-08-03", "14:30"), withLunch)),
    30,
  );
});

test("a backwards or zero span is nothing, never negative", () => {
  assert.equal(workingMsBetween(ist("2026-08-03", "15:00"), ist("2026-08-03", "15:00"), policy()), 0);
  assert.equal(workingMsBetween(ist("2026-08-03", "16:00"), ist("2026-08-03", "15:00"), policy()), 0);
});

test("a missing policy credits the raw span rather than silently zeroing it", () => {
  /* The opposite failure, and the quieter one: deleting somebody's credit
     because a schedule was not configured. The caller logs it. */
  const raw = absenceCreditMs({
    fromMs: ist("2026-08-03", "15:00"),
    toMs: ist("2026-08-03", "15:30"),
    policy: null,
  });
  assert.equal(mins(raw), 30);
});

test("the repository bounds the offline span before crediting it", () => {
  /* Asserted against the source: the defect was a call site passing a raw span,
     which no test of the arithmetic could have caught. */
  const src = readFileSync("lib/repositories/legacy/index.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const at = src.indexOf("async setDutyMode");
  const body = src.slice(at, at + 5000);
  assert.match(body, /absenceCreditMs\(/, "the offline span is still raw wall-clock");
  assert.doesNotMatch(
    body,
    /const returningMs = input\.mode === "online" \? offlineToCreditMs : 0;\s*const lostMs/,
    "the raw span reaches the deadline shift unbounded",
  );
});
