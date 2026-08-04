import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EXCLUDED_STATUSES,
  RECENT_START_MS,
  UNRANKED_SENTINEL,
  anchorMsFor,
  chainDeadlines,
  officeOpenMsFor,
  queueFor,
  rankOf,
  startedAtMs,
  windowSecsFor,
  type QueueTask,
} from "./priorityDeadline.ts";

/**
 * Priority moves deadlines, and it must not silently stop.
 *
 * **The reported fault**: changing a task's priority left every due date where
 * it was. In Cowork a person's tasks are one queue and each starts when the one
 * ahead finishes, so a re-rank is a re-schedule — writing the rank alone is
 * only half the operation.
 *
 * **The trap this file also guards.** `cowork-old-frontend` contains TWO
 * priority→deadline implementations. `recalcDueDateForPriorityChange`
 * (`page.js:1818`) is a single-task re-anchor and is **never called**. The live
 * one is inline in the drag handler (`page.js:5768-5817`) and rewrites the
 * whole queue as a chain. These tests encode the live one; porting the dead one
 * would have produced plausible dates the old app never computes.
 */

const HOUR = 3600;
const T0 = Date.parse("2026-07-29T04:00:00.000Z"); // 09:30 IST

function task(over: Partial<QueueTask> & { taskId: string }): QueueTask {
  return {
    parentTaskId: null,
    status: "in_progress",
    assigneeIds: ["e-1"],
    deadlineWindowSecs: HOUR,
    ...over,
  };
}

/** A stand-in for legacy's office-hours arithmetic: plain wall-clock addition. */
const plainAdd = (anchorMs: number, windowSecs: number) =>
  new Date(anchorMs + windowSecs * 1000).toISOString();

/* ── The chain — the behaviour that was missing entirely ──────────────────── */

test("each task starts when the one ahead of it finishes", () => {
  /* THE regression. Without the anchor advancing, every task in the queue gets
     the same date and the queue means nothing. */
  const moved = chainDeadlines({
    queue: [
      task({ taskId: "a", deadlineWindowSecs: HOUR }),
      task({ taskId: "b", deadlineWindowSecs: 2 * HOUR }),
      task({ taskId: "c", deadlineWindowSecs: HOUR }),
    ],
    anchorMs: T0,
    addWorkingSecs: plainAdd,
  });

  assert.deepEqual(moved.map((m) => m.taskId), ["a", "b", "c"]);
  assert.equal(moved[0].dueDate, new Date(T0 + 1 * HOUR * 1000).toISOString());
  assert.equal(moved[1].dueDate, new Date(T0 + 3 * HOUR * 1000).toISOString());
  assert.equal(moved[2].dueDate, new Date(T0 + 4 * HOUR * 1000).toISOString());

  const distinct = new Set(moved.map((m) => m.dueDate));
  assert.equal(distinct.size, 3, "the chain collapsed — dates are not sequential");
});

test("promoting a task pulls its deadline earlier, and pushes the rest later", () => {
  /* P5 → P1. The end-to-end assertion the fix exists for: the same three tasks,
     reordered, produce different dates for every one of them. */
  const before = chainDeadlines({
    queue: [task({ taskId: "x" }), task({ taskId: "y" }), task({ taskId: "z" })],
    anchorMs: T0,
    addWorkingSecs: plainAdd,
  });
  const after = chainDeadlines({
    queue: [task({ taskId: "z" }), task({ taskId: "x" }), task({ taskId: "y" })],
    anchorMs: T0,
    addWorkingSecs: plainAdd,
  });

  const dueOf = (rows: typeof before, id: string) =>
    Date.parse(rows.find((r) => r.taskId === id)!.dueDate);

  assert.ok(dueOf(after, "z") < dueOf(before, "z"), "promoted task did not move earlier");
  assert.ok(dueOf(after, "x") > dueOf(before, "x"), "displaced task did not move later");
  assert.ok(dueOf(after, "y") > dueOf(before, "y"), "displaced task did not move later");
});

