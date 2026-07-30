import assert from "node:assert/strict";
import { test } from "node:test";
import { chainDeadlines, windowSecsFor } from "./priorityDeadline.ts";
import { remainingWorkSecs, resolveTimeBudget } from "./resolveTimeBudget.ts";
import { addWorkingSecs } from "../../legacy-ui/officeDueDate.js";

/**
 * Work happens at 04:53. It counts. It is not office time.
 *
 * **Two questions were being answered with one number.** What somebody has
 * done, and when the rest of it can happen. The timer recorded the first
 * correctly and the chain ignored it entirely — every task scheduled its FULL
 * budget from now, so five minutes worked before dawn on a two-hour task
 * predicted 11:30 rather than 11:25.
 *
 * The office calendar was never the problem: `addWorkingSecs` already advances
 * an out-of-hours anchor to the next opening. It was being handed the wrong
 * number of seconds.
 *
 * Four quantities, and the tests keep them apart:
 *
 *   *elapsed real time* — wall clock, including the night. Never scheduled.
 *   *worked seconds* — what the person logged. Never modified.
 *   *remaining workload* — budget minus worked, floored at zero.
 *   *scheduled completion* — the remainder through the office calendar.
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
const M = 60;
/* 30 July 2026 is a Thursday. */
const AT_0453 = Date.parse("2026-07-29T23:23:00.000Z"); // 04:53 IST, before opening
const AT_0930 = Date.parse("2026-07-30T04:00:00.000Z");
const AT_1700 = Date.parse("2026-07-30T11:30:00.000Z");
const IST = {
  "30 Jul 09:30": "2026-07-30T04:00:00.000Z",
  "30 Jul 11:25": "2026-07-30T05:55:00.000Z",
  "30 Jul 11:30": "2026-07-30T06:00:00.000Z",
  "30 Jul 18:30": "2026-07-30T13:00:00.000Z",
  "31 Jul 10:00": "2026-07-31T04:30:00.000Z",
};

const T646 = (loggedSecs: number) => ({
  taskId: "T646",
  assigneeIds: ["PRAMOD"],
  priority: 1,
  senderTimerWindowSecs: 2 * H,
  loggedSecs,
});

const chain = (queue: unknown[], anchorMs: number) =>
  chainDeadlines({ queue: queue as never, anchorMs, addWorkingSecs: work });

/* ── Scenario 1 · Before the office opens ─────────────────────────────────── */

test("five minutes worked at 04:53 gives 11:25, not 11:30", () => {
  const [t] = chain([T646(5 * M)], AT_0453);

  /* 2h budget − 5m worked = 1h55m, laid out from the 09:30 opening. */
  assert.equal(remainingWorkSecs(T646(5 * M)), 115 * M);
  assert.equal(t.dueDate, IST["30 Jul 11:25"]);

  /* Without the deduction — the shipped behaviour — it was 11:30. Pinned so
     the difference the fix makes is visible in the test itself. */
  assert.equal(work(AT_0453, 2 * H), IST["30 Jul 11:30"]);
  assert.notEqual(t.dueDate, IST["30 Jul 11:30"]);
});

test("the pre-dawn hours are not scheduled as working time", () => {
  /* Nothing between 04:53 and 09:30 is consumed: an anchor before opening and
     an anchor AT opening produce the same date for the same remainder. */
  const early = chain([T646(5 * M)], AT_0453)[0];
  const atOpen = chain([T646(5 * M)], AT_0930)[0];
  assert.equal(early.dueDate, atOpen.dueDate);
});

test("the logged figure itself is never touched", () => {
  /* Rule 4. The office calendar reduces nothing the person recorded. */
  const task = T646(5 * M);
  chain([task], AT_0453);
  assert.equal(task.loggedSecs, 5 * M);
  /* And the ALLOCATED budget still reads as two hours everywhere it is shown
     — the remainder is a scheduling quantity, not a new budget. */
  assert.equal(resolveTimeBudget(task), 2 * H);
  assert.equal(windowSecsFor(task as never), 2 * H);
});

/* ── Scenario 2 · Inside office hours ─────────────────────────────────────── */

test("a timer started during office hours is unchanged", () => {
  /* Nothing logged: the full budget, from now. */
  const fresh = chain([T646(0)], AT_0930)[0];
  assert.equal(fresh.dueDate, IST["30 Jul 11:30"]);

  /* And with work done, the same deduction applies inside hours as outside —
     there is one rule, not an out-of-hours special case. */
  const partly = chain([T646(30 * M)], AT_0930)[0];
  assert.equal(partly.dueDate, "2026-07-30T05:30:00.000Z"); // 11:00 IST
});

/* ── Scenario 3 · Across closing time ─────────────────────────────────────── */

