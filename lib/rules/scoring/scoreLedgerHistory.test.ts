import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeTotals,
  filterLedger,
  groupLedger,
  isFiltered,
  isReversed,
  signedPointsOf,
  totalsOf,
  type LedgerEntryLike,
} from "./scoreLedgerHistory.ts";

/**
 * The point history, ported from the old project's `OwnHistory`.
 *
 * These pin the arithmetic a person is shown about their own score, so the
 * cases that matter are the ones where a figure could mean its own opposite.
 */

function entry(over: Partial<LedgerEntryLike> = {}): LedgerEntryLike {
  return {
    id: "e1",
    component: "c3",
    effectiveDate: "2026-08-05",
    periodKey: "2026",
    sourceLabel: "Present & on time",
    reason: "Daily attendance base point (2026-08-05)",
    actorId: "system",
    actorLabel: "System",
    credit: 1,
    deduction: 0,
    disputeStatus: "none",
    ...over,
  };
}

/* ── Direction ────────────────────────────────────────────────────────────── */

test("a credit reads positive and a deduction reads negative", () => {
  /* The engine counts a penalty UPWARD — `totalDeducted` grows as things get
     worse. Shown unflipped, a bad month would look like a good one. */
  assert.equal(signedPointsOf(entry({ credit: 1, deduction: 0 })), 1);
  assert.equal(signedPointsOf(entry({ credit: 0, deduction: 2.5 })), -2.5);
});

test("a deduction of zero is not shown as minus zero", () => {
  /* `-0` formats as "−0", which reads as a deduction that happened and cost
     nothing, rather than as no deduction at all. */
  assert.equal(Object.is(signedPointsOf(entry({ credit: 0, deduction: 0 })), -0), false);
  assert.equal(signedPointsOf(entry({ credit: 0, deduction: 0 })), 0);
});

test("an upheld dispute takes the points back but keeps the row", () => {
  /**
   * Legacy resolves a dispute by marking the entry `confirmed` and dropping it
   * from the total. The row survives deliberately: somebody who remembers the
   * deduction must be able to find out what became of it, and a disappeared row
   * answers that with nothing.
   */
  const reversed = entry({ credit: 0, deduction: 4, disputeStatus: "confirmed" });
  assert.equal(isReversed(reversed), true);
  assert.equal(signedPointsOf(reversed), 0);
  assert.equal(totalsOf([reversed]).deducted, 0);
});

test("a dispute still being argued has not taken anything back", () => {
  /* Only `confirmed` reverses. A pending request must not quietly refund the
     points before anybody has decided. */
  const pending = entry({ credit: 0, deduction: 4, disputeStatus: "pending" });
  assert.equal(isReversed(pending), false);
  assert.equal(signedPointsOf(pending), -4);
});

/* ── Filtering ────────────────────────────────────────────────────────────── */

test("a component filter selects that component alone", () => {
  const rows = [entry({ id: "a", component: "c1" }), entry({ id: "b", component: "c3" })];
  const got = filterLedger(rows, { component: "c1", from: "", to: "" });
  assert.deepEqual(got.map((e) => e.id), ["a"]);
});

test("the date range includes both ends", () => {
  /* An inclusive range is what a reader means by "5th to 7th". Excluding the
     last day silently hides a day's entries. */
  const rows = [
    entry({ id: "before", effectiveDate: "2026-08-04" }),
    entry({ id: "first", effectiveDate: "2026-08-05" }),
    entry({ id: "last", effectiveDate: "2026-08-07" }),
    entry({ id: "after", effectiveDate: "2026-08-08" }),
  ];
  const got = filterLedger(rows, { component: "all", from: "2026-08-05", to: "2026-08-07" });
  assert.deepEqual(got.map((e) => e.id), ["first", "last"]);
});

test("an undated entry survives a component filter and fails a date one", () => {
  /* It cannot be shown to fall inside a range there is no way to place it in —
     but hiding it from an unfiltered view would hide points that were really
     taken. */
  const undated = entry({ id: "u", effectiveDate: "", component: "c2" });
  assert.equal(filterLedger([undated], { component: "c2", from: "", to: "" }).length, 1);
  assert.equal(
    filterLedger([undated], { component: "all", from: "2026-01-01", to: "" }).length,
    0,
  );
});