test("demoting reverses it — P1 → P5 pushes that task out", () => {
  const asP1 = chainDeadlines({
    queue: [task({ taskId: "m" }), task({ taskId: "n" })],
    anchorMs: T0,
    addWorkingSecs: plainAdd,
  });
  const asP2 = chainDeadlines({
    queue: [task({ taskId: "n" }), task({ taskId: "m" })],
    anchorMs: T0,
    addWorkingSecs: plainAdd,
  });
  const dueOf = (rows: typeof asP1, id: string) =>
    Date.parse(rows.find((r) => r.taskId === id)!.dueDate);
  assert.ok(dueOf(asP2, "m") > dueOf(asP1, "m"));
});

test("a task with no window is skipped, not given a zero-length slot", () => {
  /* A zero window written as a date equal to the anchor would claim the task
     finishes the instant the one before it does. */
  const moved = chainDeadlines({
    queue: [
      task({ taskId: "a" }),
      task({ taskId: "no-window", deadlineWindowSecs: 0, senderTimerWindowSecs: 0 }),
      task({ taskId: "b" }),
    ],
    anchorMs: T0,
    addWorkingSecs: plainAdd,
  });
  assert.deepEqual(moved.map((m) => m.taskId), ["a", "b"]);
  assert.equal(moved[1].dueDate, new Date(T0 + 2 * HOUR * 1000).toISOString());
});

/* ── Which tasks are in the queue ─────────────────────────────────────────── */

test("only this person's unfinished, budgeted siblings are scheduled", () => {
  const queue = queueFor({
    employeeId: "e-1",
    parentTaskId: null,
    tasks: [
      task({ taskId: "keep", priority: 2 }),
      task({ taskId: "done", status: "done" }),
      task({ taskId: "cancelled", status: "cancelled" }),
      task({ taskId: "no-window", deadlineWindowSecs: 0 }),
      task({ taskId: "someone-else", assigneeIds: ["e-2"] }),
      task({ taskId: "other-parent", parentTaskId: "p-9" }),
    ],
  });
  assert.deepEqual(queue.map((t) => t.taskId), ["keep"]);
});

test("subtasks of different parents are different queues", () => {
  /* Laying them end-to-end would schedule unrelated work in sequence. */
  const queue = queueFor({
    employeeId: "e-1",
    parentTaskId: "p-1",
    tasks: [
      task({ taskId: "mine", parentTaskId: "p-1" }),
      task({ taskId: "theirs", parentTaskId: "p-2" }),
      task({ taskId: "root", parentTaskId: null }),
    ],
  });
  assert.deepEqual(queue.map((t) => t.taskId), ["mine"]);
});

test("the queue is ordered most urgent first, by THIS person's rank", () => {
  /* `assigneePriorities[me] ?? priority ?? 999`. Two assignees can hold
     different ranks on one task, and ordering by the shared `priority` would
     sort everyone's queue by one colleague's position. */
  const queue = queueFor({
    employeeId: "e-1",
    parentTaskId: null,
    tasks: [
      task({ taskId: "third", assigneePriorities: { "e-1": 7 }, priority: 1 }),
      task({ taskId: "first", assigneePriorities: { "e-1": 1 }, priority: 9 }),
      task({ taskId: "second", priority: 4 }),
    ],
  });
  assert.deepEqual(queue.map((t) => t.taskId), ["first", "second", "third"]);
});

test("an unranked task sorts last rather than first", () => {
  assert.equal(rankOf(task({ taskId: "x" }), "e-1"), UNRANKED_SENTINEL);
  assert.equal(rankOf(task({ taskId: "x", priority: 3 }), "e-1"), 3);
  assert.equal(
    rankOf(task({ taskId: "x", priority: 3, assigneePriorities: { "e-1": 1 } }), "e-1"),
    1,
    "the per-person rank wins over the shared one",
  );
});

test("only done and cancelled are excluded — a task in review still occupies time", () => {
  /* The live path's list is narrower than the dead function's. Work awaiting
     review has not stopped consuming the person's queue. */
  assert.deepEqual(EXCLUDED_STATUSES, ["done", "cancelled"]);
  const queue = queueFor({
    employeeId: "e-1",
    parentTaskId: null,
    tasks: [task({ taskId: "in-review", status: "in_review" })],
  });
  assert.deepEqual(queue.map((t) => t.taskId), ["in-review"]);
});

