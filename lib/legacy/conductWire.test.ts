import assert from "node:assert/strict";
import { test } from "node:test";

import { readLedgerEntry, readSop, readSops } from "./sop.ts";

/**
 * C3 across the wire.
 *
 * These hold two things that are invisible until somebody presses a button and
 * gets a refusal for a record plainly on their screen:
 *
 *   1. **A deduction is identified by its OWN id**, not by the rule behind it.
 *      A dispute is raised against one deduction, and the same rule can be
 *      applied to the same person twice — so the rule's id cannot say which
 *      one is being argued about. The ledger row carried only `sopId`, and the
 *      recheck call takes the bleach's `_id`.
 *
 *   2. **A rule's cost is a percentage.** Legacy wrote `points` before the
 *      field existed and `percent` after; they are the same quantity, and a
 *      reader must never be shown one labelled as the other.
 */

test("a ledger entry carries its own id, distinct from the rule's", () => {
  const entry = readLedgerEntry({
    _id: "bleach-99",
    sopId: "sop-7",
    sopName: "Late to a client call",
    points: 5,
    bleachType: "credit",
    date: "2026-08-11",
  });

  assert.equal(entry.entryId, "bleach-99");
  assert.equal(entry.sopId, "sop-7");
  assert.notEqual(
    entry.entryId,
    entry.sopId,
    "the dispute call addresses the entry; taking the rule's id sends the wrong one",
  );
});

test("the same rule applied twice yields two distinguishable entries", () => {
  const first = readLedgerEntry({
    _id: "bleach-1",
    sopId: "sop-7",
    sopName: "Late to a client call",
    points: 5,
    bleachType: "credit",
    date: "2026-08-11",
  });
  const second = readLedgerEntry({
    _id: "bleach-2",
    sopId: "sop-7",
    sopName: "Late to a client call",
    points: 5,
    bleachType: "credit",
    date: "2026-08-12",
  });

  assert.notEqual(first.entryId, second.entryId);
});

test("an entry legacy sent without an id reports null rather than inventing one", () => {
  /* Older records predate the sub-document id being returned. Disputing one is
     impossible, and the row must say so by carrying nothing — not by pointing
     the dispute at the rule and having the engine refuse it. */
  const entry = readLedgerEntry({
    sopId: "sop-7",
    sopName: "Late to a client call",
    points: 5,
    bleachType: "credit",
  });
  assert.equal(entry.entryId, null);
});

test("percent is the cost, and points is the same number under its old name", () => {
  const rule = readSop({
    _id: "sop-7",
    name: "Late to a client call",
    percent: 5,
    status: "approved",
  });

  assert.ok(rule);
  assert.equal(rule.percent, 5);
  assert.equal(rule.points, 5, "the old name reports the same quantity");
});

test("a rule written before percent existed reads its points as the cost", () => {
  const rule = readSop({
    _id: "sop-3",
    name: "Missed a standup",
    points: 2,
    status: "approved",
  });

  assert.ok(rule);
  assert.equal(rule.percent, 2);
});

test("only an approved rule is applicable", () => {
  const rules = readSops([
    { _id: "a", name: "Approved", percent: 5, status: "approved" },
    { _id: "b", name: "Pending", percent: 5, status: "pending" },
    { _id: "c", name: "Rejected", percent: 5, status: "rejected" },
  ]);

  assert.deepEqual(
    rules.map((r) => [r.name, r.isApplicable]),
    [
      ["Approved", true],
      ["Pending", false],
      ["Rejected", false],
    ],
  );
});

test("the approver is a named person, carried from the record", () => {
  /* Not "whoever is senior". A reorganisation must not move a decision to
     somebody who was never asked for it. */
  const rule = readSop({
    _id: "sop-7",
    name: "Late to a client call",
    percent: 5,
    status: "pending",
    approverId: "E014",
    approverName: "Priya Raman",
  });

  assert.ok(rule);
  assert.equal(rule.approverId, "E014");
  assert.equal(rule.approverName, "Priya Raman");
});