test("no filter is not mistaken for a filter", () => {
  assert.equal(isFiltered({ component: "all", from: "", to: "" }), false);
  assert.equal(isFiltered({ component: "c4", from: "", to: "" }), true);
  assert.equal(isFiltered({ component: "all", from: "2026-01-01", to: "" }), true);
});

/* ── Totals ───────────────────────────────────────────────────────────────── */

test("earned and deducted are reported apart, then netted", () => {
  /* A net of zero from nothing happening and a net of zero from ten points
     each way are different facts about somebody's month. */
  const rows = [
    entry({ id: "a", credit: 6, deduction: 0 }),
    entry({ id: "b", credit: 0, deduction: 6 }),
  ];
  assert.deepEqual(totalsOf(rows), { earned: 6, deducted: 6, net: 0 });
});

test("fractions are rounded once, at the end", () => {
  /* Rounding each entry drifts away from the figure the engine itself holds,
     and the score on screen must not disagree with the score computed. */
  const rows = [
    entry({ id: "a", credit: 0.005, deduction: 0 }),
    entry({ id: "b", credit: 0.005, deduction: 0 }),
    entry({ id: "c", credit: 0.005, deduction: 0 }),
  ];
  assert.equal(totalsOf(rows).earned, 0.02);
});

test("the summary says earned or deducted in words", () => {
  /* A sign and a colour alone is what makes a figure readable as its opposite. */
  assert.equal(describeTotals({ earned: 16.4, deducted: 0, net: 16.4 }), "+16.4 pts earned");
  assert.equal(describeTotals({ earned: 0, deducted: 3, net: -3 }), "−3.0 pts deducted");
  assert.equal(describeTotals({ earned: 2, deducted: 2, net: 0 }), "0 pts net");
});

/* ── Grouping ─────────────────────────────────────────────────────────────── */

test("history reads newest first, by year and by day", () => {
  const rows = [
    entry({ id: "old", effectiveDate: "2025-12-31", periodKey: "2025" }),
    entry({ id: "mid", effectiveDate: "2026-08-03" }),
    entry({ id: "new", effectiveDate: "2026-08-14" }),
  ];
  const years = groupLedger(rows);
  assert.deepEqual(years.map((y) => y.year), ["2026", "2025"]);
  assert.deepEqual(years[0].days.map((d) => d.date), ["2026-08-14", "2026-08-03"]);
});

test("one day's entries are collected under it with their own total", () => {
  /* The date row states the day's own damage. Reading it off the entries below
     is the arithmetic this exists to save. */
  const rows = [
    entry({ id: "a", effectiveDate: "2026-08-05", credit: 1, deduction: 0 }),
    entry({ id: "b", effectiveDate: "2026-08-05", credit: 0, deduction: 3 }),
  ];
  const [year] = groupLedger(rows);
  assert.equal(year.days.length, 1);
  assert.equal(year.days[0].entries.length, 2);
  assert.deepEqual(year.days[0].totals, { earned: 1, deducted: 3, net: -2 });
});

test("undated entries sort last rather than first", () => {
  /* An empty string sorts before every real date, so the ordering has to lift
     the empty case out — otherwise undated entries head the whole page. */
  const rows = [
    entry({ id: "dated", effectiveDate: "2026-08-05" }),
    entry({ id: "undated", effectiveDate: "", periodKey: "2026" }),
  ];
  const [year] = groupLedger(rows);
  assert.deepEqual(year.days.map((d) => d.date), ["2026-08-05", ""]);
});

test("an entry with no filing year is placed by its own date", () => {
  /* Rather than filed under "" and sorted to the bottom of the page, away from
     the entries it happened alongside. */
  const [year] = groupLedger([entry({ periodKey: "", effectiveDate: "2026-08-05" })]);
  assert.equal(year.year, "2026");
});

test("the year total is the sum of its days", () => {
  const rows = [
    entry({ id: "a", effectiveDate: "2026-08-05", credit: 4, deduction: 0 }),
    entry({ id: "b", effectiveDate: "2026-08-06", credit: 0, deduction: 1.5 }),
  ];
  const [year] = groupLedger(rows);
  assert.deepEqual(year.totals, { earned: 4, deducted: 1.5, net: 2.5 });
});
