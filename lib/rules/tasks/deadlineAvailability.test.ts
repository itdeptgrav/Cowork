import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import {
  DEADLINE_EXTENDING_STATES,
  compensatedDueAt,
  deadlineExtendsFor,
  workingSecsInSpan,
  type WeekSchedule,
} from "./deadlineCompensation.ts";
import { dutyTransition } from "../presence/duty.ts";

/**
 * A deadline moves only when availability is lost, never because the clock ran.
 *
 * The bug: the deadline was projected as `now + remaining working time` and
 * recomputed on every read and every timer start, so it drifted forward while a
 * person was simply online. The rule now is `originalDueAt + Σ(lost working
 * time)`: frozen while online (timer running, paused or unstarted), moved only by
 * offline / break / emergency, and only by the part of an absence that overlaps
 * office hours.
 *
 * The five scenarios are the brief's, driven through the authority functions —
 * `dutyTransition` (which state, how long), `workingSecsInSpan` (how much of it
 * was working time) and `compensatedDueAt` (the resulting date).
 */

const H = 3_600_000;
const M = 60_000;

/* Local-time construction throughout, matching the local-time office reads, so
   the assertions do not depend on the machine's timezone. 27 Jul 2026 is a
   Monday; 31 Jul a Friday. */
const SCHEDULE: WeekSchedule = {
  monday: { isOff: false, inTime: "09:30", outTime: "18:00" },
  tuesday: { isOff: false, inTime: "09:30", outTime: "18:00" },
  wednesday: { isOff: false, inTime: "09:30", outTime: "18:00" },
  thursday: { isOff: false, inTime: "09:30", outTime: "18:00" },
  friday: { isOff: false, inTime: "09:30", outTime: "18:00" },
  saturday: { isOff: true },
  sunday: { isOff: true },
};
const at = (day: number, h: number, m = 0) =>
  new Date(2026, 6, day, h, m, 0, 0).getTime();

const DUE = "2026-07-27T12:30:00.000Z";

/* ══ Case 1 · online, time passes → frozen ═════════════════════════════════ */

test("1 · an online person's deadline does not move as time passes", () => {
  assert.equal(deadlineExtendsFor("online"), false);
  /* No lost working time → the date is exactly where it was, however long the
     clock ran. This is the whole of "do not push 18:00 → 19:00 → 20:00". */
  assert.equal(compensatedDueAt(DUE, 0), DUE);
});

/* ══ Case 2 · online + timer running → frozen ══════════════════════════════ */

test("2 · a running timer does not move the deadline", () => {
  /* There is no separate "working" state — a running or paused timer is still
     `online`, and `online` never extends. Burning the budget is the budget being
     spent, not time lost. The start path itself is asserted not to touch the
     schedule in priorityTimerCascade test 15. */
  assert.equal(deadlineExtendsFor("online"), false);
  assert.equal(
    DEADLINE_EXTENDING_STATES.includes("online"),
    false,
    "online must never be a deadline-extending state",
  );
});

/* ══ Case 3 · offline for an hour → +1h ════════════════════════════════════ */

test("3 · an hour offline extends the deadline by an hour", () => {
  /* The transition measures the span... */
  const T0 = at(27, 10, 0); // Monday 10:00, inside office hours
  const back = dutyTransition({
    previous: { mode: "offline", offlineStartedAtMs: T0 },
    next: "online",
    nowMs: T0 + 1 * H,
    connectionId: "tab-a",
  });
  assert.equal(back.offlineToCreditMs, 1 * H);

  /* ...the calendar bounds it to working time (all of it, here)... */
  const lost = workingSecsInSpan({
    startMs: T0,
    endMs: T0 + 1 * H,
    schedule: SCHEDULE,
  });
  assert.equal(lost, 3600);

  /* ...and the deadline moves by exactly that. */
  assert.equal(compensatedDueAt(DUE, lost), "2026-07-27T13:30:00.000Z");
});

/* ══ Case 4 · break for 30 minutes → +30m ══════════════════════════════════ */

test("4 · a 30-minute break extends the deadline by 30 minutes", () => {
  const T0 = at(27, 11, 0); // Monday 11:00
  const back = dutyTransition({
    previous: { mode: "break", breakStartedAtMs: T0 },
    next: "online",
    nowMs: T0 + 30 * M,
    connectionId: "tab-a",
  });
  assert.equal(back.breakToCreditMs, 30 * M);
  assert.equal(compensatedDueAt(DUE, 30 * 60), "2026-07-27T13:00:00.000Z");
});

