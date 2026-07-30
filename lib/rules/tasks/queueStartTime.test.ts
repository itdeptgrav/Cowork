import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateDeadlineFeasibility } from "./deadlineFeasibility.ts";
import { addWorkingSecs } from "../../legacy-ui/officeDueDate.js";

/**
 * A task starts when the work ahead of it ends. Nothing else.
 *
 * **T648.** A four-hour task, third in Pramod's queue behind three hours of
 * committed work, reported a 09:30 start and a completion three hours early.
 * The engine was right and was being lied to: the caller had no position to
 * give, so it invented one.
 *
 *   proposedPriority={view.myRank ?? view.myStoredRank ?? 1}
 *
 * Both of those are null unless the VIEWER is an assignee — the mapper says so
 * explicitly — and a manager sizing a cross-department task never is. So it
 * fell to 1, the task was simulated at the FRONT of somebody else's queue,
 * nothing was ahead of it, and it started now.
 *
 * The position is now the RULE's to resolve: where the task already sits, or
 * the back of the queue for one that has not joined it. There is no default of
 * 1 anywhere, and these tests fail if one comes back.
 */

/* Cowork's real office day. 09:30 is the open time, which is exactly the
   figure the bug produced — that is what "started now, at the front" looks
   like on the first task of a morning. */
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
const work = (anchorMs: number, secs: number) =>
  addWorkingSecs(anchorMs, secs, SCHEDULE, new Set<string>(), []);

const H = 3600;
/* Monday 09:30 IST — the moment the office opens. */
const MON_0930 = Date.parse("2026-08-03T04:00:00.000Z");
const AT = {
  "09:30": "2026-08-03T04:00:00.000Z",
  "11:30": "2026-08-03T06:00:00.000Z",
  "12:30": "2026-08-03T07:00:00.000Z",
  "16:30": "2026-08-03T11:00:00.000Z",
};

const task = (over: Record<string, unknown>) =>
  ({ status: "in_progress", assigneeIds: ["PRAMOD"], ...over }) as never;

/* Pramod's desk, exactly as reported. */
const P1 = task({
  taskId: "P1",
  title: "Existing task",
  senderTimerWindowSecs: 2 * H,
  priority: 1,
});
const P2 = task({
  taskId: "P2",
  title: "Existing task",
  senderTimerWindowSecs: 1 * H,
  priority: 2,
});
const T648 = task({
  taskId: "T648",
  title: "T648",
  senderTimerWindowSecs: 4 * H,
  priority: 3,
});

const ask = (over: Record<string, unknown> = {}) =>
  calculateDeadlineFeasibility({
    employeeId: "PRAMOD",
    taskId: "T648",
    estimatedWorkSeconds: 4 * H,
    committedDeadline: null,
    tasks: [P1, P2, T648],
    nowMs: MON_0930,
    addWorkingSecs: work,
    ...over,
  });

/* ── The reported case ────────────────────────────────────────────────────── */

test("T648 starts when P1 and P2 finish, not when the office opens", () => {
  const r = ask();

  /* P1: 09:30 + 2h = 11:30. P2: 11:30 + 1h = 12:30. T648 starts there. */
  assert.equal(r.simulatedPosition, 3);
  assert.equal(r.estimatedStartTime, AT["12:30"]);
  assert.notEqual(
    r.estimatedStartTime,
    AT["09:30"],
    "T648 started at the office open time — it is at the front of the queue again",
  );
  /* 12:30 + 4 working hours, inside a day that closes at 18:30. */
  assert.equal(r.estimatedCompletionTime, AT["16:30"]);

  /* Both tasks ahead are named, with their real budgets. */
  assert.deepEqual(
    r.blockingTasks.map((b) => [b.taskId, b.estimatedDuration]),
    [
      ["P1", 2 * H],
      ["P2", 1 * H],
    ],
  );
});

test("the whole queue chains: each task starts where the one above it ends", () => {
  const r = ask();
  assert.deepEqual(
    r.simulatedQueue.map((e) => [e.taskId, e.position, e.completionTime]),
    [
      ["P1", 1, AT["11:30"]],
      ["P2", 2, AT["12:30"]],
      ["T648", 3, AT["16:30"]],
    ],
  );
});

/* ── The root cause, pinned ───────────────────────────────────────────────── */

test("an absent position means where it IS, never the front", () => {
  /* The regression itself. Omitting the position must never behave like 1. */
  const omitted = ask();
  const atFront = ask({ proposedPriority: 1 });

  assert.equal(omitted.simulatedPosition, 3);
  assert.equal(atFront.simulatedPosition, 1);
  assert.equal(atFront.estimatedStartTime, AT["09:30"]);
  assert.notEqual(omitted.estimatedStartTime, atFront.estimatedStartTime);
  assert.equal(omitted.blockingTasks.length, 2);
  assert.equal(atFront.blockingTasks.length, 0);
});

