import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSpanHuman, formatDurationTimer } from "./format.ts";

/**
 * A gap between two dates, said the way somebody would say it.
 *
 * ## Why this exists
 *
 * The deadline feasibility panel showed the amount a task missed by with
 * `formatDurationTimer`, and a task twelve days late read `293:36:29`. That is
 * a correct figure nobody can picture, and its seconds came from a rounding on
 * an unrelated task — precision that means nothing standing where the reader is
 * trying to judge scale.
 *
 * Budgets and running timers keep `HH:MM:SS`, and the last test here pins that
 * so the two do not quietly converge.
 */

const M = 60;
const H = 3600;
const D = 86400;

/* ── The floor ────────────────────────────────────────────────────────────── */

test("anything under a minute is said as that, not as 0 minutes", () => {
  assert.equal(formatSpanHuman(0), "under a minute");
  assert.equal(formatSpanHuman(59), "under a minute");
  /* Exactly on the boundary is a minute, not still under one. */
  assert.equal(formatSpanHuman(60), "1 minute");
});

test("an absent or unparseable span reads as under a minute rather than NaN", () => {
  /* Templated straight into the DOM, so the failure mode to avoid is the word
     "NaN" on screen beside "to spare". */
  assert.equal(formatSpanHuman(null), "under a minute");
  assert.equal(formatSpanHuman(undefined), "under a minute");
  assert.equal(formatSpanHuman(Number.NaN), "under a minute");
});

/* ── Units ────────────────────────────────────────────────────────────────── */

test("minutes alone below an hour", () => {
  assert.equal(formatSpanHuman(45 * M), "45 minutes");
  assert.equal(formatSpanHuman(H - 1), "59 minutes");
});

test("hours and minutes below a day", () => {
  assert.equal(formatSpanHuman(H), "1 hour");
  assert.equal(formatSpanHuman(2 * H + 45 * M), "2 hours 45 minutes");
});

test("days and hours above one day", () => {
  assert.equal(formatSpanHuman(D), "1 day");
  assert.equal(formatSpanHuman(D + 18 * H), "1 day 18 hours");
  assert.equal(formatSpanHuman(2 * D + 18 * H), "2 days 18 hours");
});

test("the smaller unit is dropped when it is zero, never shown as 0", () => {
  assert.equal(formatSpanHuman(2 * D), "2 days", "not '2 days 0 hours'");
  assert.equal(formatSpanHuman(3 * H), "3 hours", "not '3 hours 0 minutes'");
});

test("two parts at most — minutes are not appended to days", () => {
  /* Two days, eighteen hours and a half-hour. The half-hour is noise at this
     scale and would make the line longer than the label beside it. */
  assert.equal(formatSpanHuman(2 * D + 18 * H + 30 * M), "2 days 18 hours");
});

test("the smaller unit floors rather than rounds, so it never overflows", () => {
  /* 1h 1m 59s. Rounding the seconds up would give "1 hour 2 minutes" for a
     span that has not reached two minutes past the hour. */
  assert.equal(formatSpanHuman(H + M + 59), "1 hour 1 minute");
  /* And the unit above never rounds into existence: 23h59m is not "1 day". */
  assert.equal(formatSpanHuman(D - M), "23 hours 59 minutes");
});

/* ── Sign ─────────────────────────────────────────────────────────────────── */

test("a negative span reads as its size, because the caller says which side", () => {
  /* The panel passes the margin straight through and writes "to spare" or
     "late" itself. A minus sign inside the figure would then read as
     "−2 days 18 hours late". */
  assert.equal(formatSpanHuman(-(2 * D + 18 * H)), "2 days 18 hours");
  assert.equal(formatSpanHuman(-45 * M), "45 minutes");
});

/* ── The reported case ────────────────────────────────────────────────────── */

test("the two figures from the report, each in the shape that suits it", () => {
  /* 293:36:29 — what the panel showed a task as missing by. */
  const late = 293 * H + 36 * M + 29;
  assert.equal(formatDurationTimer(late), "293:36:29", "the old rendering");
  assert.equal(formatSpanHuman(late), "12 days 5 hours", "the new one");

  /* And the margin the corrected verdict actually has, sixty-six hours. */
  assert.equal(formatSpanHuman(66 * H), "2 days 18 hours");
});

test("a budget keeps its clock shape — these are not interchangeable", () => {
  /* Four hours of agreed work is compared against a running timer, so it stays
     a clock reading. Only the gap between two dates gets the human shape. */
  assert.equal(formatDurationTimer(4 * H), "04:00:00");
  assert.equal(formatSpanHuman(4 * H), "4 hours");
});
