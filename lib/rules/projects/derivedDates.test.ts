import assert from "node:assert/strict";
import test from "node:test";

import { deriveProjectDates, type DatedTask } from "./derivedDates.ts";

const task = (t: Partial<DatedTask>): DatedTask => ({
  createdAt: "2026-08-01T09:00:00.000Z",
  operationalDueAt: null,
  dueAt: null,
  ...t,
});

test("nothing connected dates nothing", () => {
  /* Rather than the pair of hardcoded literals the form used to prefill —
     "2026-07-25" and "2026-09-30", from the demo seed — which were a claim
     about a project nobody had described yet. */
  assert.deepEqual(deriveProjectDates([]), {
    startDate: null,
    targetDate: null,
  });
});

test("the start is the earliest task's creation", () => {
  const d = deriveProjectDates([
    task({ createdAt: "2026-08-14T10:00:00.000Z" }),
    task({ createdAt: "2026-06-02T23:30:00.000Z" }),
    task({ createdAt: "2026-07-09T08:00:00.000Z" }),
  ]);
  assert.equal(d.startDate, "2026-06-02");
});

test("the target is the latest end date", () => {
  const d = deriveProjectDates([
    task({ dueAt: "2026-09-01T17:00:00.000Z" }),
    task({ dueAt: "2026-11-20T17:00:00.000Z" }),
  ]);
  assert.equal(d.targetDate, "2026-11-20");
});

test("the operational date wins over the stored one", () => {
  /* The stored figure is assignment time plus a budget, as if the assignee
     were free that instant. The operational one walks their real queue, and a
     project promised against the first is promised against a date nobody's
     calendar agrees with. */
  const d = deriveProjectDates([
    task({ dueAt: "2026-09-01T17:00:00.000Z", operationalDueAt: "2026-10-15T17:00:00.000Z" }),
  ]);
  assert.equal(d.targetDate, "2026-10-15");
});

test("the operational date wins even when it is EARLIER", () => {
  /* Preference, not a maximum of the two — otherwise the rule would silently
     become "whichever is worse", which is a different claim. */
  const d = deriveProjectDates([
    task({ dueAt: "2026-12-01T17:00:00.000Z", operationalDueAt: "2026-09-04T17:00:00.000Z" }),
  ]);
  assert.equal(d.targetDate, "2026-09-04");
});

test("an undated task does not collapse the target", () => {
  /* Unknown is not immediate. A task with no deadline must not drag the
     project's target back to its creation date. */
  const d = deriveProjectDates([
    task({ createdAt: "2026-08-01T09:00:00.000Z" }),
    task({ createdAt: "2026-08-02T09:00:00.000Z", dueAt: "2026-10-30T17:00:00.000Z" }),
  ]);
  assert.equal(d.startDate, "2026-08-01");
  assert.equal(d.targetDate, "2026-10-30");
});

test("tasks with no end date at all leave the target unset", () => {
  const d = deriveProjectDates([task({}), task({})]);
  assert.equal(d.startDate, "2026-08-01");
  assert.equal(d.targetDate, null);
});

test("an unparseable date is skipped rather than yielding NaN", () => {
  const d = deriveProjectDates([
    task({ createdAt: "not a date", dueAt: "also not a date" }),
    task({ createdAt: "2026-08-05T09:00:00.000Z", dueAt: "2026-09-09T09:00:00.000Z" }),
  ]);
  assert.equal(d.startDate, "2026-08-05");
  assert.equal(d.targetDate, "2026-09-09");
});
