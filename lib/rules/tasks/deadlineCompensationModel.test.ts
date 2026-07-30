import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type AvailabilitySpan,
  type WeekSchedule,
  availabilityLossSeconds,
  dueAtAfterAvailability,
} from "./deadlineCompensation.ts";

/**
 * A deadline moves only by the time the employee was UNAVAILABLE.
 *
 * `offline`, `break` and `emergency` are treated identically — each adds its own
 * duration — and `online` adds nothing, however long it lasts. The source of
 * truth is `availabilityLossSeconds`, not elapsed time, so a refresh, a
 * heartbeat, presence duration or a running timer never move the date.
 *
 * The five scenarios are the brief's. All spans sit inside office hours, so the
 * working-hours bound leaves each duration whole and the totals are the plain
 * sums the brief gives.
 */

const M = 60;
/* 27 Jul 2026 is a Monday; office 09:30–18:00 covers every span below. */
const SCHEDULE: WeekSchedule = {
  monday: { isOff: false, inTime: "09:30", outTime: "18:00" },
  tuesday: { isOff: false, inTime: "09:30", outTime: "18:00" },
  wednesday: { isOff: false, inTime: "09:30", outTime: "18:00" },
  thursday: { isOff: false, inTime: "09:30", outTime: "18:00" },
  friday: { isOff: false, inTime: "09:30", outTime: "18:00" },
  saturday: { isOff: true },
  sunday: { isOff: true },
};
const at = (h: number, m = 0) => new Date(2026, 6, 27, h, m, 0, 0).getTime();
const span = (mode: AvailabilitySpan["mode"], from: [number, number], to: [number, number]): AvailabilitySpan => ({
  mode,
  startMs: at(from[0], from[1]),
  endMs: at(to[0], to[1]),
});
const loss = (spans: AvailabilitySpan[]) => availabilityLossSeconds(spans, SCHEDULE);

const DUE = "2026-07-27T12:00:00.000Z";

/* ══ Test 1 · offline compensation ═════════════════════════════════════════ */

test("1 · 30 minutes offline adds 30 minutes", () => {
  const spans = [span("offline", [10, 30], [11, 0])];
  assert.equal(loss(spans), 30 * M);
  assert.equal(
    dueAtAfterAvailability({ originalDueAtIso: DUE, spans, schedule: SCHEDULE }),
    "2026-07-27T12:30:00.000Z",
  );
});

/* ══ Test 2 · break compensation ═══════════════════════════════════════════ */

test("2 · a 45-minute break adds 45 minutes", () => {
  const spans = [span("break", [14, 0], [14, 45])];
  assert.equal(loss(spans), 45 * M);
  assert.equal(
    dueAtAfterAvailability({ originalDueAtIso: DUE, spans, schedule: SCHEDULE }),
    "2026-07-27T12:45:00.000Z",
  );
});

/* ══ Test 3 · emergency compensation ═══════════════════════════════════════ */

test("3 · a 20-minute emergency adds 20 minutes", () => {
  const spans = [span("emergency", [15, 0], [15, 20])];
  assert.equal(loss(spans), 20 * M);
  assert.equal(
    dueAtAfterAvailability({ originalDueAtIso: DUE, spans, schedule: SCHEDULE }),
    "2026-07-27T12:20:00.000Z",
  );
});

/* ══ Test 4 · online time adds nothing ═════════════════════════════════════ */

test("4 · five hours online adds nothing", () => {
  const spans = [span("online", [10, 0], [15, 0])];
  assert.equal(loss(spans), 0);
  assert.equal(
    dueAtAfterAvailability({ originalDueAtIso: DUE, spans, schedule: SCHEDULE }),
    DUE,
    "an online stretch must leave the deadline exactly where it was",
  );
});

/* ══ Test 5 · multiple interruptions sum, online excluded ══════════════════ */

test("5 · offline 20 + online 60 + break 30 + emergency 10 = 60 minutes", () => {
  const spans = [
    span("offline", [10, 0], [10, 20]), // 20m
    span("online", [10, 20], [11, 20]), // 60m — contributes nothing
    span("break", [11, 20], [11, 50]), // 30m
    span("emergency", [11, 50], [12, 0]), // 10m
  ];
  assert.equal(loss(spans), (20 + 30 + 10) * M);
  assert.equal(
    dueAtAfterAvailability({ originalDueAtIso: DUE, spans, schedule: SCHEDULE }),
    "2026-07-27T13:00:00.000Z",
  );
});

/* ══ The three states are treated identically ══════════════════════════════ */

test("offline, break and emergency compensate identically", () => {
  const window: [[number, number], [number, number]] = [[10, 0], [10, 30]];
  const off = loss([span("offline", window[0], window[1])]);
  const brk = loss([span("break", window[0], window[1])]);
  const eme = loss([span("emergency", window[0], window[1])]);
  assert.equal(off, 30 * M);
  assert.equal(brk, off, "break must compensate the same as offline");
  assert.equal(eme, off, "emergency must compensate the same as offline");
});

test("an empty history and a null schedule both add nothing", () => {
  assert.equal(availabilityLossSeconds([], SCHEDULE), 0);
  assert.equal(
    availabilityLossSeconds([span("offline", [10, 0], [11, 0])], null),
    0,
    "an unknown calendar must not move a scored deadline",
  );
});
