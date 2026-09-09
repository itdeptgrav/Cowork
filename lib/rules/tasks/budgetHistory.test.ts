import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budgetHistoryView,
  creditCause,
  deadlineMoveEntries,
  deadlineTimelineChains,
  extensionCredits,
  type BudgetCredit,
  type DeadlineMove,
  type DeadlineMoveEntry,
  type ExtensionCreditSource,
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

/* ── deadlineTimelineChains ───────────────────────────────────────────────── */

function entry(over: Partial<DeadlineMoveEntry> = {}): DeadlineMoveEntry {
  const base = move(over);
  return {
    ...base,
    deltaSecs: Math.round(
      (Date.parse(base.toIso) - Date.parse(base.fromIso)) / 1000,
    ),
    label: "Deadline moved later",
    ...over,
  };
}

test("two moves that actually connect become one staircase", () => {
  /* The exact shape in the report: one deadline moved by an offline credit,
     then moved again by a break credit, the second picking up exactly where
     the first left off. */
  const a = entry({
    id: "a",
    fromIso: "2026-08-24T08:24:00.000Z", // 13:54 IST
    toIso: "2026-08-24T09:33:00.000Z", // 15:03 IST
  });
  const b = entry({
    id: "b",
    fromIso: "2026-08-24T09:33:00.000Z", // 15:03 IST — picks up exactly here
    toIso: "2026-08-24T10:08:00.000Z", // 15:38 IST
  });
  const chains = deadlineTimelineChains([a, b]);
  assert.equal(chains.length, 1, "two connected moves were drawn as two staircases");
  assert.deepEqual(chains[0].moves.map((m) => m.id), ["a", "b"]);
});

test("moves that do NOT actually connect are never claimed to", () => {
  /* Something moved the deadline between these two credited moves that this
     record does not explain — a manual edit, a path #compensateOneDeadline
     does not read from. Drawing one continuous line through the gap would
     assert a connection the data does not have. */
  const a = entry({ id: "a", fromIso: "2026-08-24T08:24:00.000Z", toIso: "2026-08-24T09:33:00.000Z" });
  const b = entry({ id: "b", fromIso: "2026-08-24T10:00:00.000Z", toIso: "2026-08-24T10:35:00.000Z" });
  const chains = deadlineTimelineChains([a, b]);
  assert.equal(chains.length, 2, "a gap between two moves was silently bridged");
  assert.deepEqual(chains[0].moves.map((m) => m.id), ["a"]);
  assert.deepEqual(chains[1].moves.map((m) => m.id), ["b"]);
});

test("a single move is its own one-step chain", () => {
  const chains = deadlineTimelineChains([entry({ id: "solo" })]);
  assert.equal(chains.length, 1);
  assert.equal(chains[0].moves.length, 1);
});

test("no moves at all is no chains, not an error", () => {
  assert.deepEqual(deadlineTimelineChains([]), []);
});

test("three moves in a row stay one chain, not one per pair", () => {
  const a = entry({ id: "a", fromIso: "2026-08-24T08:00:00.000Z", toIso: "2026-08-24T08:30:00.000Z" });
  const b = entry({ id: "b", fromIso: "2026-08-24T08:30:00.000Z", toIso: "2026-08-24T09:00:00.000Z" });
  const c = entry({ id: "c", fromIso: "2026-08-24T09:00:00.000Z", toIso: "2026-08-24T09:15:00.000Z" });
  const chains = deadlineTimelineChains([a, b, c]);
  assert.equal(chains.length, 1);
  assert.deepEqual(chains[0].moves.map((m) => m.id), ["a", "b", "c"]);
});

