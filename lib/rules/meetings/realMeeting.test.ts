import assert from "node:assert/strict";
import { test } from "node:test";

import {
  attendeeCount,
  distinctAttendees,
  isRealMeeting,
  realMeetingsOnly,
} from "./realMeeting.ts";

const ended = (...ids: string[]) => ({
  endedAt: "2026-08-06T09:25:00.000Z",
  attendance: ids.map((employeeId) => ({ employeeId })),
});

test("the same person rejoining is still one person", () => {
  /**
   * **The "10 people" figure, reproduced.** T008's session on 12 Aug listed ten
   * attendance rows — Soumya and RAKESH, each leaving and rejoining five times.
   * A row is written per arrival, so counting rows counted arrivals.
   */
  const s = ended(
    "GR0045", "GR0045", "GR0000", "GR0000", "GR0000",
    "GR0045", "GR0000", "GR0045", "GR0000", "GR0045",
  );
  assert.equal(s.attendance.length, 10, "fixture no longer reproduces the bug");
  assert.equal(attendeeCount(s), 2);
  assert.deepEqual(distinctAttendees(s), ["GR0045", "GR0000"]);
});

test("first arrival order is kept — whoever opened the room leads", () => {
  assert.deepEqual(distinctAttendees(ended("B", "A", "B", "C")), ["B", "A", "C"]);
});

test("one person alone is not a meeting", () => {
  /* 327 of 366 stored sessions are exactly this: somebody opened the room and
     closed it. Listing them put a meeting on tasks where none was held. */
  assert.equal(isRealMeeting(ended("GR0108")), false);
  assert.equal(isRealMeeting(ended("GR0108", "GR0108", "GR0108")), false);
});

test("two distinct people is a meeting", () => {
  assert.equal(isRealMeeting(ended("GR0108", "GR0000")), true);
});

test("a room still open is always shown, even with one person in it", () => {
  /* Somebody is in there NOW and a second person may be seconds away. Hiding a
     live room is how two people end up waiting in it for each other. */
  assert.equal(
    isRealMeeting({ endedAt: null, attendance: [{ employeeId: "GR0108" }] }),
    true,
  );
});

test("empty and malformed attendance never count as a meeting", () => {
  assert.equal(isRealMeeting(ended()), false);
  assert.equal(
    isRealMeeting({
      endedAt: "2026-08-06T09:25:00.000Z",
      attendance: [{ employeeId: "" }, { employeeId: "  " }],
    }),
    false,
  );
});

test("filtering keeps the real ones, in order, and drops the rest", () => {
  const a = ended("GR0108", "GR0000");
  const solo = ended("GR0108");
  const b = ended("GR0045", "GR0000", "GR0045");
  assert.deepEqual(realMeetingsOnly([a, solo, b]), [a, b]);
});

test("T016's three sessions become one", () => {
  /* The reported case: 09:24 two people, 09:24 alone, 09:10 alone. Only the
     first was a meeting. */
  const t016 = [ended("GR0000", "GR0108"), ended("GR0108"), ended("GR0108")];
  assert.equal(realMeetingsOnly(t016).length, 1);
  assert.equal(attendeeCount(realMeetingsOnly(t016)[0]), 2);
});
