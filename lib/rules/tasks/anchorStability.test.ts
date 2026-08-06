import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorMsFor, officeOpenMsFor } from "./priorityDeadline.ts";

/**
 * The projection anchor must not depend on the instant it is asked for.
 *
 * `Expected completion` is recomputed on every read, from an anchor plus the
 * queue. If the anchor moves with the wall clock, the date moves with it — and
 * that is what "the due time goes up on its own" was: on a day the office
 * schedule had no opening for, the anchor was `nowMs`, so each recalculation
 * started later than the last and the date crept forward continuously.
 *
 * On a normal working day it was a fixed 09:30 and could not happen, which is
 * why the fault only appeared sometimes and looked like nothing in particular.
 */

/* A Wednesday, and the same Wednesday five hours later. */
const WED_09_00 = new Date("2026-08-05T09:00:00").getTime();
const WED_14_00 = new Date("2026-08-05T14:00:00").getTime();
const WED_17_30 = new Date("2026-08-05T17:30:00").getTime();

const OPEN = { wednesday: { inTime: "09:30" } };
const CLOSED = { wednesday: { isOff: true, inTime: "09:30" } };

test("a day OFF anchors at the same point all day — the creep is gone", () => {
  /* **The bug, in one assertion.** Three readings across eight hours of a
     non-working day must give one answer. Before this they gave three, each
     later than the last. */
  const a = officeOpenMsFor(CLOSED, WED_09_00);
  const b = officeOpenMsFor(CLOSED, WED_14_00);
  const c = officeOpenMsFor(CLOSED, WED_17_30);
  assert.equal(a, b);
  assert.equal(b, c);
});

test("an UNKNOWN schedule is stable too — no fallback follows the clock", () => {
  /* Reversed deliberately. The old rule returned `nowMs` here so a queue would
     not be scheduled into the past — but a due date that has passed means the
     work is LATE, which is information. An anchor that follows the clock is a
     deadline nobody can ever miss, because it retreats as they approach it. */
  const cases: (Record<string, { isOff?: boolean; inTime?: string }> | null)[] = [
    null,
    { monday: { inTime: "09:30" } },
    { wednesday: { inTime: "oops" } },
  ];
  for (const sched of cases) {
    assert.equal(
      officeOpenMsFor(sched, WED_09_00),
      officeOpenMsFor(sched, WED_17_30),
      "an unknown schedule still moved with the clock",
    );
  }
});

test("the fallback is midnight of that day, not some other day", () => {
  /* It must stay inside the day being asked about — walking to the next working
     period is `addWorkingSecs`'s job, and it needs a sane starting point. */
  const at = officeOpenMsFor(CLOSED, WED_14_00);
  const d = new Date(at);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getDate(), new Date(WED_14_00).getDate());
});

test("a working day is unchanged — still the office opening", () => {
  /* The ordinary path must not move. This is what dates people are scored
     against are built on. */
  const at = officeOpenMsFor(OPEN, WED_14_00);
  const d = new Date(at);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 30);
});

test("a working day is stable across the day as it always was", () => {
  assert.equal(officeOpenMsFor(OPEN, WED_09_00), officeOpenMsFor(OPEN, WED_17_30));
});

test("starting work does NOT move the anchor", () => {
  /* The reported jump: a task with no start anchored one way, and pressing play
     switched the anchor to `startedAt`, so the due date moved the moment work
     began — 17:22 became 17:20. A commitment is decided once; starting a timer
     is not one of the four things allowed to move it. */
  const openMs = officeOpenMsFor(OPEN, WED_14_00);
  const before = anchorMsFor({ leader: undefined, officeOpenMs: openMs, nowMs: WED_14_00 });
  const after = anchorMsFor({
    leader: { startedAt: new Date("2026-08-05T10:15:00").toISOString() } as never,
    officeOpenMs: openMs,
    nowMs: WED_14_00,
  });
  assert.equal(before, after);
});

test("the anchor is always the day's opening, whatever the leader did", () => {
  const openMs = officeOpenMsFor(OPEN, WED_14_00);
  for (const started of ["2026-08-01T10:15:00", "2026-08-05T10:15:00", undefined]) {
    assert.equal(
      anchorMsFor({
        leader: (started ? { startedAt: started } : undefined) as never,
        officeOpenMs: openMs,
        nowMs: WED_14_00,
      }),
      openMs,
    );
  }
});
