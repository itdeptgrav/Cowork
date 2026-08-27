import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateDeadlineFeasibility } from "./deadlineFeasibility.ts";
import { chainDeadlines } from "./priorityDeadline.ts";
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
    /**
     * Supplied, because production always supplies it —
     * `officeOpenMsFor(policy.schedule, ...)` at both call sites in the legacy
     * repository. Omitting it fell through to `setHours(0,0,0,0)`, a
     * placeholder chosen for being FIXED rather than meaningful, and the
     * fixture then only agreed with the code by accident: the displayed start
     * used to be `nowMs`, which happened to equal 09:30 here.
     *
     * `estimatedStartTime` now reports the anchor the chain actually used, so
     * the fixture has to describe a real office day like the product does.
     */
    officeOpenMs: Date.parse(AT["09:30"]),
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

/* ── Start and completion must come from one anchor ───────────────────────── */

/**
 * **The reported panel.** A placement preview showed:
 *
 *     Estimated start       21 Aug 2026 · 13:25 IST
 *     Estimated completion  21 Aug 2026 · 17:21 IST
 *
 * Four minutes apart on a four-hour budget, because they were computed from
 * different anchors. The completion came from `chainDeadlines`, which anchors
 * at the office opening and floors each task at its own `createdAtMs`. The
 * start was `new Date(input.nowMs)` — the moment the dialog happened to be
 * opened, which is neither.
 *
 * `chainDeadlines` already knew the answer; it just was not returning it. Now
 * it does, and the preview reads it rather than guessing a second time.
 */

test("the start reported is the one the chain actually used", () => {
  const r = ask({ proposedPriority: 1 });
  /* At the front, so nothing is ahead and the chain anchors at the opening. */
  assert.equal(r.estimatedStartTime, AT["09:30"]);
  /* And the completion is that start plus the budget — by construction, not
     by coincidence. `work` is the fixture's plain-addition calendar. */
  assert.equal(
    r.estimatedCompletionTime,
    work(Date.parse(r.estimatedStartTime!), 4 * H),
  );
});

test("behind other work, the pair still corresponds", () => {
  const r = ask();
  assert.equal(r.estimatedStartTime, AT["12:30"]);
  assert.equal(
    r.estimatedCompletionTime,
    work(Date.parse(r.estimatedStartTime!), 4 * H),
  );
});

test("the chain hands back the start it used, for every task", () => {
  /**
   * Pinned at the source. Returning only `dueDate` is what forced callers to
   * re-derive a start, and a re-derivation is free to disagree.
   */
  const r = ask();
  for (const row of r.simulatedQueue) {
    assert.ok(row.completionTime, `${row.taskId} has no completion`);
  }
  /* P1 leads, so its start is the opening; P2 starts where P1 ends. */
  assert.equal(r.simulatedQueue[0].completionTime, AT["11:30"]);
  assert.equal(r.simulatedQueue[1].completionTime, AT["12:30"]);
});

/* ── One start per person ─────────────────────────────────────────────────── */

/**
 * **The queue's start does not change with whichever task leads it.**
 * OWNER RULE, 21 Aug 2026.
 *
 * Reported with real documents: Cowork meet (raised 12:28:55) leading showed a
 * start of 12:28:55; Dev (raised 13:21:24) leading showed 13:21:24. Same
 * person, same queue, two different answers to "when does this start" — because
 * the chain floored every task at its own `createdAtMs`, including the head.
 *
 * The head is now anchored where the person became available to the queue: the
 * day's opening, floored at the EARLIEST task in it. `rechainQueueFor` computes
 * the identical figure as `queueAnchorMs`, so the preview and the apply cannot
 * promise different dates.
 */

const OPEN = Date.parse(AT["09:30"]);
const first = { taskId: "FIRST", createdAtMs: OPEN + 3 * H, deadlineWindowSecs: 2 * H };
const later = { taskId: "LATER", createdAtMs: OPEN + 4 * H, deadlineWindowSecs: 2 * H };
const chain = (queue: unknown[]) =>
  chainDeadlines({
    queue: queue as never,
    anchorMs: OPEN,
    addWorkingSecs: work,
    budget: "full",
  });

test("the head starts at the queue's start, whichever task leads", () => {
  const a = chain([first, later]);
  const b = chain([later, first]);
  assert.equal(a[0].startsAt, b[0].startsAt, "the queue start moved with the order");
  /* And that start is the earliest task in the queue, not the head's own. */
  assert.equal(Date.parse(a[0].startsAt), OPEN + 3 * H);
});

test("a task raised later IS charged from the queue's start when it leads", () => {
  /* The deliberate cost of one shared number, stated so nobody rediscovers it
     as a surprise: LATER was raised an hour after the queue began, and leading
     it does not buy that hour back. */
  const led = chain([later, first]);
  assert.equal(Date.parse(led[0].startsAt), OPEN + 3 * H);
  assert.ok(Date.parse(led[0].startsAt) < (later.createdAtMs as number));
});

test("the queue start never precedes the work existing", () => {
  /* Without the floor, a queue would begin at an opening hours before any of
     its tasks were raised. */
  const late = chain([
    { taskId: "L1", createdAtMs: OPEN + 5 * H, deadlineWindowSecs: H },
    { taskId: "L2", createdAtMs: OPEN + 6 * H, deadlineWindowSecs: H },
  ]);
  assert.equal(Date.parse(late[0].startsAt), OPEN + 5 * H);
});

test("everything below the head still cannot start before it was raised", () => {
  /* The head takes the queue's start; the rest keep their own floor, so a task
     raised at 14:00 is not scheduled from 12:30 just because the queue was
     free then. */
  const short = { taskId: "SHORT", createdAtMs: OPEN, deadlineWindowSecs: 0.5 * H };
  const r = chain([short, later]);
  assert.ok(Date.parse(r[1].startsAt) >= (later.createdAtMs as number));
});
