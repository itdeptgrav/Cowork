import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NO_MEETINGS,
  type SettlementTask,
  settleSession,
} from "./meetingCredit.ts";

/**
 * Everybody in the room earns — on an ORDINARY task, not only a
 * cross-department one — OWNER DECISION.
 *
 * ## What was reported
 *
 * The person who assigns a task sits through the whole meeting about it. They
 * lose the same half hour from their own day as the person doing the work. The
 * receiver's deadlines moved; the sender's did not, and neither did those of a
 * manager who joined. Only cross-department work credited everyone, and the
 * wall clock a meeting costs does not depend on which department the task came
 * from.
 *
 * ## The rule, in one sentence
 *
 * **Each person earns their own time inside the counting window, against their
 * own live tasks.** The window is the only thing the two rules still disagree
 * about: an ordinary meeting counts while the person who ASSIGNED the work is
 * in the room, a cross-department one only while both sides are.
 *
 * That window is the anti-cheat and it is untouched — a room the assignee sits
 * in alone is worth nothing to anybody, however many people are in it, which
 * the last case here holds.
 */

const SENDER = "rakesh";
const RECEIVER = "soumya";
const MANAGER = "priya";

const T0 = Date.parse("2026-08-13T04:30:00.000Z");
const min = (n: number) => n * 60_000;

const span = (employeeId: string, fromMin: number, toMin: number) => ({
  employeeId,
  joinedAtMs: T0 + min(fromMin),
  leftAtMs: T0 + min(toMin),
});

const task = (
  taskId: string,
  who: string,
  over: Partial<SettlementTask> = {},
): SettlementTask => ({
  taskId,
  status: "in_progress",
  assigneeIds: [who],
  totals: NO_MEETINGS,
  dueAtMs: T0 + min(600),
  windowSecs: 3600,
  rank: 1,
  ...over,
});

/** A thirty-minute meeting on an ordinary task, and who was in it. */
const meet = (
  attendance: ReturnType<typeof span>[],
  queues: Record<string, SettlementTask[]>,
) =>
  settleSession({
    session: {
      counterpartyId: SENDER,
      startedAtMs: T0,
      endedAtMs: T0 + min(30),
      attendance,
    },
    onTaskId: "HOST",
    receiverId: RECEIVER,
    tasksByEmployee: new Map(Object.entries(queues)),
  });

const secsFor = (r: ReturnType<typeof meet>, who: string) =>
  r.updates
    .filter((u) => u.forEmployeeId === who)
    .map((u) => u.totals.totalSecs);

/* ── The reported case ────────────────────────────────────────────────────── */

test("the SENDER's own tasks are credited, not only the receiver's", () => {
  const r = meet(
    [span(SENDER, 0, 30), span(RECEIVER, 0, 30)],
    { [SENDER]: [task("S-1", SENDER)], [RECEIVER]: [task("R-1", RECEIVER)] },
  );

  const byTask = new Map(r.updates.map((u) => [u.taskId, u]));
  assert.equal(byTask.get("S-1")?.newWindowSecs, 3600 + 30 * 60);
  assert.equal(byTask.get("R-1")?.newWindowSecs, 3600 + 30 * 60);
  assert.equal(
    r.creditedSecs,
    30 * 60,
    "the session is worth the meeting, not the sum of what everybody earned",
  );
});

test("a manager who looks in earns their own minutes, and no more", () => {
  const r = meet(
    [span(SENDER, 0, 30), span(RECEIVER, 0, 30), span(MANAGER, 20, 30)],
    {
      [SENDER]: [task("S-1", SENDER)],
      [RECEIVER]: [task("R-1", RECEIVER)],
      [MANAGER]: [task("M-1", MANAGER)],
    },
  );

  const byTask = new Map(r.updates.map((u) => [u.taskId, u]));
  assert.equal(byTask.get("M-1")?.newWindowSecs, 3600 + 10 * 60, "ten, not thirty");
  assert.equal(byTask.get("S-1")?.newWindowSecs, 3600 + 30 * 60);
});

test("each person is credited only against their OWN work", () => {
  /* Crediting everybody must not mean crediting everybody's tasks to everybody.
     A queue read may hand back more than its owner's work — the mock's returns
     every live task — so this holds the narrowing that keeps them apart. */
  const everyTask = [task("S-1", SENDER), task("R-1", RECEIVER)];
  const r = meet([span(SENDER, 0, 30), span(RECEIVER, 0, 30)], {
    [SENDER]: everyTask,
    [RECEIVER]: everyTask,
  });

  const owner = new Map(r.updates.map((u) => [u.taskId, u.forEmployeeId]));
  assert.equal(owner.get("S-1"), SENDER);
  assert.equal(owner.get("R-1"), RECEIVER);
  assert.equal(r.updates.length, 2, "one update per task, not one per person");
});

