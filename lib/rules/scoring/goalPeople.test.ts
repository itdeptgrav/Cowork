import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isShared,
  personStep,
  progressFor,
  rollUpStatus,
  withDecision,
  withReport,
  type StepWithPeople,
} from "./goalPeople.ts";

const flat = (over: Partial<StepWithPeople> = {}): StepWithPeople => ({
  status: "pending",
  report: null,
  ...over,
});

const aReport = (text: string) => ({
  text,
  submittedAt: "2026-08-01T09:00:00.000Z",
  submittedBy: "Someone",
  files: [],
});

/* ── Who counts as shared ─────────────────────────────────────────────────── */

test("one assignee is not a shared goal", () => {
  assert.equal(isShared(["a"]), false);
  assert.equal(isShared([]), false);
});

test("two assignees is", () => {
  assert.equal(isShared(["a", "b"]), true);
});

/* ── Reading one person's state ───────────────────────────────────────────── */

test("a single-assignee goal reads the flat fields, untouched", () => {
  const step = flat({ status: "done", report: aReport("finished") });
  const mine = personStep({ step, personId: "a", assigneeIds: ["a"] });
  assert.equal(mine.status, "done");
  assert.equal(mine.report?.text, "finished");
});

test("a shared goal reads that person's own row", () => {
  const step = flat({
    status: "pending",
    perUserStatus: {
      a: { status: "done", pointsAwarded: 12 },
      b: { status: "pending_approval" },
    },
  });
  assert.equal(
    personStep({ step, personId: "a", assigneeIds: ["a", "b"] }).status,
    "done",
  );
  assert.equal(
    personStep({ step, personId: "b", assigneeIds: ["a", "b"] }).status,
    "pending_approval",
  );
});

test("somebody added later does not inherit another person's done", () => {
  /* The flat status says done because the first person finished it. The new
     assignee has done nothing, and must not be credited for it. */
  const step = flat({
    status: "done",
    report: aReport("done by the first person"),
    perUserStatus: { a: { status: "done", pointsAwarded: 12 } },
  });
  const mine = personStep({ step, personId: "c", assigneeIds: ["a", "c"] });
  assert.equal(mine.status, "pending");
  assert.equal(mine.report, null);
  assert.equal(mine.pointsAwarded, 0);
});

test("a person's report is their own, not the flat one", () => {
  const step = flat({
    report: aReport("the last person to submit"),
    perUserStatus: { a: { status: "pending_approval", report: aReport("mine") } },
  });
  const mine = personStep({ step, personId: "a", assigneeIds: ["a", "b"] });
  assert.equal(mine.report?.text, "mine");
});

test("a malformed row reads as pending rather than throwing", () => {
  const step = flat({
    perUserStatus: { a: { status: "", pointsAwarded: Number.NaN } },
  });
  const mine = personStep({ step, personId: "a", assigneeIds: ["a", "b"] });
  assert.equal(mine.status, "pending");
  assert.equal(mine.pointsAwarded, 0);
});

/* ── The flat status ──────────────────────────────────────────────────────── */

test("the flat status is done only when everybody is", () => {
  const step = flat();
  assert.equal(
    rollUpStatus({
      step,
      assigneeIds: ["a", "b"],
      next: { a: { status: "done" }, b: { status: "pending" } },
    }),
    "pending",
  );
  assert.equal(
    rollUpStatus({
      step,
      assigneeIds: ["a", "b"],
      next: { a: { status: "done" }, b: { status: "done" } },
    }),
    "done",
  );
});

test("anybody waiting shows on the flat status", () => {
  assert.equal(
    rollUpStatus({
      step: flat(),
      assigneeIds: ["a", "b"],
      next: { a: { status: "done" }, b: { status: "pending_approval" } },
    }),
    "pending_approval",
  );
});

test("an unshared goal's flat status is left exactly as it was", () => {
  const step = flat({ status: "pending_approval" });
  assert.equal(
    rollUpStatus({ step, assigneeIds: ["a"], next: { a: { status: "done" } } }),
    "pending_approval",
  );
});

