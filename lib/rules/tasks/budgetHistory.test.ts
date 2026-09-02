import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budgetHistoryView,
  creditCause,
  deadlineMoveEntries,
  type BudgetCredit,
  type DeadlineMove,
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

/* ── Deadline moves ───────────────────────────────────────────────────────── */

/**
 * Going offline moved a deadline and the history said nothing.
 *
 * The record existed — `#compensateOneDeadline` has written a
 * `cowork_task_deadline_extensions` row on every move for a long time — and the
 * panel beside the deadline read only budget credits. A move that does not also
 * grow the budget, which is exactly what an offline span is, therefore left the
 * history reading "Nothing has been credited" directly under a date the reader
 * had just watched change.
 *
 * These pin the reading of that record. **Nothing here computes a shift**: the
 * dates come off the record, and the delta is the difference between them.
 */

function move(over: Partial<DeadlineMove> = {}): DeadlineMove {
  return {
    id: "m1",
    at: "2026-08-31T09:34:00.000Z",
    fromIso: "2026-08-31T09:42:00.000Z",
    toIso: "2026-08-31T10:02:00.000Z",
    reason: "Offline 09:14–09:34",
    automatic: true,
    ...over,
  };
}

test("a deadline move is measured from its own two instants", () => {
  /* Not from a stored delta: a row can then never claim a size that disagrees
     with the pair printed beside it. */
  const [e] = deadlineMoveEntries([move()]);
  assert.equal(e.deltaSecs, 20 * 60);
  assert.equal(e.label, "Deadline moved later");
});

test("a deadline pulled in is named as such", () => {
  /* "Moved" alone leaves a reader working the direction out from two
     timestamps, which is the one thing this panel exists to save them. */
  const [e] = deadlineMoveEntries([
    move({ fromIso: "2026-08-31T10:02:00.000Z", toIso: "2026-08-31T09:42:00.000Z" }),
  ]);
  assert.equal(e.deltaSecs, -20 * 60);
  assert.equal(e.label, "Deadline moved earlier");
});

test("a move of nothing is not listed", () => {
  /* A record whose before and after are the same instant explains nothing, and
     this is a list read for explanations. */
  assert.deepEqual(
    deadlineMoveEntries([move({ toIso: "2026-08-31T09:42:00.000Z" })]),
    [],
  );
});

test("an unreadable record is dropped rather than shown as zero", () => {
  /* Zero would read as "the deadline did not move", which is a claim. */
  assert.deepEqual(deadlineMoveEntries([move({ fromIso: "not a date" })]), []);
});

test("moves are listed oldest first, like the credits above them", () => {
  const out = deadlineMoveEntries([
    move({ id: "b", at: "2026-08-31T12:00:00.000Z" }),
    move({ id: "a", at: "2026-08-31T09:34:00.000Z" }),
  ]);
  assert.deepEqual(out.map((m) => m.id), ["a", "b"]);
});

test("the engine's own reason is carried through untouched", () => {
  /* It names the cause — "Offline", "Break", a meeting — more precisely than
     any label written in the component could. */
  const [e] = deadlineMoveEntries([move({ reason: "Break 11:00–11:30" })]);
  assert.equal(e.reason, "Break 11:00–11:30");
});

test("whether a person approved it survives the read", () => {
  /* An offline shift applies itself; an extension was granted by somebody. The
     panel says which, and cannot without this. */
  assert.equal(deadlineMoveEntries([move({ automatic: true })])[0].automatic, true);
  assert.equal(deadlineMoveEntries([move({ automatic: false })])[0].automatic, false);
});

test("budget credits and deadline moves stay separate", () => {
  /* A row reading "+ 20m" means two different things in the two lists: twenty
     minutes MORE WORK ALLOWED, or twenty minutes LATER IN THE DAY. */
  const view = budgetHistoryView({ givenSecs: 3600, currentSecs: 3600, credits: [] });
  assert.equal(view.entries.length, 0, "a deadline move leaked into the credits");
  assert.equal(deadlineMoveEntries([move()]).length, 1);
});