test("null is treated as absent, not as zero or one", () => {
  assert.equal(ask({ proposedPriority: null }).estimatedStartTime, AT["12:30"]);
  assert.equal(
    ask({ proposedPriority: undefined }).estimatedStartTime,
    AT["12:30"],
  );
});

test("a task not yet in the queue joins the back, which is the product's rule", () => {
  /* No taskId: work being sized before it is assigned. It must not land at the
     front of a queue it has not joined. */
  const r = calculateDeadlineFeasibility({
    employeeId: "PRAMOD",
    estimatedWorkSeconds: 4 * H,
    committedDeadline: null,
    tasks: [P1, P2],
    nowMs: MON_0930,
    addWorkingSecs: work,
  });
  assert.equal(r.simulatedPosition, 3);
  assert.equal(r.estimatedStartTime, AT["12:30"]);
  assert.equal(r.blockingTasks.length, 2);
});

test("an explicit position is still obeyed — this is a planner, after all", () => {
  const r = ask({ proposedPriority: 2 });
  assert.equal(r.simulatedPosition, 2);
  assert.equal(r.estimatedStartTime, AT["11:30"]);
});

/* ── What must NOT reach the start time ───────────────────────────────────── */

test("the assignor deadline checks feasibility and never moves the start", () => {
  const early = ask({ committedDeadline: "2026-08-03T05:00:00.000Z" }); // 10:30
  const late = ask({ committedDeadline: "2026-08-07T12:30:00.000Z" });

  for (const r of [early, late]) {
    assert.equal(r.estimatedStartTime, AT["12:30"]);
    assert.equal(r.estimatedCompletionTime, AT["16:30"]);
  }
  assert.equal(early.feasible, false);
  assert.equal(late.feasible, true);
});

test("creation order does not decide the queue — stored rank does", () => {
  /* Handed to the engine backwards. The answer must not move. */
  const forwards = ask();
  const backwards = ask({ tasks: [T648, P2, P1] });
  assert.equal(backwards.estimatedStartTime, forwards.estimatedStartTime);
  assert.deepEqual(
    backwards.simulatedQueue.map((e) => e.taskId),
    ["P1", "P2", "T648"],
  );
});

test("work that does not occupy the queue does not push the start", () => {
  /* Finished work, and work whose hours are still being argued over. Neither
     consumes time, so neither may delay T648 by a second. */
  const noise = [
    task({
      taskId: "DONE",
      title: "Finished",
      senderTimerWindowSecs: 40 * H,
      priority: 1,
      status: "completed",
    }),
    task({
      taskId: "ARGUING",
      title: "Unsettled budget",
      senderTimerWindowSecs: 40 * H,
      priority: 1,
      status: "pending_tl_hours",
    }),
  ];
  const r = ask({ tasks: [...noise, P1, P2, T648] });
  assert.equal(r.estimatedStartTime, AT["12:30"]);
  assert.equal(r.blockingTasks.length, 2);
});

test("somebody else's queue is not Pramod's", () => {
  /* A task ranked P1 for a colleague and not assigned to Pramod occupies none
     of his time. Reading the wrong person's rank is how a queue silently
     doubles in length. */
  const theirs = {
    taskId: "THEIRS",
    title: "Somebody else's P1",
    status: "in_progress",
    assigneeIds: ["OTHER"],
    senderTimerWindowSecs: 40 * H,
    assigneePriorities: { OTHER: 1 },
  } as never;
  const r = ask({ tasks: [theirs, P1, P2, T648] });
  assert.equal(r.estimatedStartTime, AT["12:30"]);
});

test("a per-assignee rank outranks the shared one", () => {
  /* `assigneePriorities[me] ?? priority` — a shared task carries one `priority`
     for everybody, so reading it for Pramod would order his day by a
     colleague's queue position. */
  const shared = task({
    taskId: "SHARED",
    title: "Shared",
    senderTimerWindowSecs: 5 * H,
    priority: 1,
    assigneeIds: ["PRAMOD", "OTHER"],
    assigneePriorities: { PRAMOD: 9, OTHER: 1 },
  });
  const r = ask({ tasks: [shared, P1, P2, T648] });
  /* P9 for Pramod: behind T648, so it cannot delay it. */
  assert.equal(r.estimatedStartTime, AT["12:30"]);
  assert.equal(r.simulatedPosition, 3);
});