/* ── Writing ──────────────────────────────────────────────────────────────── */

test("handing in touches only that person's row", () => {
  const step = flat({ perUserStatus: { b: { status: "done", pointsAwarded: 9 } } });
  const next = withReport({ step, personId: "a", report: aReport("mine") });
  assert.equal(next.a?.status, "pending_approval");
  assert.equal(next.a?.report?.text, "mine");
  assert.deepEqual(next.b, { status: "done", pointsAwarded: 9 });
});

test("the original map is not mutated", () => {
  const held = { b: { status: "done" } };
  const step = flat({ perUserStatus: held });
  withReport({ step, personId: "a", report: aReport("mine") });
  assert.deepEqual(held, { b: { status: "done" } });
});

test("approving on time awards the step's full points", () => {
  const next = withDecision({
    step: flat(),
    personId: "a",
    approve: true,
    points: 12,
    late: false,
    nowIso: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(next.a?.status, "done");
  assert.equal(next.a?.pointsAwarded, 12);
  assert.equal(next.a?.doneAt, "2026-08-02T00:00:00.000Z");
});

test("each person earns the full points, not a share", () => {
  let step = flat();
  const now = "2026-08-02T00:00:00.000Z";
  step = flat({
    perUserStatus: withDecision({
      step,
      personId: "a",
      approve: true,
      points: 12,
      late: false,
      nowIso: now,
    }),
  });
  const next = withDecision({
    step,
    personId: "b",
    approve: true,
    points: 12,
    late: false,
    nowIso: now,
  });
  assert.equal(next.a?.pointsAwarded, 12);
  assert.equal(next.b?.pointsAwarded, 12);
});

test("approving a late step awards nothing but still finishes it", () => {
  const next = withDecision({
    step: flat(),
    personId: "a",
    approve: true,
    points: 12,
    late: true,
    nowIso: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(next.a?.status, "done");
  assert.equal(next.a?.pointsAwarded, 0);
  assert.equal(next.a?.lateSubmission, true);
});

test("sending back clears only that person's report", () => {
  const step = flat({
    perUserStatus: {
      a: { status: "pending_approval", report: aReport("mine") },
      b: { status: "pending_approval", report: aReport("theirs") },
    },
  });
  const next = withDecision({
    step,
    personId: "a",
    approve: false,
    points: 12,
    late: false,
    nowIso: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(next.a?.status, "pending");
  assert.equal(next.a?.report, null);
  assert.equal(next.b?.report?.text, "theirs");
});

/* ── Progress ─────────────────────────────────────────────────────────────── */

test("progress is counted per person", () => {
  const steps = [
    {
      points: 10,
      step: flat({
        perUserStatus: {
          a: { status: "done", pointsAwarded: 10 },
          b: { status: "pending" },
        },
      }),
    },
    {
      points: 5,
      step: flat({
        perUserStatus: {
          a: { status: "pending_approval" },
          b: { status: "pending" },
        },
      }),
    },
  ];
  const [a, b] = progressFor({ steps, assigneeIds: ["a", "b"] });
  assert.deepEqual(
    { done: a.doneCount, earned: a.pointsEarned, left: a.pointsRemaining, waiting: a.waiting },
    { done: 1, earned: 10, left: 5, waiting: true },
  );
  assert.deepEqual(
    { done: b.doneCount, earned: b.pointsEarned, left: b.pointsRemaining, waiting: b.waiting },
    { done: 0, earned: 0, left: 15, waiting: false },
  );
});

test("a step approved late is finished, not still available", () => {
  const steps = [
    {
      points: 10,
      step: flat({
        perUserStatus: {
          a: { status: "done", pointsAwarded: 0, lateSubmission: true },
        },
      }),
    },
  ];
  const [a] = progressFor({ steps, assigneeIds: ["a", "b"] });
  assert.equal(a.doneCount, 1);
  assert.equal(a.pointsEarned, 0);
  /* Not 10 — those points are gone, and offering them again would be a lie. */
  assert.equal(a.pointsRemaining, 0);
});
