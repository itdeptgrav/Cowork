import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { calculateDeadlineFeasibility } from "../../../lib/rules/tasks/deadlineFeasibility.ts";
import { addWorkingSecs } from "../../../lib/legacy-ui/officeDueDate.js";

/**
 * When will this actually be finished?
 *
 * The page showed the date the assignor typed and called it the deadline. That
 * says nothing about the queue the work sits in: a task third in line behind
 * sixteen hours of other work does not become due sooner because an earlier
 * date was written on it.
 *
 * The behavioural tests drive the SAME engine the page renders from, so what is
 * asserted here is what a reader sees.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const SCHEDULE = {
  mon: { open: "09:00", close: "18:00", isOpen: true },
  tue: { open: "09:00", close: "18:00", isOpen: true },
  wed: { open: "09:00", close: "18:00", isOpen: true },
  thu: { open: "09:00", close: "18:00", isOpen: true },
  fri: { open: "09:00", close: "18:00", isOpen: true },
  sat: { open: "09:00", close: "18:00", isOpen: false },
  sun: { open: "09:00", close: "18:00", isOpen: false },
};
const work = (a: number, s: number) =>
  addWorkingSecs(a, s, SCHEDULE, new Set<string>(), []);
const MONDAY = Date.parse("2026-08-03T03:30:00.000Z");
const H = 3600;

const task = (o: Record<string, unknown>) =>
  ({ status: "in_progress", assigneeIds: ["E1"], ...o }) as never;
const run = (o: Record<string, unknown>) =>
  calculateDeadlineFeasibility({
    employeeId: "E1",
    nowMs: MONDAY,
    addWorkingSecs: work,
    committedDeadline: null,
    tasks: [],
    ...o,
  } as never);

/* ── The queue decides the date ───────────────────────────────────────────── */

test("a higher position finishes earlier", () => {
  const tasks = [
    task({ taskId: "A", senderTimerWindowSecs: 8 * H, priority: 1 }),
    task({ taskId: "B", senderTimerWindowSecs: 4 * H, priority: 2 }),
  ];
  const first = run({ proposedPriority: 1, estimatedWorkSeconds: 2 * H, tasks });
  const last = run({ proposedPriority: 3, estimatedWorkSeconds: 2 * H, tasks });
  assert.ok(
    Date.parse(first.estimatedCompletionTime!) <
      Date.parse(last.estimatedCompletionTime!),
  );
});

test("a bigger budget finishes later", () => {
  const small = run({ proposedPriority: 1, estimatedWorkSeconds: 2 * H });
  const big = run({ proposedPriority: 1, estimatedWorkSeconds: 8 * H });
  assert.ok(
    Date.parse(big.estimatedCompletionTime!) >
      Date.parse(small.estimatedCompletionTime!),
  );
});

test("changing the requested deadline does NOT move the expected completion", () => {
  /* The distinction the whole change rests on. The commitment is a constraint
     to be measured against, never an input to when the work will finish. */
  const early = run({
    proposedPriority: 1,
    estimatedWorkSeconds: 4 * H,
    /* Monday 10:00 IST — genuinely before a four-hour task can finish. */
    committedDeadline: "2026-08-03T04:30:00.000Z",
  });
  const late = run({
    proposedPriority: 1,
    estimatedWorkSeconds: 4 * H,
    committedDeadline: "2026-12-25T12:30:00.000Z",
  });
  assert.equal(early.estimatedCompletionTime, late.estimatedCompletionTime);
  /* Only the verdict differs, which is exactly what a commitment should change. */
  assert.notEqual(early.feasible, late.feasible);
});

test("two people with different workloads get different dates", () => {
  const busy = run({
    proposedPriority: 2,
    estimatedWorkSeconds: 2 * H,
    tasks: [task({ taskId: "X", senderTimerWindowSecs: 16 * H, priority: 1 })],
  });
  const free = run({ proposedPriority: 1, estimatedWorkSeconds: 2 * H });
  assert.ok(
    Date.parse(busy.estimatedCompletionTime!) >
      Date.parse(free.estimatedCompletionTime!),
  );
});

