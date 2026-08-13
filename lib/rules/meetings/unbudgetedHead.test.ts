import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NO_MEETINGS,
  type SettlementTask,
  settleSession,
} from "./meetingCredit.ts";

/**
 * Every task the person holds gains the meeting — OWNER DECISION.
 *
 * ## What this replaced
 *
 * The credit used to grow exactly ONE window per person — the head of their
 * queue — and let the chain carry the shift to everything behind it. That kept
 * a person's line moving by the meeting once, and it had two consequences the
 * owner rejected:
 *
 *   1. the budget on the task people had just met about stood still unless that
 *      task happened to be their top-ranked one; and
 *   2. a person whose top-ranked live task was a FIXED-DEADLINE one — no budget
 *      to grow — lost the credit entirely, because the head failed the "has a
 *      window" guard and nothing else was eligible. Reported as five meetings
 *      running with the budget never moving once.
 *
 * Priority now decides nothing here. Every live task with a budget grows by the
 * meeting, and a task with no budget is skipped because there is no window to
 * put the time in — not because something else took it.
 *
 * The cost was stated when the decision was taken and is held below: a queue is
 * worked end to end, so growing every window slips the last task by the meeting
 * times the number of tasks ahead of it.
 */

const RECEIVER = "umung";
const SENDER = "soumya";
const T0 = Date.parse("2026-08-13T04:00:00.000Z");
const MEETING = 7 * 60; /* the reported seven-minute meeting */

const task = (
  taskId: string,
  rank: number,
  windowSecs: number | null,
): SettlementTask => ({
  taskId,
  status: "in_progress",
  assigneeIds: [RECEIVER],
  totals: NO_MEETINGS,
  dueAtMs: T0 + 8 * 3600_000,
  windowSecs,
  rank,
});

const meet = (tasks: SettlementTask[]) =>
  settleSession({
    session: {
      counterpartyId: SENDER,
      startedAtMs: T0,
      endedAtMs: T0 + MEETING * 1000,
      attendance: [
        { employeeId: SENDER, joinedAtMs: T0, leftAtMs: T0 + MEETING * 1000 },
        { employeeId: RECEIVER, joinedAtMs: T0, leftAtMs: T0 + MEETING * 1000 },
      ],
    },
    onTaskId: "HOST",
    receiverId: RECEIVER,
    tasksByEmployee: new Map([[RECEIVER, tasks]]),
  });

const grown = (r: ReturnType<typeof meet>) =>
  r.updates
    .filter((u) => u.newWindowSecs !== null)
    .map((u) => `${u.taskId}=${u.newWindowSecs}`);

/* ── The decision ─────────────────────────────────────────────────────────── */

test("every budgeted task the person holds grows by the meeting", () => {
  const r = meet([task("P1", 1, 3600), task("P2", 2, 7200), task("P3", 3, 1800)]);

  assert.deepEqual(grown(r), [
    `P1=${3600 + MEETING}`,
    `P2=${7200 + MEETING}`,
    `P3=${1800 + MEETING}`,
  ]);
});

test("priority decides nothing — the lowest-ranked task grows too", () => {
  /* The rule this replaced picked one task by rank. Rank is now read only for
     ordering; it changes nobody's credit. */
  const r = meet([task("LAST", 99, 3600), task("FIRST", 1, 3600)]);
  assert.equal(grown(r).length, 2);
});

test("a fixed-deadline task at the top no longer swallows the credit", () => {
  /* The reported failure. P1 has no budget; under the head rule it won the
     head, failed the guard, and took P2 down with it. */
  const r = meet([task("P1-fixed", 1, null), task("P2", 2, 7200)]);
  assert.deepEqual(grown(r), [`P2=${7200 + MEETING}`]);
});

test("a task with no budget is skipped, and still records the meeting", () => {
  /* There is no window to put the time in. The date still moves and the
     session is still recorded against it. */
  const r = meet([task("F", 1, null)]);
  assert.deepEqual(grown(r), []);
  assert.equal(r.updates.length, 1);
  assert.equal(r.updates[0].newDueAtMs! - (T0 + 8 * 3600_000), MEETING * 1000);
  assert.equal(r.updates[0].totals.totalSecs, MEETING);
});

test("a zero window counts as no window", () => {
  /* `queueOf` maps a zero budget to null, and a stray 0 must read the same way
     — a zero-second window in a queue is how a task lands ahead of work it
     cannot possibly precede. */
  const r = meet([task("P1-zero", 1, 0), task("P2", 2, 7200)]);
  assert.deepEqual(grown(r), [`P2=${7200 + MEETING}`]);
});

/* ── What the decision costs, stated rather than hidden ───────────────────── */

test("the queue compounds, and that is the accepted cost", () => {
  /* Every window grows by the meeting, and the tasks run one after another —
     so the third finishes three meetings later than it would have. This was
     shown as the trade-off when the decision was taken; it is held here so
     nobody re-derives it as a bug and quietly reverts the decision. */
  const r = meet([task("P1", 1, 3600), task("P2", 2, 3600), task("P3", 3, 3600)]);

  const total = r.updates.reduce(
    (n, u) => n + ((u.newWindowSecs ?? 0) - 3600),
    0,
  );
  assert.equal(
    total,
    3 * MEETING,
    "three tasks each gained the meeting, so the line gained three of them",
  );
});

test("every task's stored date moves by the meeting, once each", () => {
  /* The date axis is per task and was never affected by the head rule. */
  const r = meet([task("P1", 1, 3600), task("P2", 2, null)]);
  for (const u of r.updates) {
    assert.equal(u.newDueAtMs! - (T0 + 8 * 3600_000), MEETING * 1000);
  }
});

test("a session worth nothing grows no window and moves no date", () => {
  /* The counterparty never came. The meeting is recorded and costs nobody
     anything — the anti-cheat, unchanged by any of this. */
  const r = settleSession({
    session: {
      counterpartyId: SENDER,
      startedAtMs: T0,
      endedAtMs: T0 + MEETING * 1000,
      attendance: [
        { employeeId: RECEIVER, joinedAtMs: T0, leftAtMs: T0 + MEETING * 1000 },
      ],
    },
    onTaskId: "HOST",
    receiverId: RECEIVER,
    tasksByEmployee: new Map([[RECEIVER, [task("P1", 1, 3600)]]]),
  });

  assert.equal(r.creditedSecs, 0);
  assert.deepEqual(grown(r), []);
  assert.equal(r.updates[0].newDueAtMs, null);
});
