import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorMsFor, chainDeadlines, officeOpenMsFor } from "./priorityDeadline.ts";

/**
 * The projection anchor must not depend on the instant it is asked for.
 *
 * `Expected completion` is recomputed on every read, from an anchor plus the
 * queue. If the anchor moves with the wall clock, the date moves with it — and
 * that is what "the due time goes up on its own" was: on a day the office
 * schedule had no opening for, the anchor was `nowMs`, so each recalculation
 * started later than the last and the date crept forward continuously.
 *
 * On a normal working day it was a fixed 09:30 and could not happen, which is
 * why the fault only appeared sometimes and looked like nothing in particular.
 */

/* A Wednesday, and the same Wednesday five hours later. */
const WED_09_00 = new Date("2026-08-05T09:00:00").getTime();
const WED_14_00 = new Date("2026-08-05T14:00:00").getTime();
const WED_17_30 = new Date("2026-08-05T17:30:00").getTime();

const OPEN = { wednesday: { inTime: "09:30" } };
const CLOSED = { wednesday: { isOff: true, inTime: "09:30" } };

test("a day OFF anchors at the same point all day — the creep is gone", () => {
  /* **The bug, in one assertion.** Three readings across eight hours of a
     non-working day must give one answer. Before this they gave three, each
     later than the last. */
  const a = officeOpenMsFor(CLOSED, WED_09_00);
  const b = officeOpenMsFor(CLOSED, WED_14_00);
  const c = officeOpenMsFor(CLOSED, WED_17_30);
  assert.equal(a, b);
  assert.equal(b, c);
});

test("an UNKNOWN schedule is stable too — no fallback follows the clock", () => {
  /* Reversed deliberately. The old rule returned `nowMs` here so a queue would
     not be scheduled into the past — but a due date that has passed means the
     work is LATE, which is information. An anchor that follows the clock is a
     deadline nobody can ever miss, because it retreats as they approach it. */
  const cases: (Record<string, { isOff?: boolean; inTime?: string }> | null)[] = [
    null,
    { monday: { inTime: "09:30" } },
    { wednesday: { inTime: "oops" } },
  ];
  for (const sched of cases) {
    assert.equal(
      officeOpenMsFor(sched, WED_09_00),
      officeOpenMsFor(sched, WED_17_30),
      "an unknown schedule still moved with the clock",
    );
  }
});

test("the fallback is midnight of that day, not some other day", () => {
  /* It must stay inside the day being asked about — walking to the next working
     period is `addWorkingSecs`'s job, and it needs a sane starting point. */
  const at = officeOpenMsFor(CLOSED, WED_14_00);
  const d = new Date(at);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getDate(), new Date(WED_14_00).getDate());
});

test("a working day is unchanged — still the office opening", () => {
  /* The ordinary path must not move. This is what dates people are scored
     against are built on. */
  const at = officeOpenMsFor(OPEN, WED_14_00);
  const d = new Date(at);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 30);
});

test("a working day is stable across the day as it always was", () => {
  assert.equal(officeOpenMsFor(OPEN, WED_09_00), officeOpenMsFor(OPEN, WED_17_30));
});

test("starting work does NOT move the anchor", () => {
  /* The reported jump: a task with no start anchored one way, and pressing play
     switched the anchor to `startedAt`, so the due date moved the moment work
     began — 17:22 became 17:20. A commitment is decided once; starting a timer
     is not one of the four things allowed to move it. */
  const openMs = officeOpenMsFor(OPEN, WED_14_00);
  const before = anchorMsFor({ leader: undefined, officeOpenMs: openMs, nowMs: WED_14_00 });
  const after = anchorMsFor({
    leader: { startedAt: new Date("2026-08-05T10:15:00").toISOString() } as never,
    officeOpenMs: openMs,
    nowMs: WED_14_00,
  });
  assert.equal(before, after);
});

test("the anchor is always the day's opening, whatever the leader did", () => {
  const openMs = officeOpenMsFor(OPEN, WED_14_00);
  for (const started of ["2026-08-01T10:15:00", "2026-08-05T10:15:00", undefined]) {
    assert.equal(
      anchorMsFor({
        leader: (started ? { startedAt: started } : undefined) as never,
        officeOpenMs: openMs,
        nowMs: WED_14_00,
      }),
      openMs,
    );
  }
});

/* ── A task is never due before its own clock starts ──────────────────────── */

/**
 * REPORTED: after swapping two tasks' priorities, one read
 * "Deadline 21 Aug · 11:30 IST" beside "Counted from 21 Aug · 13:17 IST" —
 * an hour's work due nearly two hours before the hour could begin.
 *
 * The swap did not cause it; it revealed it. The chain clamped its anchor to
 * `createdAtMs` ("a task cannot be due before it existed") and stopped there,
 * while the BUDGET is counted from `clockStartsAt` — the moment the person
 * could first have started. Where somebody comes online hours after the work
 * arrives, those are different instants, and the queue was scheduling against
 * the earlier one.
 */

