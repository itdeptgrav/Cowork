import assert from "node:assert/strict";
import { test } from "node:test";
import {
  breakBudget,
  breakBudgetWarning,
  breakDayKey,
  creditedBreakSecs,
  maxBreakSecs,
  usedTodaySecs,
} from "./breakMode.ts";
import type { BreakSession } from "../../domain/index.ts";

/**
 * Break Mode's daily budget, ported from legacy's close-out branch.
 *
 * The arithmetic legacy used, verbatim:
 *
 *     remainingBudget = max(0, maxSecs - usedBeforeToday)
 *     appliedSecs     = min(sessionSecs, remainingBudget)
 *
 * These tests hold the two properties that make the feature safe: the cap never
 * refuses a break, and the allowance is spent by REAL time away rather than by
 * whatever happened to be credited.
 */

const MIN = 60;

function session(over: Partial<BreakSession> = {}): BreakSession {
  return {
    organisationId: "org-test",
    id: "brk-1",
    employeeId: "soumya",
    startedAt: "2026-07-28T14:00:00.000Z",
    endedAt: "2026-07-28T14:30:00.000Z",
    durationSecs: 30 * MIN,
    appliedSecs: 30 * MIN,
    wasCapped: false,
    shiftedTaskIds: [],
    createdAt: "2026-07-28T14:30:00.000Z",
    ...over,
  };
}

/* ── The example from the brief ───────────────────────────────────────────── */

test("a 2:00→2:30 break credits thirty minutes", () => {
  const budget = breakBudget({ maxMinutesPerDay: 60, usedSecs: 0 });
  const { appliedSecs, wasCapped } = creditedBreakSecs({
    sessionSecs: 30 * MIN,
    remainingSecs: budget.remainingSecs,
  });
  assert.equal(appliedSecs, 30 * MIN);
  assert.equal(wasCapped, false);
});

/* ── The cap clamps; it never refuses ─────────────────────────────────────── */

test("a break beyond the allowance is credited only up to it", () => {
  const budget = breakBudget({ maxMinutesPerDay: 60, usedSecs: 45 * MIN });
  const { appliedSecs, wasCapped } = creditedBreakSecs({
    sessionSecs: 30 * MIN,
    remainingSecs: budget.remainingSecs,
  });
  assert.equal(appliedSecs, 15 * MIN, "only the remaining allowance");
  assert.ok(wasCapped);
});

test("an exhausted allowance credits nothing and still permits the break", () => {
  /* `creditedBreakSecs` returns a number, never a refusal. Nothing in this
     module can stop somebody stepping away — that is the whole point of the
     cap being a clamp. */
  const budget = breakBudget({ maxMinutesPerDay: 60, usedSecs: 90 * MIN });
  assert.equal(budget.remainingSecs, 0);
  const { appliedSecs, wasCapped } = creditedBreakSecs({
    sessionSecs: 20 * MIN,
    remainingSecs: budget.remainingSecs,
  });
  assert.equal(appliedSecs, 0);
  assert.ok(wasCapped);
});

test("the warning warns and never refuses", () => {
  const spent = breakBudget({ maxMinutesPerDay: 60, usedSecs: 60 * MIN });
  assert.match(breakBudgetWarning(spent) ?? "", /can still take a break/);
  const nearly = breakBudget({ maxMinutesPerDay: 60, usedSecs: 57 * MIN });
  assert.match(breakBudgetWarning(nearly) ?? "", /3 minutes/);
  const fresh = breakBudget({ maxMinutesPerDay: 60, usedSecs: 0 });
  assert.equal(breakBudgetWarning(fresh), null, "a normal day says nothing");
});

/* ── The allowance is spent by real time, not credited time ───────────────── */

test("usage sums REAL duration, so an exhausted budget stays exhausted", () => {
  /* If usage summed `appliedSecs`, a capped break would add nothing to the
     total and the person would regain allowance by taking more breaks. */
  const sessions = [
    session({ id: "a", durationSecs: 50 * MIN, appliedSecs: 50 * MIN }),
    session({ id: "b", durationSecs: 40 * MIN, appliedSecs: 10 * MIN, wasCapped: true }),
  ];
  assert.equal(
    usedTodaySecs(sessions, "soumya", "2026-07-28"),
    90 * MIN,
    "90 minutes were taken, whatever was credited",
  );
});

test("another person's breaks do not spend your allowance", () => {
  const sessions = [
    session({ id: "a", employeeId: "rakesh", durationSecs: 60 * MIN }),
  ];
  assert.equal(usedTodaySecs(sessions, "soumya", "2026-07-28"), 0);
});

test("the allowance is per day and resets", () => {
  const sessions = [
    session({ id: "yesterday", startedAt: "2026-07-27T14:00:00.000Z" }),
    session({ id: "today", startedAt: "2026-07-28T09:00:00.000Z" }),
  ];
  assert.equal(usedTodaySecs(sessions, "soumya", "2026-07-28"), 30 * MIN);
  assert.equal(breakDayKey("2026-07-28T23:59:59.000Z"), "2026-07-28");
});

/* ── Configuration ────────────────────────────────────────────────────────── */

test("an unset or nonsensical allowance falls back to legacy's sixty minutes", () => {
  for (const v of [null, 0, -5]) {
    assert.equal(maxBreakSecs(v), 60 * MIN, `${v} must fall back`);
  }
  assert.equal(maxBreakSecs(90), 90 * MIN);
});

test("a configured allowance is what bounds the credit", () => {
  const budget = breakBudget({ maxMinutesPerDay: 15, usedSecs: 0 });
  assert.equal(budget.maxSecs, 15 * MIN);
  assert.equal(
    creditedBreakSecs({ sessionSecs: 30 * MIN, remainingSecs: budget.remainingSecs })
      .appliedSecs,
    15 * MIN,
  );
});

test("remaining never goes negative", () => {
  const budget = breakBudget({ maxMinutesPerDay: 30, usedSecs: 200 * MIN });
  assert.equal(budget.remainingSecs, 0);
});

test("a zero-length break credits nothing", () => {
  assert.deepEqual(
    creditedBreakSecs({ sessionSecs: 0, remainingSecs: 3600 }),
    { appliedSecs: 0, wasCapped: false },
  );
});