test("connection is judged on the real instant, not the string", () => {
  /* Two ISO strings for the same instant, written with a different offset, are
     the same moment and must still be recognised as connected. */
  const a = entry({
    id: "a",
    fromIso: "2026-08-24T08:24:00.000Z",
    toIso: "2026-08-24T09:33:00.000Z",
  });
  const b = entry({
    id: "b",
    fromIso: "2026-08-24T15:03:00.000+05:30", // same instant as a's toIso
    toIso: "2026-08-24T15:38:00.000+05:30",
  });
  assert.equal(deadlineTimelineChains([a, b]).length, 1);
});

/* ── A granted extension is a credit, named from its own record ─────────── */

/**
 * The budget grows when a manager approves an extension. Nothing wrote a
 * credit receipt for that until recently, so the panel reported the
 * difference as "Credited earlier — applied before this history was kept, so
 * the cause was not recorded". True of the receipt, false of the event: the
 * extension request was in `cowork_task_budget_extensions` the whole time with
 * its before, after, approver and decision date on it.
 *
 * Reported as "it should show what +30 reason is, extension".
 */
const ext = (over: Partial<ExtensionCreditSource> = {}): ExtensionCreditSource => ({
  id: "x1",
  status: "accepted",
  previousBudgetSecs: 7200,
  newBudgetSecs: 9000,
  approvedSecs: null,
  approverId: "GR0000",
  approverName: "Rakesh Sahoo",
  approvedAt: "2026-09-09T09:12:14.364Z",
  confirmedAt: null,
  createdAt: "2026-09-09T09:10:00.000Z",
  ...over,
});

test("a granted extension becomes a credit that names itself", () => {
  const [c] = extensionCredits([ext()]);
  assert.equal(c.previousSecs, 7200);
  assert.equal(c.newSecs, 9000);
  assert.equal(c.reason, "Extension approved by Rakesh Sahoo.");
  assert.equal(c.at, "2026-09-09T09:12:14.364Z");
  /* And the panel classifies it from that sentence, which is the whole
     reason the wording matters. */
  assert.equal(creditCause(c.reason), "extension");
});

test("the delta comes from the record's own before/after pair", () => {
  /* Not from `requestedAdditionalSecs`: what was ASKED for and what was
     GRANTED are different numbers, and only one of them moved the budget. */
  const view = budgetHistoryView({
    givenSecs: 7200,
    currentSecs: 9000,
    credits: extensionCredits([ext()]),
  });
  assert.equal(view.entries.length, 1);
  assert.equal(view.entries[0].deltaSecs, 1800);
  assert.equal(view.entries[0].label, "Extension granted");
  /* The account balances, so the panel stops saying the cause is unknown. */
  assert.equal(view.unaccountedSecs, 0);
  assert.equal(view.complete, true);
});

test("only a granted extension counts — asking is not receiving", () => {
  /* `pending` is somebody asking, `rejected` is an answer of no, and
     `counter_proposed` is a different figure still being argued. None of the
     three moved a budget, and listing them would credit time nobody gave. */
  for (const status of ["pending", "rejected", "counter_proposed", ""]) {
    assert.deepEqual(extensionCredits([ext({ status })]), [], status || "(blank)");
  }
  for (const status of ["approved", "accepted"]) {
    assert.equal(extensionCredits([ext({ status })]).length, 1, status);
  }
});

test("a real receipt for the same approval wins, and is not doubled", () => {
  /* Once the engine writes a receipt, both records describe one event.
     Listing both would double the credit and show one grant twice. */
  const receipt = credit({
    id: "r1",
    previousSecs: 7200,
    newSecs: 9000,
    reason: "Extension approved by Rakesh",
  });
  const merged = [receipt].concat(extensionCredits([ext()], [receipt]));
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "r1");

  const view = budgetHistoryView({ givenSecs: 7200, currentSecs: 9000, credits: merged });
  assert.equal(view.creditedSecs, 1800);
});

test("an unrelated credit does not suppress the extension", () => {
  /* The dedupe keys on the RESULTING budget, so a break credited back to a
     different figure must not hide a real extension. */
  const brk = credit({ id: "b1", previousSecs: 7200, newSecs: 7500 });
  const derived = extensionCredits([ext({ previousBudgetSecs: 7500, newBudgetSecs: 9300 })], [brk]);
  assert.equal(derived.length, 1);
  assert.equal(derived[0].newSecs, 9300);
});

