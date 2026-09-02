import assert from "node:assert/strict";
import { test } from "node:test";
import { unseenPtsChanges, PTS_WINDOW_MS } from "./ptsChanges.ts";
import type { ScoreLedgerEntry } from "@/lib/domain/scoring";

const NOW = Date.parse("2026-09-02T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const entry = (over: Partial<ScoreLedgerEntry> & { id: string }): ScoreLedgerEntry =>
  ({
    deduction: 0,
    credit: 0,
    sourceLabel: "",
    reason: "",
    effectiveDate: ago(0),
    createdAt: ago(0),
    ...over,
  }) as unknown as ScoreLedgerEntry;

test("a recent unseen deduction is a debit change", () => {
  const r = unseenPtsChanges(
    [entry({ id: "e1", deduction: 0.2, sourceLabel: "Rework #1", effectiveDate: ago(3600_000) })],
    [],
    NOW,
  );
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].points, -0.2);
  assert.equal(r.changes[0].isDebit, true);
  assert.equal(r.changes[0].label, "Rework #1");
  assert.equal(r.hasDebit, true);
  assert.equal(r.hasCredit, false);
});

test("a recent unseen credit is a credit change", () => {
  const r = unseenPtsChanges(
    [entry({ id: "e1", credit: 0.5, sourceLabel: "On-time" })],
    [],
    NOW,
  );
  assert.equal(r.changes[0].points, 0.5);
  assert.equal(r.changes[0].isDebit, false);
  assert.equal(r.hasCredit, true);
  assert.equal(r.hasDebit, false);
});

test("already-seen changes are not shown again", () => {
  const r = unseenPtsChanges(
    [entry({ id: "e1", deduction: 0.2 }), entry({ id: "e2", deduction: 0.2 })],
    ["e1"],
    NOW,
  );
  assert.deepEqual(r.changes.map((c) => c.id), ["e2"]);
});

test("changes older than the window are ignored", () => {
  const r = unseenPtsChanges(
    [
      entry({ id: "old", deduction: 0.2, effectiveDate: ago(PTS_WINDOW_MS + 60_000) }),
      entry({ id: "new", deduction: 0.2, effectiveDate: ago(3600_000) }),
    ],
    [],
    NOW,
  );
  assert.deepEqual(r.changes.map((c) => c.id), ["new"]);
});

test("zero-value entries are not changes", () => {
  const r = unseenPtsChanges([entry({ id: "e1", deduction: 0, credit: 0 })], [], NOW);
  assert.equal(r.changes.length, 0);
});

test("newest first, and both flags when there is a mix", () => {
  const r = unseenPtsChanges(
    [
      entry({ id: "a", deduction: 0.2, effectiveDate: ago(7200_000) }),
      entry({ id: "b", credit: 0.5, effectiveDate: ago(3600_000) }),
    ],
    [],
    NOW,
  );
  assert.deepEqual(r.changes.map((c) => c.id), ["b", "a"]);
  assert.equal(r.hasDebit, true);
  assert.equal(r.hasCredit, true);
});

test("an undated entry is skipped, never crashes", () => {
  const r = unseenPtsChanges(
    [entry({ id: "e1", deduction: 0.2, effectiveDate: "", createdAt: "" })],
    [],
    NOW,
  );
  assert.equal(r.changes.length, 0);
});