test("only the in-office portion of an evening session is scheduled", () => {
  /* Started 17:00, two hours of budget, nothing logged: 1.5h fits before
     18:30 and the last half hour resumes at 09:30 the next working day. */
  const t = chain([T646(0)], AT_1700)[0];
  assert.equal(t.dueDate, IST["31 Jul 10:00"]);

  /* Somebody who worked 17:00–19:00 logged two hours — all of it counts, and
     the task is then fully worked, so nothing remains to schedule. */
  const worked = T646(2 * H);
  assert.equal(remainingWorkSecs(worked), 0);
  /* Still IN the queue — it is not submitted — but consuming no further time,
     so it cannot push the work behind it. */
  assert.equal(windowSecsFor(worked as never), 2 * H);
  const [first, second] = chain(
    [worked, { ...T646(0), taskId: "T647", priority: 2, senderTimerWindowSecs: H }],
    AT_1700,
  );
  assert.equal(first.taskId, "T646");
  assert.equal(second.taskId, "T647");
  /* The exhausted task consumes nothing, so T647 starts where T646 was
     anchored — 17:00, with an hour of office day left. */
  assert.equal(first.dueDate, work(AT_1700, 0));
  assert.equal(second.dueDate, "2026-07-30T12:30:00.000Z"); // 18:00 IST
});

test("overrunning the budget never drags the queue backwards", () => {
  /* Somebody may log more than they were given. A negative remainder would run
     the chain in reverse, pulling every task behind it earlier. */
  const over = T646(5 * H);
  assert.equal(remainingWorkSecs(over), 0);
  const [t] = chain([over], AT_0930);
  /* Zero remaining lands exactly at the anchor — it consumes nothing and
     delays nothing. */
  assert.equal(t.dueDate, work(AT_0930, 0));
  assert.ok(Date.parse(t.dueDate!) >= AT_0930);
});

/* ── Scenario 4 · Pauses and resumes across days ──────────────────────────── */

test("accumulated time across many sessions is one deduction", () => {
  /* The timer stores a running total, so a task paused and resumed four times
     over three days reaches the chain as a single number. What matters is that
     the chain reads the TOTAL and schedules only what is left. */
  const sessions = [20 * M, 15 * M, 40 * M, 10 * M]; // 1h25m over four sittings
  const total = sessions.reduce((a, b) => a + b, 0);
  assert.equal(total, 85 * M);

  const t = chain([T646(total)], AT_0453)[0];
  /* 2h − 1h25m = 35m, from the 09:30 opening. */
  assert.equal(remainingWorkSecs(T646(total)), 35 * M);
  assert.equal(t.dueDate, "2026-07-30T04:35:00.000Z"); // 10:05 IST
});

test("a queue of part-worked tasks chains on remainders, not budgets", () => {
  const queue = [
    { taskId: "A", assigneeIds: ["P"], priority: 1, senderTimerWindowSecs: 2 * H, loggedSecs: 1 * H },
    { taskId: "B", assigneeIds: ["P"], priority: 2, senderTimerWindowSecs: 2 * H, loggedSecs: 0 },
  ];
  const [a, b] = chain(queue, AT_0930);
  /* A has an hour left: 09:30 → 10:30. B follows with its full two: → 12:30. */
  assert.equal(a.dueDate, "2026-07-30T05:00:00.000Z"); // 10:30 IST
  assert.equal(b.dueDate, "2026-07-30T07:00:00.000Z"); // 12:30 IST

  /* Scheduling the budgets instead puts B an hour later — the hour already
     worked on A, planned a second time. */
  const naive = chain(
    queue.map((q) => ({ ...q, loggedSecs: 0 })),
    AT_0930,
  );
  assert.equal(naive[1].dueDate, "2026-07-30T08:00:00.000Z"); // 13:30 IST
  assert.equal(
    (Date.parse(naive[1].dueDate!) - Date.parse(b.dueDate!)) / 1000,
    1 * H,
  );
});

/* ── The quantities stay apart ────────────────────────────────────────────── */

test("missing timer data schedules full budgets rather than guessing", () => {
  /* Absent means "none recorded", not "none done". Falling back to the whole
     budget is pessimistic, which is the safe direction for a prediction. */
  const noField = { taskId: "X", senderTimerWindowSecs: 2 * H };
  assert.equal(remainingWorkSecs(noField), 2 * H);
  for (const junk of [null, undefined, "", "abc", -50]) {
    assert.equal(remainingWorkSecs({ ...noField, loggedSecs: junk }), 2 * H);
  }
});

test("a task with no budget stays out of the chain whatever it logged", () => {
  /* The occupancy test reads the ALLOCATED budget, so this is unchanged by the
     deduction — a task with no hours has no slot, worked or not. */
  const none = { taskId: "Y", senderTimerWindowSecs: 0, loggedSecs: 3 * H };
  assert.equal(windowSecsFor(none as never), 0);
  assert.equal(chain([none], AT_0930).length, 0);
});