test("a record with no decision date, or no growth, is not a credit", () => {
  /* A row with no date cannot be placed in the account at all, and one that
     did not raise the budget is not a credit — `budgetHistoryView` drops the
     second kind too, and dropping it here keeps the dedupe honest. */
  assert.deepEqual(
    extensionCredits([ext({ approvedAt: null, confirmedAt: null, createdAt: null })]),
    [],
  );
  assert.deepEqual(extensionCredits([ext({ newBudgetSecs: 7200 })]), []);
});

test("the credit is what was GRANTED, never what was asked for", () => {
  /**
   * `newBudgetSecs` is the total the REQUEST proposed, and it is left
   * standing when the manager grants something else — the answer goes to
   * `approvedSecs`, which is the approved TOTAL window rather than a delta.
   * These are the numbers off a live record.
   *
   * Reading the request first credited twenty minutes for a five-minute
   * grant, so four rows of a 2h budget read +30m, +10m, +20m, +20m under a
   * total of 2h 50m — an account that did not add up to the figure printed
   * beneath it, which is the one thing this panel exists to guarantee.
   */
  const [c] = extensionCredits([
    ext({ previousBudgetSecs: 9600, approvedSecs: 9900, newBudgetSecs: 10800 }),
  ]);
  assert.equal(c.previousSecs, 9600);
  assert.equal(c.newSecs, 9900, "credited what was asked, not what was granted");

  /* And the account adds up, which is the property that broke. */
  const view = budgetHistoryView({
    givenSecs: 7200,
    currentSecs: 10200,
    credits: extensionCredits([
      ext({ id: "a", previousBudgetSecs: 7200, approvedSecs: null, newBudgetSecs: 9000 }),
      ext({ id: "b", previousBudgetSecs: 9000, approvedSecs: null, newBudgetSecs: 9600 }),
      ext({ id: "c", previousBudgetSecs: 9600, approvedSecs: 9900, newBudgetSecs: 10800 }),
      ext({ id: "d", previousBudgetSecs: 9900, approvedSecs: 10200, newBudgetSecs: 11100 }),
    ]),
  });
  assert.deepEqual(
    view.entries.map((e) => e.deltaSecs),
    [1800, 600, 300, 300],
  );
  assert.equal(view.unaccountedSecs, 0);
});

test("a null approval means the manager granted exactly what was asked", () => {
  /* The common case, and the only one where the request itself is the
     settlement. */
  const [c] = extensionCredits([ext({ approvedSecs: null })]);
  assert.equal(c.newSecs, 9000);
});

test("the id is the fallback for a name, never the thing shown", () => {
  /**
   * The stored record keeps an approver id and nothing else, so the row read
   * "Extension approved by GR0000." — reported as exactly that: "dont show
   * id, show person name". The caller resolves the name from the directory;
   * the id survives only for somebody the directory no longer has, where a
   * visible code can still be looked up and a blank cannot.
   */
  const named = extensionCredits([ext()])[0];
  assert.equal(named.reason, "Extension approved by Rakesh Sahoo.");

  const unresolved = extensionCredits([ext({ approverName: null })])[0];
  assert.equal(unresolved.reason, "Extension approved by GR0000.");

  /* A directory that answered with blank space is not an answer. */
  const blank = extensionCredits([ext({ approverName: "   " })])[0];
  assert.equal(blank.reason, "Extension approved by GR0000.");

  /* And with neither, the sentence still classifies as an extension — the
     label above the row depends on it. */
  const anonymous = extensionCredits([
    ext({ approverId: null, approverName: null }),
  ])[0];
  assert.equal(anonymous.reason, "Extension approved.");
  assert.equal(creditCause(anonymous.reason), "extension");
});
