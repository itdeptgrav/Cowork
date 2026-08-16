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
  /* The guard moved from an effect's early return into the query's own fetcher
     when this stopped being a hand-rolled `useEffect` — see
     `lib/rules/tasks/liveCompletion.test.ts` for why it had to. The rule is
     unchanged: with a chained date in hand, the engine is not asked. */
  assert.match(
    src,
    /chained \|\| !subject \|\| budgetSecs <= 0/,
    "the engine is asked even when the queue already answered",
  );
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

test("the facts panel shows ONE date, and it is the real deadline", () => {
  /**
   * **REVERSED — OWNER DECISION, 16 Aug 2026.**
   *
   * This used to assert the opposite: that the facts panel shows only
   * `Expected completion` and never the deadline, on the reasoning that two
   * dates side by side would make people plan against the wrong one.
   *
   * In practice it produced two dates on two SCREENS, which is worse — side by
   * side they could at least be labelled. The projection was the only date on
   * the panel, so people read it as their deadline; the real one lived on the
   * Deadline tab and disagreed. A rework that moved the deadline 11:18 → 12:17
   * left this panel unchanged and was reported as the rework rule failing, when
   * the engine had written the new date correctly.
   *
   * So the panel now reads `task.deadline.dueAt` — the identical field
   * `DeadlinePanel` renders as "Working deadline". One source, one date.
   */
  const detail = code("components/features/tasks/TaskDetail.tsx");
  assert.match(detail, /<Fact label="Deadline">/);
  assert.match(detail, /formatDateTime\(v\.task\.deadline\.dueAt\)/);
  /* And NOT the projection beside it, which is the whole point of the
     reversal — a second date on the same panel is what was being avoided. */
  assert.equal(
    /<Fact label="Expected completion">/.test(detail),
    false,
    "the projection is back on the facts panel — that is two dates again",
  );
});

test("the projection itself is kept, not deleted", () => {
  /* It is no longer what the facts panel calls the answer; it is still a
     correct queue projection and still carries the feasibility warning, so
     removing the component would take a working calculation with it. */
  const src = code("components/features/tasks/ExpectedCompletion.tsx");
  assert.match(src, /export function ExpectedCompletion/);
});

test("the commitment still drives the verdict", () => {
  /* Removing it from the page must not remove it from the calculation — that
     would turn a feasibility warning into no warning at all. */
  const src = code("components/features/tasks/ExpectedCompletion.tsx");
  assert.match(src, /committedDeadline: requested/);
  /* The buffer is still computed; only its red half is withheld. */
  assert.match(src, /const buffer =/);
});

test("the red miss warning is withheld — OWNER DECISION, 15 Aug 2026", () => {
  /**
   * It compared against the STORED deadline, and a stored deadline can
   * currently be wrong: T031 held 09:40 on the morning of a task created at
   * 19:49, so the panel announced a ten-hour miss that never happened. An
   * alarm that is accurate about its input and wrong about the world teaches
   * people to ignore alarms.
   *
   * Pinned rather than simply deleted so the absence stays a DECISION. When
   * stored deadlines can be trusted, deleting `buffer >= 0 &&` restores it —
   * and this test is what will fail and say so.
   */
  const src = code("components/features/tasks/ExpectedCompletion.tsx");
  assert.equal(
    /Misses the requested deadline by/.test(src),
    false,
    "the red miss line is back — was that deliberate?",
  );
  assert.match(src, /buffer !== null && buffer >= 0 &&/);
  /* The reassuring half survives: finishing early is still said out loud. */
  assert.match(src, /Finishes/);
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
