import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReworkNotice } from "./reworkNotice.ts";

test("parses the engine's rework line — name, occurrence, reason", () => {
  const got = parseReworkNotice(
    "🔄 RAKESH BISWAL sent this task back for rework (rework #1). 📝 Reason: u are not good",
  );
  assert.deepEqual(got, {
    byName: "RAKESH BISWAL",
    occurrence: 1,
    reason: "u are not good",
    /* No deduction line on this (older) message. */
    deduction: null,
  });
});

test("reads a WAIVED deduction, and keeps it out of the reason", () => {
  const got = parseReworkNotice(
    "🔄 Rakesh sent this task back for rework (rework #2).\n📝 Reason: fix the totals\n✅ Deduction waived — no points cut for this rework.",
  );
  assert.equal(got?.reason, "fix the totals");
  assert.deepEqual(got?.deduction, { waived: true, points: 0 });
});

test("reads an APPLIED deduction with its points, out of the reason", () => {
  const got = parseReworkNotice(
    "🔄 Rakesh sent this task back for rework (rework #1).\n📝 Reason: redo it\n⚠️ Deduction applied — 0.2 points cut for this rework.",
  );
  assert.equal(got?.reason, "redo it");
  assert.deepEqual(got?.deduction, { waived: false, points: 0.2 });
});

test("tolerates missing emojis and spacing drift", () => {
  const got = parseReworkNotice(
    "Rakesh Biswal sent this task back for rework (rework #3).  Reason:   fix the totals",
  );
  assert.equal(got?.occurrence, 3);
  assert.equal(got?.byName, "Rakesh Biswal");
  assert.equal(got?.reason, "fix the totals");
  assert.equal(got?.deduction, null);
});

test("a line with no number still parses, occurrence 0", () => {
  const got = parseReworkNotice(
    "Someone sent this task back for rework. Reason: redo it",
  );
  assert.equal(got?.occurrence, 0);
  assert.equal(got?.reason, "redo it");
});

test("anything that is not a rework line is null", () => {
  assert.equal(parseReworkNotice("Task approved."), null);
  assert.equal(parseReworkNotice("Pramod submitted work for completion review."), null);
  assert.equal(parseReworkNotice(""), null);
});

test("a multi-line reason is kept whole (deduction line still stripped)", () => {
  const got = parseReworkNotice(
    "X sent this task back for rework (rework #2). Reason: line one\nline two\n✅ Deduction waived — no points cut for this rework.",
  );
  assert.equal(got?.reason, "line one\nline two");
  assert.equal(got?.deduction?.waived, true);
});