test("a task two attendees share moves ONCE, by the larger loss", () => {
  /* Both of them hold it, both were in the room, and a deadline can only move
     once for one meeting. The larger figure is the honest one: that is what
     somebody carrying the task actually lost. */
  const shared = {
    ...task("SHARED", SENDER),
    assigneeIds: [SENDER, MANAGER],
  };
  /* The RECEIVER is in the room because since 15 Aug an ordinary meeting needs
     both sides present for the clock to run at all — without them the window
     is empty and there is no credit to de-duplicate. The subject of this test
     is the sharing, not the window. */
  const r = meet(
    [span(SENDER, 0, 30), span(RECEIVER, 0, 30), span(MANAGER, 20, 30)],
    {
      [SENDER]: [shared],
      [MANAGER]: [shared],
      [RECEIVER]: [task("R-1", RECEIVER)],
    },
  );

  const forShared = r.updates.filter((u) => u.taskId === "SHARED");
  assert.equal(forShared.length, 1, "one deadline moved twice for one meeting");
  assert.equal(forShared[0].forEmployeeId, SENDER);
  assert.equal(forShared[0].newWindowSecs, 3600 + 30 * 60);
});

/* ── What did not change ──────────────────────────────────────────────────── */

test("somebody who arrives after the sender has left earns nothing", () => {
  const r = meet([span(SENDER, 0, 10), span(MANAGER, 20, 30)], {
    [SENDER]: [task("S-1", SENDER)],
    [MANAGER]: [task("M-1", MANAGER)],
  });
  assert.deepEqual(secsFor(r, MANAGER), [], "a room is not a meeting");
});

test("the anti-cheat holds: the assignee alone in the room earns nothing", () => {
  /* The whole reason attendance is tracked. Without it somebody could open a
     room, leave it running, and mint an unlimited deadline for an empty call. */
  const r = meet([span(RECEIVER, 0, 30)], {
    [RECEIVER]: [task("R-1", RECEIVER)],
  });

  assert.equal(r.creditedSecs, 0);
  const [u] = r.updates;
  assert.equal(u.newWindowSecs, null, "no window grew");
  assert.equal(u.newDueAtMs, null, "no date moved");
  assert.notEqual(
    u.totals.firstStartedAtMs,
    null,
    "the meeting is still on the record — refusing the credit is not refusing " +
      "the history",
  );
});

test("submitted work receives nothing, and neither does finished work", () => {
  /* `in_review` is done and sitting with a reviewer: a conversation about it is
     not time the assignee still owes. Completed and cancelled are frozen. */
  const r = meet([span(SENDER, 0, 30), span(RECEIVER, 0, 30)], {
    [SENDER]: [task("S-1", SENDER, { status: "in_review" })],
    [RECEIVER]: [
      task("R-live", RECEIVER),
      task("R-submitted", RECEIVER, { status: "in_review" }),
      task("R-done", RECEIVER, { status: "completed" }),
      task("R-cancelled", RECEIVER, { status: "cancelled" }),
    ],
  });

  assert.deepEqual(
    r.updates.map((u) => u.taskId),
    ["R-live"],
    "only live work moves",
  );
});

test("a handed-over task that nobody has started still counts", () => {
  /* The kickoff. A meeting exists to explain the work BEFORE it starts, and the
     engine reports a live, unstarted, handed-over task as `assigned`. */
  const r = meet([span(SENDER, 0, 30), span(RECEIVER, 0, 30)], {
    [SENDER]: [task("S-1", SENDER, { status: "assigned" })],
    [RECEIVER]: [task("R-1", RECEIVER, { status: "assigned" })],
  });

  assert.deepEqual(
    r.updates.map((u) => u.taskId).sort(),
    ["R-1", "S-1"],
    "a kickoff moved nobody's deadline",
  );
});

test("a person in the room with no live tasks simply produces nothing", () => {
  /* They lost the time and there is nothing to move it on. Silently doing
     nothing is right; inventing a task for them would not be. */
  const r = meet([span(SENDER, 0, 30), span(RECEIVER, 0, 30)], {
    [RECEIVER]: [task("R-1", RECEIVER)],
  });

  assert.deepEqual(
    r.updates.map((u) => u.taskId),
    ["R-1"],
  );
});
