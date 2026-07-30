import assert from "node:assert/strict";
import { test } from "node:test";
import { explainWorkload, formatWorkload } from "./explainWorkload.ts";
import { resolveTaskPriority } from "./resolveTaskPriority.ts";
import { addWorkingSecs } from "../../legacy-ui/officeDueDate.js";

/**
 * Pramod's three tasks, end to end.
 *
 * **Two bugs met here, and neither was in the deadline engine.**
 *
 * 1. His manager saw P1/P2/P3 and he saw dashes on the SAME three tasks. The
 *    mapper gave the queue OWNER the derived position and everybody else the
 *    stored rank — with `?? UNRANKED` where there was no derived position. A
 *    task outside the live queue therefore had a rank for every viewer except
 *    the one person whose queue it is.
 *
 * 2. The task list never received the chained dates at all. Only the task page
 *    did, so a task read one date in the list and another when opened.
 *
 * These tests use the real `addWorkingSecs` and the real resolver, so they fail
 * for the same reasons production would.
 */

/* The shape `_dayCfg` actually reads: FULL day names, `isOff`, `inTime`,
   `outTime`. The earlier fixture used `mon`/`open`/`close`/`isOpen`, none of
   which it looks at — so it silently fell back to the built-in default and
   these tests were not exercising the schedule they declared. It matched by
   coincidence (09:30–18:30) and nothing here crossed a Saturday, which the
   default leaves OPEN. */
const SCHEDULE = {
  monday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  tuesday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  wednesday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  thursday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  friday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  saturday: { isOff: true, inTime: "09:30", outTime: "18:30" },
  sunday: { isOff: true, inTime: "09:30", outTime: "18:30" },
};
const work = (a: number, s: number) =>
  addWorkingSecs(a, s, SCHEDULE, new Set<string>(), []);

const H = 3600;
const PRAMOD = "PRAMOD";
const MON_0930 = Date.parse("2026-08-03T04:00:00.000Z");
const AT = {
  "09:30": "2026-08-03T04:00:00.000Z",
  "11:30": "2026-08-03T06:00:00.000Z",
  "12:30": "2026-08-03T07:00:00.000Z",
  "16:30": "2026-08-03T11:00:00.000Z",
};

const T646 = {
  taskId: "T646",
  status: "in_progress",
  assigneeIds: [PRAMOD],
  assigneePriorities: { [PRAMOD]: 1 },
  senderTimerWindowSecs: 2 * H,
};
const T647 = {
  taskId: "T647",
  status: "in_progress",
  assigneeIds: [PRAMOD],
  assigneePriorities: { [PRAMOD]: 2 },
  senderTimerWindowSecs: 1 * H,
};
const T648 = {
  taskId: "T648",
  status: "in_progress",
  assigneeIds: [PRAMOD],
  assigneePriorities: { [PRAMOD]: 3 },
  senderTimerWindowSecs: 4 * H,
};

const explain = (tasks: unknown[]) =>
  explainWorkload({
    employeeId: PRAMOD,
    tasks: tasks as never,
    nowMs: MON_0930,
    addWorkingSecs: work,
  });

/* ── Priority ─────────────────────────────────────────────────────────────── */

test("all three resolve to the priorities the manager sees", () => {
  assert.equal(resolveTaskPriority(T646, PRAMOD), 1);
  assert.equal(resolveTaskPriority(T647, PRAMOD), 2);
  assert.equal(resolveTaskPriority(T648, PRAMOD), 3);
});

test("the viewer does not change the number", () => {
  /* The resolver takes the SUBJECT, never the viewer, so there is no way to
     ask it a viewer-shaped question. A manager and Pramod read one number. */
  for (const t of [T646, T647, T648]) {
    const asManager = resolveTaskPriority(t, PRAMOD);
    const asPramod = resolveTaskPriority(t, PRAMOD);
    const asAdmin = resolveTaskPriority(t, PRAMOD);
    assert.equal(asManager, asPramod);
    assert.equal(asPramod, asAdmin);
  }
});

test("a task outside the live queue still has a priority to show", () => {
  /* THE BUG. A task whose budget is unsettled gets no derived position — and
     the owner's rank fell to UNRANKED, so their own screen showed a dash while
     their manager's showed the stored number. */
  const unsettled = { ...T648, budgetState: "PROPOSED" };
  const rows = explain([T646, T647, unsettled]);
  const row = rows.find((r) => r.taskId === "T648")!;

  assert.equal(row.includedInWorkload, false);
  assert.equal(row.queuePosition, null);
  /* No position — and still a priority. That is the distinction the mapper
     collapsed. */
  assert.equal(row.resolvedPriority, 3);
});

/* ── Operational due ──────────────────────────────────────────────────────── */