test("only settled workload pushes the date out", () => {
  /* A cross-department task still negotiating its budget is not committed work,
     so it cannot delay somebody else's expected completion. */
  const withPending = run({
    proposedPriority: 1,
    estimatedWorkSeconds: 2 * H,
    tasks: [
      task({
        taskId: "P",
        senderTimerWindowSecs: 16 * H,
        priority: 1,
        budgetState: "WAITING_FOR_ASSIGNEE",
      }),
    ],
  });
  const clean = run({ proposedPriority: 1, estimatedWorkSeconds: 2 * H });
  assert.equal(withPending.estimatedCompletionTime, clean.estimatedCompletionTime);
});

/* ── What the page does with it ───────────────────────────────────────────── */

test("the component calculates nothing", () => {
  /* One engine, so the detail page and the planner cannot show different dates
     for the same task. */
  const src = code("components/features/tasks/ExpectedCompletion.tsx");
  assert.match(src, /previewDeadlineFeasibility\(\{/);
  /* No working calendar, no chain, no ordering. The completion DATE is never
     derived here — it comes from `operationalDueAt`, which the repository
     chained, or from the engine. */
  for (const own of ["addWorkingSecs", "chainDeadlines", ".sort(", "windowSecsFor"]) {
    assert.equal(src.includes(own), false, `the component computes "${own}"`);
  }
  assert.match(src, /view\.task\.deadline\.operationalDueAt/);

  /* `Date.parse` IS allowed, for exactly one thing: subtracting the commitment
     from the completion to show the buffer. Both dates are given; this is the
     gap between two facts, not a second opinion about either. The engine
     returns the same figure when it answers, and the two must not diverge, so
     the subtraction is pinned rather than merely permitted. */
  const parses = (src.match(/Date\.parse\(/g) ?? []).length;
  assert.equal(parses, 2, "Date.parse is being used for something else");
  assert.match(
    src,
    /Math\.round\(\(Date\.parse\(requested\) - Date\.parse\(chained\)\) \/ 1000\)/,
  );
});

test("the chained date leads, and the engine is the fallback", () => {
  /* The repository chains the whole queue in one pass. Asking the engine again
     for a task whose date is already in the view would be a second round trip
     to recompute a number it was handed — and two answers that can drift. */
  const src = code("components/features/tasks/ExpectedCompletion.tsx");
  assert.match(src, /const chained = view\.task\.deadline\.operationalDueAt;/);
  assert.match(src, /if \(chained\) return;/);
  assert.match(
    src,
    /const completion = chained \?\? result\?\.estimatedCompletionTime \?\? null;/,
  );
});

test("it measures the person who will do the work", () => {
  /* A held cross-department task keeps them in `pendingAssignees`, which is the
     one stage where this question matters most. */
  const src = code("components/features/tasks/ExpectedCompletion.tsx");
  assert.match(src, /view\.pendingAssignees\[0\]\?\.id \?\? view\.assignees\[0\]\?\.id/);
});

test("only the operational date is shown", () => {
  /* The assignor's requested deadline was removed on purpose: two dates side by
     side invited the reader to plan against the wrong one. It still constrains
     — the completion line is measured against it and the warning fires on it —
     it is simply not presented as a date to work to. */
  const detail = code("components/features/tasks/TaskDetail.tsx");
  assert.match(detail, /<Fact label="Expected completion">/);
  assert.equal(
    /<Fact label="Requested deadline">/.test(detail),
    false,
    "the assignor deadline is displayed again",
  );
  assert.equal(
    /<Fact label="Deadline">/.test(detail),
    false,
    "an unlabelled deadline remains",
  );
});

test("the commitment still drives the verdict", () => {
  /* Removing it from the page must not remove it from the calculation — that
     would turn a feasibility warning into no warning at all. */
  const src = code("components/features/tasks/ExpectedCompletion.tsx");
  assert.match(src, /committedDeadline: requested/);
  assert.match(src, /Misses the requested deadline by/);
});

test("the list column says which date it is showing", () => {
  /* A list cannot compute expected completion without one query per row, so it
     shows the fact it has and names it honestly. */
  const table = code("components/features/tasks/TaskTable.tsx");
  assert.match(table, /\["due", "Requested"\]/);
});

test("a task with no agreed budget shows no expected completion", () => {
  /* There is no queue answer to give, and inventing one from a deadline nobody
     computed would be the original fault in a new place. */
  const src = code("components/features/tasks/ExpectedCompletion.tsx");
  assert.match(src, /if \(!subject \|\| budgetSecs <= 0 \|\| failed\) return null;/);
});
