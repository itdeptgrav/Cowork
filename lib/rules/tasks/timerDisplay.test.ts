import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STALE_RUN_AFTER_SECS,
  displaySecs,
  isStaleRun,
  timerDisplayState,
} from "./timer.ts";

/**
 * What a timer SHOWS, derived from the stored record.
 *
 * Every state comes from `isActive` and `lastStartTime` — never from a React
 * flag, which is what let a paused task keep rendering as running and a
 * refreshed page appear to lose its time.
 */

const NOW = 1_800_000_000_000;
const ago = (secs: number) => NOW - secs * 1000;

test("no session and no banked time is simply not started", () => {
  assert.equal(timerDisplayState(null, 0, NOW), "not_started");
  assert.equal(displaySecs(null, 0, NOW), 0);
});

test("banked time with no running session is paused, not unstarted", () => {
  /* T634 exactly: 152 seconds banked, `isActive: false`. It showed nothing. */
  const s = { isActive: false, startedAtRealMs: null };
  assert.equal(timerDisplayState(s, 152, NOW), "paused");
  assert.equal(displaySecs(s, 152, NOW), 152);
});

test("a running session adds the current run to the banked total", () => {
  /* The resume case: 152 banked, one second in, reads 153 — not 1. */
  const s = { isActive: true, startedAtRealMs: ago(1) };
  assert.equal(timerDisplayState(s, 152, NOW), "running");
  assert.equal(displaySecs(s, 152, NOW), 153);
});

test("a clock left running for days is not reported as work", () => {
  /* GR0067/T623 in production. `now - lastStartTime` reports tens of hours;
     showing it would put a wrong figure in front of a manager and into every
     total built on it. */
  const s = { isActive: true, startedAtRealMs: ago(41 * 3600) };
  assert.equal(isStaleRun(s.startedAtRealMs, NOW), true);
  assert.equal(timerDisplayState(s, 152, NOW), "stale");
  assert.equal(displaySecs(s, 152, NOW), 152, "the stale run contributed time");
});

test("the banked total is never truncated by a stale run", () => {
  /* The guard decides what is fit to display. It does not edit the record, and
     work already banked is still work. */
  const s = { isActive: true, startedAtRealMs: ago(100 * 3600) };
  assert.equal(displaySecs(s, 7200, NOW), 7200);
});

test("a long but plausible working stretch is still running", () => {
  /* The threshold has to be an outer bound, not a guess at when somebody
     stopped — refusing a genuine ten-hour day would be its own bug. */
  const s = { isActive: true, startedAtRealMs: ago(10 * 3600) };
  assert.equal(timerDisplayState(s, 0, NOW), "running");
  assert.equal(displaySecs(s, 0, NOW), 10 * 3600);
});

test("the threshold is a whole working day's outer bound", () => {
  assert.equal(STALE_RUN_AFTER_SECS, 16 * 3600);
  assert.equal(isStaleRun(ago(STALE_RUN_AFTER_SECS - 1), NOW), false);
  assert.equal(isStaleRun(ago(STALE_RUN_AFTER_SECS + 1), NOW), true);
});

test("a paused session is never stale, however old", () => {
  /* Staleness is about a clock still running. A session paused last year is
     just a finished piece of work. */
  const s = { isActive: false, startedAtRealMs: ago(100 * 3600) };
  assert.equal(timerDisplayState(s, 60, NOW), "paused");
});

test("an active session with no start time does not invent a run", () => {
  const s = { isActive: true, startedAtRealMs: null };
  assert.equal(displaySecs(s, 90, NOW), 90);
});

test("the state never contradicts the record", () => {
  /* "Start" must never appear while the backend says active, and "Resume" must
     never appear while it is running — both were reported. */
  for (const banked of [0, 152]) {
    assert.notEqual(
      timerDisplayState({ isActive: true, startedAtRealMs: ago(5) }, banked, NOW),
      "not_started",
    );
    assert.notEqual(
      timerDisplayState({ isActive: true, startedAtRealMs: ago(5) }, banked, NOW),
      "paused",
    );
  }
});
