import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultExpectedWorkingDay,
  isWorkedStatus,
  validateAttendanceRecord,
  type AttendanceRecordInput,
} from "./record.ts";

/**
 * Recording an attendance day is the write path C4 · Attendance was missing —
 * legacy only ever ingested from HR. These pin the shape the projection then
 * reads: a well-formed, calendar-anchored day where lateness only lives on a
 * day someone actually worked.
 */

const base: AttendanceRecordInput = {
  employeeId: "e-02",
  date: "2026-08-03",
  status: "present",
  lateMinutes: 20,
};

test("a well-formed present day normalises with its lateness kept", () => {
  const r = validateAttendanceRecord(base);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.lateMinutes, 20);
  assert.equal(r.value.isExpectedWorkingDay, true);
});

test("an empty subject is refused, not defaulted", () => {
  const r = validateAttendanceRecord({ ...base, employeeId: "  " });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.field, "employeeId");
});

test("a malformed date is refused", () => {
  const r = validateAttendanceRecord({ ...base, date: "03/08/2026" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.field, "date");
});

test("an unknown status is refused", () => {
  const r = validateAttendanceRecord({
    ...base,
    status: "vacation" as never,
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.field, "status");
});

test("negative lateness is refused rather than clamped silently", () => {
  const r = validateAttendanceRecord({ ...base, lateMinutes: -5 });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.field, "lateMinutes");
});

test("an absent day carries no lateness — absence is not '0 minutes late'", () => {
  const r = validateAttendanceRecord({
    ...base,
    status: "absent",
    lateMinutes: 30,
    earlyDepartureMinutes: 15,
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.lateMinutes, 0);
  assert.equal(r.value.earlyDepartureMinutes, 0);
});

test("a week-off is not an expected working day; a present day is", () => {
  assert.equal(defaultExpectedWorkingDay("week_off"), false);
  assert.equal(defaultExpectedWorkingDay("holiday"), false);
  assert.equal(defaultExpectedWorkingDay("leave"), true);
  assert.equal(defaultExpectedWorkingDay("present"), true);
});

test("only present and half days count as worked", () => {
  assert.equal(isWorkedStatus("present"), true);
  assert.equal(isWorkedStatus("half_day"), true);
  assert.equal(isWorkedStatus("leave"), false);
  assert.equal(isWorkedStatus("absent"), false);
});

test("an explicit expected-day flag overrides the status default", () => {
  const r = validateAttendanceRecord({
    ...base,
    status: "holiday",
    isExpectedWorkingDay: true,
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.isExpectedWorkingDay, true);
});
