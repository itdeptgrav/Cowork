import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budgetHistoryView,
  creditCause,
  type BudgetCredit,
} from "./budgetHistory.ts";

const credit = (over: Partial<BudgetCredit> = {}): BudgetCredit => ({
  id: "c1",
  at: "2026-08-14T04:00:00.000Z",
  previousSecs: 32400,
  newSecs: 33600,
  reason: "Time credited back — break 20m",
  byEmployeeId: "GR0108",
  ...over,
});

/* ── Classifying the cause ────────────────────────────────────────────────── */

test("the engine's own reason strings classify", () => {
  assert.equal(creditCause("Meeting time — 5m on T013"), "meeting");
  assert.equal(creditCause("Emergency approved (30m) — hospital"), "emergency");
  assert.equal(creditCause("Time credited back — break 20m"), "break");
  assert.equal(creditCause("Time credited back — offline 5m"), "offline");
  assert.equal(creditCause("Extension granted"), "extension");
  assert.equal(creditCause("Time credited back"), "other");
});

test("a span crediting both break and offline reads as break", () => {
  /* One row cannot be two causes. The reason line still names both. */
  assert.equal(
    creditCause("Time credited back — break 20m + offline 5m"),
    "break",
  );
});

test("classification is case-insensitive", () => {
  assert.equal(creditCause("MEETING TIME — 5m"), "meeting");
});

/* ── The account ──────────────────────────────────────────────────────────── */

test("given plus credits equals current, and the account is complete", () => {
  const v = budgetHistoryView({
    givenSecs: 32400,
    currentSecs: 34864,
    credits: [credit({ previousSecs: 32400, newSecs: 34864 })],
  });
  assert.equal(v.creditedSecs, 2464);
  assert.equal(v.unaccountedSecs, 0);
  assert.equal(v.complete, true);
});

test("credit that has no record shows as unaccounted", () => {
  /* T013: given 9h, now 10:26:53, nothing recorded. */
  const v = budgetHistoryView({
    givenSecs: 32400,
    currentSecs: 37613,
    credits: [],
  });
  assert.equal(v.creditedSecs, 0);
  assert.equal(v.unaccountedSecs, 5213);
  assert.equal(v.complete, false);
});

test("a partial record leaves only the remainder unaccounted", () => {
  const v = budgetHistoryView({
    givenSecs: 32400,
    currentSecs: 37613,
    credits: [credit({ previousSecs: 32400, newSecs: 34864 })],
  });
  assert.equal(v.creditedSecs, 2464);
  assert.equal(v.unaccountedSecs, 2749);
});

test("entries run oldest first whatever order they arrive in", () => {
  const v = budgetHistoryView({
    givenSecs: 32400,
    currentSecs: 37613,
    credits: [
      credit({ id: "b", at: "2026-08-14T06:00:00.000Z", previousSecs: 34864, newSecs: 37613 }),
      credit({ id: "a", at: "2026-08-14T04:00:00.000Z", previousSecs: 32400, newSecs: 34864 }),
    ],
  });
  assert.deepEqual(v.entries.map((e) => e.id), ["a", "b"]);
  assert.equal(v.unaccountedSecs, 0);
});

test("the delta comes from the record's own before and after", () => {
  const v = budgetHistoryView({
    givenSecs: 100,
    currentSecs: 400,
    credits: [credit({ previousSecs: 100, newSecs: 400 })],
  });
  assert.equal(v.entries[0].deltaSecs, 300);
});

test("a zero-second credit is dropped rather than listed", () => {
  const v = budgetHistoryView({
    givenSecs: 32400,
    currentSecs: 32400,
    credits: [credit({ previousSecs: 32400, newSecs: 32400 })],
  });
  assert.equal(v.entries.length, 0);
  assert.equal(v.complete, true);
});

test("a credit that reduced the budget is not listed as growth", () => {
  const v = budgetHistoryView({
    givenSecs: 32400,
    currentSecs: 32400,
    credits: [credit({ previousSecs: 32400, newSecs: 30000 })],
  });
  assert.equal(v.entries.length, 0);
});

test("unaccounted never goes negative", () => {
  /* Credits recorded that exceed the gap — a `given` written late. Reporting a
     negative would read as the product owing somebody time. */
  const v = budgetHistoryView({
    givenSecs: 32400,
    currentSecs: 32400,
    credits: [credit({ previousSecs: 32400, newSecs: 36000 })],
  });
  assert.equal(v.unaccountedSecs, 0);
});

test("no given figure means the account cannot be called complete", () => {
  const v = budgetHistoryView({ givenSecs: 0, currentSecs: 37613, credits: [] });
  assert.equal(v.complete, false);
  assert.equal(v.unaccountedSecs, 37613);
});

test("a malformed record does not throw or poison the total", () => {
  const v = budgetHistoryView({
    givenSecs: 32400,
    currentSecs: 34864,
    credits: [
      credit({ id: "bad", previousSecs: Number.NaN, newSecs: Number.NaN }),
      credit({ id: "ok", previousSecs: 32400, newSecs: 34864 }),
    ],
  });
  assert.deepEqual(v.entries.map((e) => e.id), ["ok"]);
  assert.equal(v.creditedSecs, 2464);
});

test("each entry carries a label a reader can act on", () => {
  const v = budgetHistoryView({
    givenSecs: 32400,
    currentSecs: 34864,
    credits: [credit({ reason: "Meeting time — 5m on T013", newSecs: 34864 })],
  });
  assert.equal(v.entries[0].label, "Meeting attended");
  assert.equal(v.entries[0].reason, "Meeting time — 5m on T013");
});
