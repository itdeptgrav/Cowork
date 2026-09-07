import assert from "node:assert/strict";
import { test } from "node:test";

import { dayBreakLabel, needsDayBreak } from "./dayBreak.ts";

/**
 * Date separators, decided against the same calendar as everything else.
 *
 * The trap this exists to avoid is quiet: a chat that decides days with
 * `toDateString()` uses the READER'S timezone, so a message sent at 05:00 IST
 * lands on the previous day for anybody whose machine is on UTC — which is most
 * rented servers and plenty of laptops. The separator would then disagree with
 * the same person's timesheet, which uses `istDayKey`.
 */

/* 12 August 2026, 09:00 IST — chosen so the same instant is 03:30 UTC, i.e. a
   different calendar day in UTC. Every case below would break under a naive
   local-timezone comparison. */
const AUG12_0900_IST = Date.parse("2026-08-12T03:30:00.000Z");
const AUG12_2330_IST = Date.parse("2026-08-12T18:00:00.000Z");
const AUG13_0030_IST = Date.parse("2026-08-12T19:00:00.000Z");
const DAY = 86_400_000;

const at = (ms: number) => ({ createdAt: new Date(ms).toISOString() });

/* ── Where a separator goes ──────────────────────────────────────────────── */

test("a thread opens with the day it starts on", () => {
  /* Without it the reader has to work out whether the top of the list is today
     or three weeks ago. */
  assert.equal(needsDayBreak([at(AUG12_0900_IST)], 0), true);
});

test("no separator between two messages on the same day", () => {
  const list = [at(AUG12_0900_IST), at(AUG12_2330_IST)];
  assert.equal(needsDayBreak(list, 1), false);
});

test("a separator where the IST day turns, even inside one UTC day", () => {
  /**
   * The case that catches a wrong timezone. 23:30 and 00:30 IST are 45 minutes
   * apart and are DIFFERENT days — but both fall inside 12 August in UTC, so a
   * UTC or local comparison puts no separator between them.
   */
  const list = [at(AUG12_2330_IST), at(AUG13_0030_IST)];
  assert.equal(needsDayBreak(list, 1), true, "the IST midnight was missed");
});

test("an index outside the list asks for nothing", () => {
  const list = [at(AUG12_0900_IST)];
  assert.equal(needsDayBreak(list, -1), false);
  assert.equal(needsDayBreak(list, 1), false);
  assert.equal(needsDayBreak([], 0), false);
});

test("a numeric timestamp works, so a LiveKit message can be laid out too", () => {
  /* LiveKit's ChatMessage carries a number, not an ISO string. */
  const list = [{ createdAt: AUG12_2330_IST }, { createdAt: AUG13_0030_IST }];
  assert.equal(needsDayBreak(list, 1), true);
});

test("one unreadable timestamp does not separate everything after it", () => {
  /* Reading as day zero keeps the damage to a single wrong separator rather
     than putting one between every pair of messages that follows. */
  const list = [at(AUG12_0900_IST), { createdAt: "not a date" }, at(AUG12_2330_IST)];
  assert.equal(needsDayBreak(list, 1), true);
  assert.equal(needsDayBreak(list, 2), true);
  /* And two broken ones in a row agree with each other. */
  assert.equal(
    needsDayBreak([{ createdAt: "x" }, { createdAt: "y" }], 1),
    false,
  );
});

/* ── What it reads ───────────────────────────────────────────────────────── */

test("today and yesterday are named rather than dated", () => {
  const now = AUG13_0030_IST;
  assert.equal(dayBreakLabel(AUG13_0030_IST, now), "Today");
  assert.equal(dayBreakLabel(AUG12_0900_IST, now), "Yesterday");
});

test("yesterday is the previous IST day, not 24 hours ago", () => {
  /* At 00:30 IST on the 13th, a message from 09:00 IST on the 12th is 15.5
     hours old — but it is still Yesterday, and a 24-hour subtraction alone
     would call it Today. */
  const now = AUG13_0030_IST;
  assert.equal(dayBreakLabel(now - 15.5 * 3_600_000, now), "Yesterday");
});

test("an older day in this year is written without the year", () => {
  const now = AUG12_0900_IST + 30 * DAY;
  assert.equal(dayBreakLabel(AUG12_0900_IST, now), "12 August");
});

test("a day in another year carries the year, so it cannot be misread", () => {
  const now = AUG12_0900_IST + 400 * DAY;
  assert.equal(dayBreakLabel(AUG12_0900_IST, now), "12 August 2026");
});

test("the label is built from the IST day the separator was placed at", () => {
  /**
   * 23:30 IST on the 12th is 18:00 UTC on the 12th; 00:30 IST on the 13th is
   * 19:00 UTC on the SAME UTC day. If the label were formatted from the raw
   * instant in another timezone, the second separator would read "12 August"
   * directly under the first one.
   */
  const now = AUG13_0030_IST + 10 * DAY;
  assert.equal(dayBreakLabel(AUG12_2330_IST, now), "12 August");
  assert.equal(dayBreakLabel(AUG13_0030_IST, now), "13 August");
});

test("now is passed in, never read", () => {
  /* So a list renders identically in a test and on screen, and so no component
     reads the clock during a render. */
  /* The SAME message instant, read against three different "now"s: it is Today
     on the day, Yesterday the day after, and a written date beyond that. The
     message never moves — only the clock does. */
  const fixed = AUG12_0900_IST;
  assert.equal(dayBreakLabel(fixed, fixed), "Today");
  assert.equal(dayBreakLabel(fixed, fixed + DAY), "Yesterday");
  assert.equal(dayBreakLabel(fixed, fixed + 2 * DAY), "12 August");
});