const HOUR = 3600;
const at = (iso: string) => Date.parse(iso);

test("the chain never schedules a task before its clock starts", () => {
  const officeOpen = at("2026-08-21T05:00:00.000Z"); // 10:30 IST
  const chained = chainDeadlines({
    queue: [
      {
        taskId: "T107",
        assigneeIds: ["E1"],
        assigneePriorities: { E1: 1 },
        agreedWindowSecs: HOUR,
        createdAtMs: at("2026-08-21T03:30:00.000Z"), // 09:00 IST — before opening
        clockStartsAtMs: at("2026-08-21T07:47:00.000Z"), // 13:17 IST
      },
    ],
    anchorMs: officeOpen,
    budget: "full",
    /* Plain seconds, so the arithmetic under test is the ANCHOR rather than the
       working-hours walk. */
    addWorkingSecs: (fromMs, secs) => new Date(fromMs + secs * 1000).toISOString(),
  });

  const due = Date.parse(chained[0].dueDate);
  assert.ok(
    due >= at("2026-08-21T07:47:00.000Z"),
    `due ${chained[0].dueDate} is before the clock starts — the reported fault`,
  );
  assert.equal(chained[0].dueDate, "2026-08-21T08:47:00.000Z"); // 14:17 IST
});

test("a clock stamp EARLIER than the queue is free changes nothing", () => {
  /* Clamping may only ever move the anchor later. Somebody who was already
     online when the work arrived must not have their place in the queue
     rewritten. */
  const officeOpen = at("2026-08-21T05:00:00.000Z");
  const chained = chainDeadlines({
    queue: [
      {
        taskId: "A",
        assigneeIds: ["E1"],
        assigneePriorities: { E1: 1 },
        agreedWindowSecs: HOUR,
        createdAtMs: officeOpen,
        clockStartsAtMs: at("2026-08-21T04:00:00.000Z"), // before opening
      },
    ],
    anchorMs: officeOpen,
    budget: "full",
    addWorkingSecs: (fromMs, secs) => new Date(fromMs + secs * 1000).toISOString(),
  });
  assert.equal(chained[0].dueDate, "2026-08-21T06:00:00.000Z");
});

test("a task with no clock stamp is unaffected", () => {
  /* Every task created before the stamp existed, and anything not yet accepted. */
  const officeOpen = at("2026-08-21T05:00:00.000Z");
  const chained = chainDeadlines({
    queue: [
      {
        taskId: "A",
        assigneeIds: ["E1"],
        assigneePriorities: { E1: 1 },
        agreedWindowSecs: HOUR,
        createdAtMs: officeOpen,
      },
    ],
    anchorMs: officeOpen,
    budget: "full",
    addWorkingSecs: (fromMs, secs) => new Date(fromMs + secs * 1000).toISOString(),
  });
  assert.equal(chained[0].dueDate, "2026-08-21T06:00:00.000Z");
});

test("the swap case: the task behind still starts when the one ahead finishes", () => {
  /* Both tasks late-started. The leader is pushed to its clock, and the second
     chains off the leader's new finish rather than off its own stamp. */
  const officeOpen = at("2026-08-21T05:00:00.000Z");
  const clock = at("2026-08-21T07:47:00.000Z"); // 13:17 IST
  const chained = chainDeadlines({
    queue: [
      {
        taskId: "T106",
        assigneeIds: ["E1"],
        assigneePriorities: { E1: 1 },
        agreedWindowSecs: HOUR,
        createdAtMs: officeOpen,
        clockStartsAtMs: clock,
      },
      {
        taskId: "T107",
        assigneeIds: ["E1"],
        assigneePriorities: { E1: 2 },
        agreedWindowSecs: HOUR,
        createdAtMs: officeOpen,
        clockStartsAtMs: clock,
      },
    ],
    anchorMs: officeOpen,
    budget: "full",
    addWorkingSecs: (fromMs, secs) => new Date(fromMs + secs * 1000).toISOString(),
  });
  assert.equal(chained[0].dueDate, "2026-08-21T08:47:00.000Z"); // 14:17 IST
  assert.equal(chained[1].dueDate, "2026-08-21T09:47:00.000Z"); // 15:17 IST
});

/* ── Swapping two ranks exchanges their dates ─────────────────────────────── */

/**
 * OWNER'S CASE, in their numbers. Two 1-hour tasks, both given 13:32:
 *
 *   before   T1 P1 -> 14:32     T2 P2 -> 15:32
 *   after    T1 P2 -> 15:32     T2 P1 -> 14:32
 *
 * The dates belong to the QUEUE POSITIONS. Swapping the ranks exchanges them,
 * and nothing else moves.
 *
 * What it looked like instead was both dates an hour late — 15:32 and 16:32 —
 * because the clock floor was applied to every task rather than once to the
 * queue, so the wait the chain had already counted was counted a second time.
 */
