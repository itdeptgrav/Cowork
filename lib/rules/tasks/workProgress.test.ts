import assert from "node:assert/strict";
import { test } from "node:test";
import { remainderLabel, workProgress } from "./workProgress.ts";

const NOW = Date.UTC(2026, 7, 2, 12, 0, 0);
const HOUR = 3600;

test("a task inside its window is on track, and the remainder is time left", () => {
  const p = workProgress({
    budgetSecs: 3 * HOUR,
    workedSecs: HOUR,
    isRunning: true,
    nowMs: NOW,
  });
  assert.equal(p.state, "on_track");
  assert.equal(p.remainingSecs, 2 * HOUR);
  assert.equal(p.overtimeSecs, null);
  assert.equal(p.percentUsed, 33);
  assert.equal(p.isPastDue, false);
  assert.equal(remainderLabel(p.state), "Time left");
  /* Two hours of budget left, and the clock is running, so the budget runs out
     two hours from now — not three hours from when the task was assigned. */
  assert.equal(p.budgetEndsAtMs, NOW + 2 * HOUR * 1000);
});

test("the due moment passing with budget unspent is incomplete, not overtime", () => {
  /* The state legacy invented and the reason this rule is not a subtraction:
     30 minutes of work against a three-hour budget whose window has run out is
     a task that never happened, and reporting it as "overtime" would credit
     the person for the opposite. */
  const p = workProgress({
    budgetSecs: 3 * HOUR,
    workedSecs: 1800,
    pausedAtMs: NOW - 4 * HOUR * 1000,
    nowMs: NOW,
  });
  assert.equal(p.state, "incomplete");
  assert.equal(p.remainingSecs, 2.5 * HOUR);
  assert.equal(p.overtimeSecs, null);
  assert.equal(p.isPastDue, true);
  assert.equal(remainderLabel(p.state), "Still needed");
});

test("working past the budget is overtime, and the excess is the figure", () => {
  const p = workProgress({
    budgetSecs: 2 * HOUR,
    workedSecs: 2 * HOUR + 900,
    isRunning: true,
    nowMs: NOW,
  });
  assert.equal(p.state, "overtime");
  assert.equal(p.overtimeSecs, 900);
  assert.equal(p.remainingSecs, 0, "floored — a spent budget has nothing left");
  assert.equal(p.percentUsed, 100, "clamped, so the bar cannot run off its track");
  assert.equal(remainderLabel(p.state), "Overtime");
});

test("overtime is decided by the budget, before the clock is consulted", () => {
  /* Overrun while the due moment is still ahead. Checking `isPastDue` first
     would call this `on_track` and show a negative remainder as "time left". */
  const p = workProgress({
    budgetSecs: HOUR,
    workedSecs: HOUR + 60,
    isRunning: true,
    nowMs: NOW,
  });
  assert.equal(p.state, "overtime");
  assert.equal(p.isPastDue, false);
  assert.equal(p.overtimeSecs, 60);
});

test("a spent budget whose moment has passed is overdue with nothing to show", () => {
  const p = workProgress({
    budgetSecs: HOUR,
    workedSecs: HOUR,
    pausedAtMs: NOW - 2 * HOUR * 1000,
    nowMs: NOW,
  });
  assert.equal(p.state, "overdue");
  assert.equal(p.remainingSecs, 0);
  assert.equal(p.overtimeSecs, null);
  assert.equal(remainderLabel(p.state), null, "no third column to label");
});

test("no window means no budget reading, whatever the task's due date says", () => {
  const due = NOW + 6 * HOUR * 1000;
  const p = workProgress({
    budgetSecs: null,
    workedSecs: 1200,
    storedDueAtMs: due,
    nowMs: NOW,
  });
  assert.equal(p.state, "no_budget");
  assert.equal(p.budgetSecs, null);
  assert.equal(p.remainingSecs, null, "nothing to divide, so nothing is stated");
  assert.equal(p.percentUsed, null);
  assert.equal(p.workedSecs, 1200, "logged work is still real and still shown");
  assert.equal(p.budgetEndsAtMs, due, "the fixed deadline is the due moment");
  assert.equal(p.isPastDue, false);
});

test("zero is never set, not a budget of nothing", () => {
  /* The same reading `resolveTimeBudget` takes. A zero denominator would make
     `percentUsed` Infinity and put the task's bar off its track. */
  const p = workProgress({ budgetSecs: 0, workedSecs: 60, nowMs: NOW });
  assert.equal(p.state, "no_budget");
  assert.equal(p.percentUsed, null);
});

test("a paused task's due moment freezes; a running one's does not", () => {
  const paused = workProgress({
    budgetSecs: 2 * HOUR,
    workedSecs: HOUR,
    pausedAtMs: NOW - 30 * 60 * 1000,
    nowMs: NOW,
  });
  /* Stopped half an hour ago with an hour of budget left: the budget runs out
     half an hour from now, because the thirty minutes nobody worked did not
     consume any of it. */
  assert.equal(paused.budgetEndsAtMs, NOW + 30 * 60 * 1000);

  const running = workProgress({
    budgetSecs: 2 * HOUR,
    workedSecs: HOUR,
    isRunning: true,
    pausedAtMs: NOW - 5 * HOUR * 1000,
    nowMs: NOW,
  });
  assert.equal(
    running.budgetEndsAtMs,
    NOW + HOUR * 1000,
    "a live session wins over a stale pause",
  );
});

test("a paused task that was never worked falls back to its stored due date", () => {
  /* `pausedAtMs` with zero worked seconds is a session that was created and
     stopped, or a stale record. Deriving from it would move the due moment to
     "budget from whenever that happened", which is not a commitment anybody
     made. */
  const due = NOW + 8 * HOUR * 1000;
  const p = workProgress({
    budgetSecs: HOUR,
    workedSecs: 0,
    pausedAtMs: NOW - 3 * HOUR * 1000,
    storedDueAtMs: due,
    nowMs: NOW,
  });
  assert.equal(p.budgetEndsAtMs, due);
  assert.equal(p.state, "on_track");
});

test("negative and non-finite worked seconds read as zero, never as NaN", () => {
  for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const p = workProgress({ budgetSecs: HOUR, workedSecs: bad, nowMs: NOW });
    assert.equal(p.workedSecs, 0, `worked ${String(bad)}`);
    assert.equal(p.percentUsed, 0);
    assert.equal(p.remainingSecs, HOUR);
  }
});

test("the extension chain keeps both windows, so the sum can be shown", () => {
  const p = workProgress({
    budgetSecs: 7 * 60,
    originalBudgetSecs: 2 * 60,
    workedSecs: 60,
    nowMs: NOW,
  });
  assert.equal(p.budgetSecs, 420, "the window in force includes the extensions");
  assert.equal(p.originalBudgetSecs, 120, "what was first agreed survives");
  assert.equal(p.percentUsed, 14, "measured against the CURRENT window");
});