/* ── Where the chain starts ───────────────────────────────────────────────── */

test("a running leader does NOT move the anchor", () => {
  /* The reported jump. A task with no start anchored at the office opening, and
     pressing play switched the anchor to `startedAt` — so the due date moved the
     instant work began, 17:22 to 17:20, with nothing about the work changing. A
     commitment is decided once; starting a timer is not one of the four things
     allowed to move it. */
  const openMs = T0 - 5 * HOUR * 1000;
  const started = T0 - 2 * HOUR * 1000;
  assert.equal(
    anchorMsFor({
      leader: task({ taskId: "a", startedAt: new Date(started).toISOString() }),
      officeOpenMs: openMs,
      nowMs: T0,
    }),
    openMs,
  );
});

test("a stale start is ignored — the queue anchors at office open", () => {
  /* Yesterday's start would schedule today's work into the past. */
  const stale = T0 - RECENT_START_MS - 1;
  const officeOpen = T0 - HOUR * 1000;
  assert.equal(
    anchorMsFor({
      leader: task({ taskId: "a", startedAt: new Date(stale).toISOString() }),
      officeOpenMs: officeOpen,
      nowMs: T0,
    }),
    officeOpen,
  );
});

test("a queue that has not started anchors at office open", () => {
  const officeOpen = T0 - HOUR * 1000;
  assert.equal(
    anchorMsFor({ leader: task({ taskId: "a" }), officeOpenMs: officeOpen, nowMs: T0 }),
    officeOpen,
  );
  assert.equal(
    anchorMsFor({ leader: undefined, officeOpenMs: officeOpen, nowMs: T0 }),
    officeOpen,
  );
});

test("Firestore timestamps, ISO strings and epoch ms all read as a start", () => {
  assert.equal(startedAtMs({ seconds: 1_800_000 }), 1_800_000_000);
  assert.equal(startedAtMs({ _seconds: 1_800_000 }), 1_800_000_000);
  assert.equal(startedAtMs(1_800_000_000), 1_800_000_000);
  assert.equal(startedAtMs("2026-07-29T04:00:00.000Z"), T0);
  assert.equal(startedAtMs(null), null);
  assert.equal(startedAtMs("not a date"), null);
});

test("an UNKNOWN schedule anchors at the start of the day, not at now", () => {
  /* Reversed from the original rule, which returned `nowMs` here so a queue
     would not be scheduled into the past. A due date that has already passed
     means the work is LATE — information, not a defect. An anchor that follows
     the clock is a deadline nobody can miss, because it retreats as they
     approach it. */
  const midnight = new Date(T0).setHours(0, 0, 0, 0);
  assert.equal(officeOpenMsFor(null, T0), midnight);
  assert.equal(officeOpenMsFor({ wednesday: { inTime: "oops" } }, T0), midnight);
});

test("a day explicitly marked OFF anchors at midnight, not at now", () => {
  /* The exception, and the reason for it: a day the schedule says is off
     contributes no working seconds, so `addWorkingSecs` reaches the same next
     working period from midnight as from any hour of it — nothing is scheduled
     into the past. What midnight buys is that the answer does not MOVE. With
     `nowMs` the projection crept forward on every read, all through every
     Sunday and holiday, which is the "expected completion goes up on its own"
     report. See `anchorStability.test.ts`. */
  const at = officeOpenMsFor({ wednesday: { isOff: true } }, T0);
  assert.notEqual(at, T0);
  assert.equal(new Date(at).getHours(), 0);
  assert.equal(new Date(at).getDate(), new Date(T0).getDate());
});

/* ── The window ───────────────────────────────────────────────────────────── */

test("the agreed window wins over the assignor's offer", () => {
  assert.equal(
    windowSecsFor(task({ taskId: "x", deadlineWindowSecs: 100, senderTimerWindowSecs: 900 })),
    100,
  );
  assert.equal(
    windowSecsFor(task({ taskId: "x", deadlineWindowSecs: 0, senderTimerWindowSecs: 900 })),
    900,
  );
  assert.equal(
    windowSecsFor(task({ taskId: "x", deadlineWindowSecs: 0, senderTimerWindowSecs: 0 })),
    0,
  );
});