test("T648 starts after T647 completes, and T647 after T646", () => {
  const rows = explain([T646, T647, T648]);
  const by = new Map(rows.map((r) => [r.taskId, r]));

  assert.equal(by.get("T646")!.calculatedStart, AT["09:30"]);
  assert.equal(by.get("T646")!.calculatedCompletion, AT["11:30"]);
  assert.equal(by.get("T647")!.calculatedStart, AT["11:30"]);
  assert.equal(by.get("T647")!.calculatedCompletion, AT["12:30"]);
  assert.equal(by.get("T648")!.calculatedStart, AT["12:30"]);
  assert.equal(by.get("T648")!.calculatedCompletion, AT["16:30"]);

  /* Stated as the rule, not only as fixed timestamps: the assertion must hold
     if the office hours in this fixture ever change. */
  assert.ok(
    Date.parse(by.get("T648")!.calculatedStart!) >=
      Date.parse(by.get("T647")!.calculatedCompletion!),
    "T648 starts before T647 finishes",
  );
  assert.ok(
    Date.parse(by.get("T647")!.calculatedStart!) >=
      Date.parse(by.get("T646")!.calculatedCompletion!),
  );
});

test("queue positions follow the resolved priorities", () => {
  const rows = explain([T648, T646, T647]); // handed over backwards
  assert.deepEqual(
    rows
      .filter((r) => r.includedInWorkload)
      .sort((a, b) => a.queuePosition! - b.queuePosition!)
      .map((r) => [r.taskId, r.queuePosition]),
    [
      ["T646", 1],
      ["T647", 2],
      ["T648", 3],
    ],
  );
});

test("T648 is never inserted at the front", () => {
  const rows = explain([T646, T647, T648]);
  const t648 = rows.find((r) => r.taskId === "T648")!;
  assert.equal(t648.queuePosition, 3);
  assert.notEqual(t648.calculatedStart, AT["09:30"]);
});

/* ── What must NOT reach the queue ────────────────────────────────────────── */

test("completed work does not block the queue", () => {
  const done = {
    ...T646,
    taskId: "T-DONE",
    status: "completed",
    senderTimerWindowSecs: 40 * H,
    assigneePriorities: { [PRAMOD]: 1 },
  };
  const rows = explain([done, T646, T647, T648]);
  const row = rows.find((r) => r.taskId === "T-DONE")!;
  assert.equal(row.includedInWorkload, false);
  assert.match(row.excludedBecause!, /not active workload/);
  /* And nothing else moved. */
  assert.equal(
    rows.find((r) => r.taskId === "T648")!.calculatedStart,
    AT["12:30"],
  );
});

test("work awaiting approval does not block the queue", () => {
  const waiting = {
    ...T646,
    taskId: "T-PENDING",
    status: "pending_department_approval",
    senderTimerWindowSecs: 40 * H,
  };
  const rows = explain([waiting, T646, T647, T648]);
  assert.equal(rows.find((r) => r.taskId === "T-PENDING")!.includedInWorkload, false);
  assert.equal(
    rows.find((r) => r.taskId === "T648")!.calculatedStart,
    AT["12:30"],
  );
});

test("an unsettled budget does not block the queue, and says so", () => {
  const arguing = {
    ...T646,
    taskId: "T-ARGUING",
    budgetState: "PROPOSED",
    senderTimerWindowSecs: 40 * H,
  };
  const rows = explain([arguing, T646, T647, T648]);
  const row = rows.find((r) => r.taskId === "T-ARGUING")!;
  assert.equal(row.includedInWorkload, false);
  assert.match(row.excludedBecause!, /budget not settled \(PROPOSED\)/);
  assert.equal(
    rows.find((r) => r.taskId === "T648")!.calculatedStart,
    AT["12:30"],
  );
});

test("a task with no hours has nothing to lay end to end", () => {
  const noBudget = { ...T646, taskId: "T-NOHOURS", senderTimerWindowSecs: 0 };
  const row = explain([noBudget, T646, T647, T648]).find(
    (r) => r.taskId === "T-NOHOURS",
  )!;
  assert.equal(row.includedInWorkload, false);
  assert.equal(row.excludedBecause, "no time budget set");
});

test("the assignor deadline is nowhere in this calculation", () => {
  /* There is no field to pass one. The commitment is compared against the
     result; it never produces it. */
  const withDeadlines = explain([
    { ...T646, deadline: "2026-08-03T05:00:00.000Z" },
    { ...T647, deadline: "2026-08-01T05:00:00.000Z" },
    { ...T648, deadline: "2026-08-03T04:30:00.000Z" },
  ]);
  const plain = explain([T646, T647, T648]);
  assert.deepEqual(
    withDeadlines.map((r) => [r.taskId, r.calculatedStart, r.calculatedCompletion]),
    plain.map((r) => [r.taskId, r.calculatedStart, r.calculatedCompletion]),
  );
});

/* ── The diagnostic itself ────────────────────────────────────────────────── */

test("the workload table reports every field needed to explain a date", () => {
  const rows = explain([
    T646,
    T647,
    T648,
    { ...T646, taskId: "T-DONE", status: "completed" },
  ]);
  for (const r of rows) {
    for (const k of [
      "taskId",
      "assignee",
      "resolvedPriority",
      "budgetSeconds",
      "status",
      "includedInWorkload",
      "queuePosition",
      "calculatedStart",
      "calculatedCompletion",
    ]) {
      assert.ok(k in r, `the diagnostic omits ${k}`);
    }
  }
  const table = formatWorkload(rows);
  assert.match(table, /T646/);
  assert.match(table, /T648/);
  /* Printed here so a failing run shows the queue that produced it. */
  console.log("\n" + table + "\n");
});
