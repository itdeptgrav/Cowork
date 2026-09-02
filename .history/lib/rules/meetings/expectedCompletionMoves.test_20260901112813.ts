cimport assert from "node:assert/strict";
import { test } from "node:test";

import {
  chainDeadlines,
  windowSecsFor,
  type QueueTask,
} from "../tasks/priorityDeadline.ts";

/**
 * Expected completion has to move by the meeting, and it did not.
 *
 * ## What was reported
 *
 * "This one increases but deadline not increase." The slack line — *Finishes
 * 06:05:19 before the requested deadline* — grew by exactly the meeting's
 * 00:01:08, and **Expected completion** sat at 04:11 IST before and after.
 *
 * That combination is the diagnosis, not a detail. Slack is the gap between
 * the two dates; if it GREW by the meeting, only the requested deadline moved.
 * The person was handed free slack rather than having the work pushed back,
 * which is the opposite of what meeting credit is for: the meeting cost them
 * those minutes, so the work finishes later AND the commitment moves with it,
 * leaving the slack exactly where it was.
 *
 * ## Why it could not move
 *
 * Expected completion is not stored. It is computed — `chainDeadlines` lays the
 * queue end to end, and each task occupies `windowSecsFor`, which is
 * `resolveTimeBudget`, which reads `agreedWindowSecs` before anything else.
 * The settlement wrote the grown budget to `deadlineWindowSecs` and
 * `senderTimerWindowSecs` only, and on every accepted task `agreedWindowSecs`
 * shadows both. So the chain went on scheduling the ORIGINAL budget and
 * produced the original date, for ever.
 *
 * One misdirected write, two broken figures: the budget printed on the panel
 * and the completion date computed from it.
 *
 * These hold the computation end to end — write shape in, date out — because
 * asserting the write alone is what let this survive a fix.
 */

const HOUR = 3600;
const T0 = Date.parse("2026-08-13T04:00:00.000Z");
const MEETING = 68; /* 00:01:08, the reported meeting */

/** Working time with no calendar in the way, so the arithmetic is visible. */
const addWorkingSecs = (anchorMs: number, secs: number) =>
  new Date(anchorMs + secs * 1000).toISOString();

const task = (taskId: string, fields: Partial<QueueTask>): QueueTask =>
  ({ taskId, ...fields }) as QueueTask;

/** What the settlement wrote BEFORE the fix: the two mirrors only. */
const mirrorsOnly = (agreed: number, grown: number) => ({
  agreedWindowSecs: agreed,
  deadlineWindowSecs: grown,
  senderTimerWindowSecs: grown,
});

/** What it writes now: the field the read wins on, plus the mirrors. */
const winningField = (grown: number) => ({
  agreedWindowSecs: grown,
  deadlineWindowSecs: grown,
  senderTimerWindowSecs: grown,
});

/* ── The window the chain schedules ───────────────────────────────────────── */

test("the old write left the chain scheduling the original budget", () => {
  const t = task("T", mirrorsOnly(2 * HOUR, 2 * HOUR + MEETING));
  assert.equal(
    windowSecsFor(t),
    2 * HOUR,
    "this is the 02:00:00 the panel kept printing after every meeting",
  );
});

test("the new write is what the chain schedules", () => {
  const t = task("T", winningField(2 * HOUR + MEETING));
  assert.equal(windowSecsFor(t), 2 * HOUR + MEETING);
});

/* ── And therefore the date ───────────────────────────────────────────────── */

test("expected completion moves by the meeting, and only by the meeting", () => {
  const before = chainDeadlines({
    queue: [task("T", { agreedWindowSecs: 2 * HOUR })],
    anchorMs: T0,
    addWorkingSecs,
    budget: "full",
  });
  const after = chainDeadlines({
    queue: [task("T", winningField(2 * HOUR + MEETING))],
    anchorMs: T0,
    addWorkingSecs,
    budget: "full",
  });

  const moved =
    (Date.parse(after[0].dueDate) - Date.parse(before[0].dueDate)) / 1000;
  assert.equal(moved, MEETING, "the completion date did not move by the meeting");
});

test("the old write moved the date by nothing at all", () => {
  /* The reported observation, reproduced: 04:11 before, 04:11 after. */
  const before = chainDeadlines({
    queue: [task("T", { agreedWindowSecs: 2 * HOUR })],
    anchorMs: T0,
    addWorkingSecs,
    budget: "full",
  });
  const after = chainDeadlines({
    queue: [task("T", mirrorsOnly(2 * HOUR, 2 * HOUR + MEETING))],
    anchorMs: T0,
    addWorkingSecs,
    budget: "full",
  });
  assert.equal(after[0].dueDate, before[0].dueDate);
});

/* ── The whole queue, which is what a person actually sees ────────────────── */

test("every task behind the head shifts by the meeting, once", () => {
  /* Only the head's budget grows. Everything behind it starts when it finishes,
     so the shift carries — by the same seconds, not compounding. That is why a
     task whose own budget is unchanged still finishes later, and why a reader
     checking a task that is not their head sees the date move and the budget
     stand still. Both are correct. */
  const queue = (headBudget: number) => [
    task("P1", {
      agreedWindowSecs: headBudget,
      assigneePriorities: { u: 1 },
      priority: 1,
    }),
    task("P2", { agreedWindowSecs: 1 * HOUR, priority: 2 }),
    task("P3", { agreedWindowSecs: 1 * HOUR, priority: 3 }),
  ];

  const before = chainDeadlines({
    queue: queue(2 * HOUR),
    anchorMs: T0,
    addWorkingSecs,
    budget: "full",
  });
  const after = chainDeadlines({
    queue: queue(2 * HOUR + MEETING),
    anchorMs: T0,
    addWorkingSecs,
    budget: "full",
  });

  const shift = (id: string) =>
    (Date.parse(after.find((c) => c.taskId === id)!.dueDate) -
      Date.parse(before.find((c) => c.taskId === id)!.dueDate)) /
    1000;

  assert.deepEqual(
    [shift("P1"), shift("P2"), shift("P3")],
    [MEETING, MEETING, MEETING],
    "the line must move by the meeting once — not 68, 136, 204",
  );
});

test("a task with no budget at all is untouched", () => {
  /* A fixed-deadline task has no window to grow, and the chain skips it rather
     than giving it a zero-length slot. */
  assert.equal(windowSecsFor(task("F", {})), 0);
  const chained = chainDeadlines({
    queue: [task("F", {})],
    anchorMs: T0,
    addWorkingSecs,
    budget: "full",
  });
  assert.deepEqual(chained, []);
});