/* ══ Case 5 · online → offline → online → resume → only offline counts ═════ */

test("5 · across a session only the offline stretch moves the deadline", () => {
  const start = at(27, 10, 0); // Monday 10:00 online
  const goneAt = at(27, 11, 0); // offline at 11:00
  const backAt = at(27, 13, 0); // online at 13:00 → 2h offline
  const laterAt = at(27, 15, 0); // still online, worked until 15:00

  /* Entering offline stamps the start; nothing before it is credited. */
  const off = dutyTransition({
    previous: { mode: "online", heartbeatAt: start },
    next: "offline",
    nowMs: goneAt,
    connectionId: null,
  });
  assert.equal(off.patch.offlineStartedAtMs, goneAt);
  assert.equal(off.offlineToCreditMs, 0, "going offline credits nothing yet");

  /* Returning online credits exactly the offline span, and only that. */
  const back = dutyTransition({
    previous: { mode: "offline", offlineStartedAtMs: goneAt },
    next: "online",
    nowMs: backAt,
    connectionId: "tab-a",
  });
  assert.equal(back.offlineToCreditMs, 2 * H);

  const lost = workingSecsInSpan({ startMs: goneAt, endMs: backAt, schedule: SCHEDULE });
  assert.equal(lost, 2 * 3600);

  /* The two online stretches — before the absence and the resume afterwards —
     add nothing. Total shift is the 2h offline, not the 5h elapsed. */
  const onlineBefore = workingSecsInSpan({ startMs: start, endMs: goneAt, schedule: SCHEDULE });
  const onlineAfter = workingSecsInSpan({ startMs: backAt, endMs: laterAt, schedule: SCHEDULE });
  // (those windows ARE working time, but online time is never fed to the credit.)
  assert.ok(onlineBefore > 0 && onlineAfter > 0);
  assert.equal(compensatedDueAt(DUE, lost), "2026-07-27T14:30:00.000Z");
});

/* ══ Working-hours bounding · the "lost WORKING time" qualifier ═════════════ */

test("offline outside office hours credits nothing", () => {
  /* Monday 20:00 → Tuesday 08:00: twelve hours away, none of it working time. */
  assert.equal(
    workingSecsInSpan({ startMs: at(27, 20), endMs: at(28, 8), schedule: SCHEDULE }),
    0,
    "an overnight offline must not move a working-time deadline",
  );
});

test("offline across a weekend credits only the working overlap", () => {
  /* Friday 31 Jul 17:00 → Monday 3 Aug 10:00. Friday 17:00–18:00 (1h) + Monday
     09:30–10:00 (30m); the weekend in between is off. */
  const fridayEvening = at(31, 17);
  const mondayMorning = new Date(2026, 7, 3, 10, 0, 0, 0).getTime();
  assert.equal(
    workingSecsInSpan({
      startMs: fridayEvening,
      endMs: mondayMorning,
      schedule: SCHEDULE,
    }),
    3600 + 1800,
  );
});

test("a null schedule credits nothing rather than everything", () => {
  assert.equal(
    workingSecsInSpan({ startMs: at(27, 10), endMs: at(27, 12), schedule: null }),
    0,
  );
});

/* ══ The states, and the mock wiring ═══════════════════════════════════════ */

test("only offline, break and emergency extend a deadline", () => {
  assert.deepEqual([...DEADLINE_EXTENDING_STATES].sort(), [
    "break",
    "emergency",
    "offline",
  ]);
  assert.equal(deadlineExtendsFor("offline"), true);
  assert.equal(deadlineExtendsFor("break"), true);
  assert.equal(deadlineExtendsFor("emergency"), true);
  assert.equal(deadlineExtendsFor("online"), false);
});

test("setDutyMode credits offline time, bounded to office hours", () => {
  const code = readFileSync("lib/repositories/mock/index.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const at0 = code.indexOf("async setDutyMode(");
  const body = code.slice(at0, code.indexOf("async heartbeatDuty(", at0));
  assert.match(body, /offlineToCreditMs/);
  assert.match(body, /workingSecsInSpan\(/);
  assert.match(body, /#creditAbsenceToDeadlines\(/);
  /* The bound is applied BEFORE the credit — the raw span never reaches the
     deadline. */
  assert.ok(
    body.indexOf("workingSecsInSpan") < body.indexOf("#creditAbsenceToDeadlines"),
    "the offline span must be bounded to office hours before it is credited",
  );
});