const GIVEN = at("2026-08-21T08:02:00.000Z"); // 13:32 IST
const QUEUE_ANCHOR = at("2026-08-21T05:00:00.000Z"); // 10:30 IST

function twoTaskQueue(order: readonly string[]) {
  return chainDeadlines({
    queue: order.map((id, i) => ({
      taskId: id,
      assigneeIds: ["E1"],
      assigneePriorities: { E1: i + 1 },
      agreedWindowSecs: HOUR,
      createdAtMs: GIVEN,
      clockStartsAtMs: GIVEN,
    })),
    anchorMs: QUEUE_ANCHOR,
    budget: "full",
    addWorkingSecs: (fromMs, secs) => new Date(fromMs + secs * 1000).toISOString(),
  });
}

test("before the swap: P1 lands an hour on, P2 an hour after that", () => {
  const chained = twoTaskQueue(["T1", "T2"]);
  assert.equal(chained[0].dueDate, "2026-08-21T09:02:00.000Z"); // 14:32 IST
  assert.equal(chained[1].dueDate, "2026-08-21T10:02:00.000Z"); // 15:32 IST
});

test("after the swap: the SAME two dates, exchanged", () => {
  /* The dates belong to the positions. Nothing new appears and nothing moves
     later — T2 takes 14:32 and T1 takes 15:32. */
  const chained = twoTaskQueue(["T2", "T1"]);
  assert.equal(chained[0].taskId, "T2");
  assert.equal(chained[0].dueDate, "2026-08-21T09:02:00.000Z"); // 14:32 IST
  assert.equal(chained[1].taskId, "T1");
  assert.equal(chained[1].dueDate, "2026-08-21T10:02:00.000Z"); // 15:32 IST
});

test("the set of dates is identical either way round", () => {
  /* The strongest form of it: a reorder redistributes the slots, it does not
     create later ones. Both dates an hour on was the reported fault. */
  const before = twoTaskQueue(["T1", "T2"]).map((c) => c.dueDate).sort();
  const after = twoTaskQueue(["T2", "T1"]).map((c) => c.dueDate).sort();
  assert.deepEqual(after, before);
});

test("a late stamp on the SECOND task does not drag the chain", () => {
  /* This is the double-count. P2's own clock is later precisely because it sits
     behind P1 — the chain has already counted that hour. */
  const chained = chainDeadlines({
    queue: [
      {
        taskId: "T2",
        assigneeIds: ["E1"],
        assigneePriorities: { E1: 1 },
        agreedWindowSecs: HOUR,
        createdAtMs: GIVEN,
        clockStartsAtMs: GIVEN,
      },
      {
        taskId: "T1",
        assigneeIds: ["E1"],
        assigneePriorities: { E1: 2 },
        agreedWindowSecs: HOUR,
        createdAtMs: GIVEN,
        /* Stamped LATER THAN THE SLOT the chain gives it — 15:32 against a
           14:32 start. Chosen so the two designs disagree: applied per task
           this pushes the anchor to 15:32 and the date to 16:32, which is the
           reported fault. Applied once to the queue it is ignored, and the
           chain keeps its own 15:32. */
        clockStartsAtMs: at("2026-08-21T10:02:00.000Z"),
      },
    ],
    anchorMs: QUEUE_ANCHOR,
    budget: "full",
    addWorkingSecs: (fromMs, secs) => new Date(fromMs + secs * 1000).toISOString(),
  });
  assert.equal(chained[0].dueDate, "2026-08-21T09:02:00.000Z"); // 14:32 IST
  assert.equal(chained[1].dueDate, "2026-08-21T10:02:00.000Z"); // 15:32, not 16:32
});

test("the leader's clock still floors the queue", () => {
  /* The first fault must stay fixed: a leader whose clock starts at 13:17 is
     not due at 11:30. */
  const chained = chainDeadlines({
    queue: [
      {
        taskId: "A",
        assigneeIds: ["E1"],
        assigneePriorities: { E1: 1 },
        agreedWindowSecs: HOUR,
        createdAtMs: at("2026-08-21T03:30:00.000Z"),
        clockStartsAtMs: at("2026-08-21T07:47:00.000Z"), // 13:17 IST
      },
    ],
    anchorMs: QUEUE_ANCHOR,
    budget: "full",
    addWorkingSecs: (fromMs, secs) => new Date(fromMs + secs * 1000).toISOString(),
  });
  assert.equal(chained[0].dueDate, "2026-08-21T08:47:00.000Z"); // 14:17 IST
});
