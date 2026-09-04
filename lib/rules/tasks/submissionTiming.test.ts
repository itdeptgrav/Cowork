import assert from "node:assert/strict";
import { test } from "node:test";
import { submissionTiming } from "./submissionTiming.ts";

const DUE = "2026-09-04T12:00:00.000Z";
/** `n` minutes after the deadline. Negative is before it. */
const at = (mins: number) =>
  new Date(Date.parse(DUE) + mins * 60_000).toISOString();

const label = (mins: number) =>
  submissionTiming({ submittedAt: at(mins), dueAt: DUE })?.label;

test("work handed in after the deadline is late, by how much", () => {
  assert.equal(label(5), "5m late");
  assert.equal(label(90), "1h 30m late");
  assert.equal(label(60 * 24 * 2 + 60 * 3), "2d 3h late");
});

test("work handed in before it is early, by how much", () => {
  assert.equal(label(-5), "5m early");
  assert.equal(label(-90), "1h 30m early");
  assert.equal(label(-60 * 24 * 3), "3d early");
});

test("the kind and the seconds are carried, not only the words", () => {
  const late = submissionTiming({ submittedAt: at(120), dueAt: DUE });
  assert.equal(late?.kind, "late");
  assert.equal(late?.secs, 7200);
  const early = submissionTiming({ submittedAt: at(-120), dueAt: DUE });
  assert.equal(early?.kind, "early");
  assert.equal(early?.secs, 7200);
});

test("landing within a minute of the deadline is hitting it", () => {
  /* Otherwise the common case reads "0m late", and at the boundary the
     early/late verdict is decided by clock skew. */
  for (const mins of [0, 0.5, -0.5]) {
    const t = submissionTiming({ submittedAt: at(mins), dueAt: DUE });
    assert.equal(t?.kind, "on_time");
    assert.equal(t?.label, "on time");
    assert.equal(t?.secs, 0);
  }
});

test("a task with no deadline is not late, and is not on time either", () => {
  /* Null, so the caller shows nothing. "On time" would be a claim about a
     deadline nobody set. */
  assert.equal(submissionTiming({ submittedAt: at(10), dueAt: null }), null);
  assert.equal(submissionTiming({ submittedAt: at(10), dueAt: "" }), null);
});

test("an unsubmitted or unparseable date measures nothing", () => {
  assert.equal(submissionTiming({ submittedAt: null, dueAt: DUE }), null);
  assert.equal(submissionTiming({ submittedAt: "", dueAt: DUE }), null);
  assert.equal(submissionTiming({ submittedAt: "not a date", dueAt: DUE }), null);
  assert.equal(submissionTiming({ submittedAt: at(1), dueAt: "nonsense" }), null);
});

test("a span is never shown to three units", () => {
  /* A reviewer needs a magnitude, and the third unit decides nothing. */
  const t = submissionTiming({
    submittedAt: at(60 * 24 * 2 + 60 * 3 + 14),
    dueAt: DUE,
  });
  assert.equal(t?.label, "2d 3h late");
});

test("a whole number of days drops the empty hours", () => {
  assert.equal(label(60 * 24 * 2), "2d late");
  assert.equal(label(60 * 5), "5h late");
});

test("rounding never produces 60m", () => {
  /* 59m 40s rounds to 60 minutes; "60m" beside "1h 2m" is one value in two
     shapes. */
  const t = submissionTiming({
    submittedAt: new Date(Date.parse(DUE) + 59 * 60_000 + 40_000).toISOString(),
    dueAt: DUE,
  });
  assert.equal(t?.label, "1h late");
});
