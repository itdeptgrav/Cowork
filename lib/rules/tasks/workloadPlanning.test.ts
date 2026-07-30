import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateDeadlineFeasibility } from "./deadlineFeasibility.ts";
import { addWorkingSecs } from "../../legacy-ui/officeDueDate.js";

/**
 * The planning questions a receiving manager actually asks.
 *
 * The engine's own tests prove the arithmetic. These prove the thing built on
 * top of it: that a manager sizing a cross-department task can see their
 * employee's real queue, move the task within it, change its budget, and have
 * every number move the way the screen claims it does.
 *
 * Same real `addWorkingSecs` as the engine tests — a planner shown dates
 * computed a different way from production is a planner shown fiction.
 */

/* The shape `_dayCfg` actually reads: FULL day names, `isOff`, `inTime`,
   `outTime`. The earlier fixture used `mon`/`open`/`close`/`isOpen`, none of
   which it looks at — so it silently fell back to the built-in default and
   these tests were not exercising the schedule they declared. It matched by
   coincidence (09:30–18:30) and nothing here crossed a Saturday, which the
   default leaves OPEN. */
const SCHEDULE = {
  monday: { isOff: false, inTime: "09:00", outTime: "18:00" },
  tuesday: { isOff: false, inTime: "09:00", outTime: "18:00" },
  wednesday: { isOff: false, inTime: "09:00", outTime: "18:00" },
  thursday: { isOff: false, inTime: "09:00", outTime: "18:00" },
  friday: { isOff: false, inTime: "09:00", outTime: "18:00" },
  saturday: { isOff: true, inTime: "09:00", outTime: "18:00" },
  sunday: { isOff: true, inTime: "09:00", outTime: "18:00" },
};
const work = (anchorMs: number, secs: number) =>
  addWorkingSecs(anchorMs, secs, SCHEDULE, new Set<string>(), []);

const MONDAY_9AM = Date.parse("2026-08-03T03:30:00.000Z");
const H = 3600;

function task(over: Record<string, unknown>) {
  return { status: "in_progress", assigneeIds: ["PRAMOD"], ...over } as never;
}

const base = {
  employeeId: "PRAMOD",
  nowMs: MONDAY_9AM,
  addWorkingSecs: work,
  committedDeadline: null,
};

/* Pramod's real desk: one production task already running. */
const EXISTING = task({
  taskId: "PROD-1",
  title: "Existing production task",
  senderTimerWindowSecs: 8 * H,
  priority: 1,
});

/* ── 1 · The new task lands inside the existing queue ─────────────────────── */

test("a cross-department task joins the employee's existing queue", () => {
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 2,
    estimatedWorkSeconds: 4 * H,
    tasks: [EXISTING],
  });

  assert.equal(r.simulatedPosition, 2);
  /* The point of the panel: not one task in isolation. */
  assert.equal(r.simulatedQueue.length, 2);
  assert.equal(r.simulatedQueue[0].taskId, "PROD-1");
  assert.equal(r.simulatedQueue[1].title, "This task");
});

/* ── 2 · Every row carries the two facts the table promises ───────────────── */

test("each queue row has a budget and a date, not just a name", () => {
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 2,
    estimatedWorkSeconds: 4 * H,
    tasks: [EXISTING],
  });

  for (const row of r.simulatedQueue) {
    assert.ok(row.estimatedDuration > 0, `${row.taskId} has no budget`);
    assert.ok(row.completionTime, `${row.taskId} has no expected due date`);
    assert.ok(
      !Number.isNaN(Date.parse(row.completionTime!)),
      `${row.taskId} due date is unparseable`,
    );
  }
  /* Ordered in time as well as by position — a queue whose second row lands
     before its first would be a table nobody can plan from. */
  const first = Date.parse(r.simulatedQueue[0].completionTime!);
  const second = Date.parse(r.simulatedQueue[1].completionTime!);
  assert.ok(second > first);
});

/* ── 3 · Swapping the two positions moves both dates ──────────────────────── */

test("swapping priority changes both tasks' completion times", () => {
  const atP2 = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 2,
    estimatedWorkSeconds: 4 * H,
    tasks: [EXISTING],
  });
  const atP1 = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 4 * H,
    tasks: [EXISTING],
  });

  /* The new task, promoted, finishes sooner. */
  assert.ok(
    Date.parse(atP1.estimatedCompletionTime!) <
      Date.parse(atP2.estimatedCompletionTime!),
  );

  /* And the existing task pays for it — this is the trade the panel exists to
     make visible, rather than only reporting the new task's good news. */
  const prodAtP2 = atP2.simulatedQueue.find((e) => e.taskId === "PROD-1")!;
  const prodAtP1 = atP1.simulatedQueue.find((e) => e.taskId === "PROD-1")!;
  assert.ok(
    Date.parse(prodAtP1.completionTime!) > Date.parse(prodAtP2.completionTime!),
  );
  assert.equal(prodAtP2.movedLaterSeconds, 0);
  assert.ok(prodAtP1.movedLaterSeconds > 0);
});

/* ── 4 · A bigger budget pushes what sits behind it ───────────────────────── */

test("increasing the budget delays downstream tasks by the difference", () => {
  const behind = task({
    taskId: "PROD-2",
    title: "Later task",
    senderTimerWindowSecs: 4 * H,
    priority: 2,
  });

  const small = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 2,
    estimatedWorkSeconds: 2 * H,
    tasks: [EXISTING, behind],
  });
  const large = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 2,
    estimatedWorkSeconds: 8 * H,
    tasks: [EXISTING, behind],
  });

  const smallHit = small.simulatedQueue.find((e) => e.taskId === "PROD-2")!;
  const largeHit = large.simulatedQueue.find((e) => e.taskId === "PROD-2")!;

  assert.ok(largeHit.movedLaterSeconds > smallHit.movedLaterSeconds);
  assert.equal(large.affectedTasks.length, 1);

  /* The delay is WALL-CLOCK, not working hours, and the two are not the same
     number. Six extra hours of budget delays this task by twenty-one, because
     the extra work pushes it past 18:00 and it resumes the next morning.
     Twenty-one is the true answer — the task really does land a day later —
     and the panel says "delayed" rather than showing a bare duration that
     would read as effort. */
  assert.equal(largeHit.movedLaterSeconds, 23 * H);
  assert.equal(smallHit.movedLaterSeconds, 2 * H);

  /* Whatever it is, it must equal the shift in that task's own date — the
     figure beside it on screen. A delta that disagreed with the two dates
     either side of it would be worse than no delta at all. */
  assert.equal(
    (Date.parse(largeHit.completionTime!) - Date.parse(smallHit.completionTime!)) / 1000,
    largeHit.movedLaterSeconds - smallHit.movedLaterSeconds,
  );
});

/* ── 5 · Promotion is what rescues a deadline ─────────────────────────────── */

test("moving the task higher turns an infeasible deadline feasible", () => {
  /* Two full days already committed ahead of it. */
  const heavy = [
    task({ taskId: "A", title: "A", senderTimerWindowSecs: 9 * H, priority: 1 }),
    task({ taskId: "B", title: "B", senderTimerWindowSecs: 9 * H, priority: 2 }),
  ];
  /* Monday 18:00 IST — reachable only from the front of the queue. */
  const deadline = "2026-08-03T12:30:00.000Z";

  const last = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 3,
    estimatedWorkSeconds: 4 * H,
    committedDeadline: deadline,
    tasks: heavy,
  });
  const first = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 4 * H,
    committedDeadline: deadline,
    tasks: heavy,
  });

  assert.equal(last.feasible, false);
  assert.equal(first.feasible, true);
  assert.ok(last.bufferSeconds! < 0 && first.bufferSeconds! > 0);
  /* Promotion is never free, and the panel must be able to say so. */
  assert.equal(first.affectedTasks.length, 2);
});

/* ── 6 · The assignor's deadline is a yardstick, not an input ─────────────── */

test("changing the requested deadline alone does not move any workload figure", () => {
  const shape = {
    ...base,
    proposedPriority: 2,
    estimatedWorkSeconds: 4 * H,
    tasks: [EXISTING],
  };
  const soon = calculateDeadlineFeasibility({
    ...shape,
    committedDeadline: "2026-08-03T12:30:00.000Z", // Mon 18:00 IST
  });
  const later = calculateDeadlineFeasibility({
    ...shape,
    committedDeadline: "2026-08-07T12:30:00.000Z", // Fri 18:00 IST
  });

  /* Identical work, identical queue: every workload number must match. The
     verdict may differ — that is the deadline's ONLY job. */
  assert.equal(later.estimatedStartTime, soon.estimatedStartTime);
  assert.equal(later.estimatedCompletionTime, soon.estimatedCompletionTime);
  assert.deepEqual(
    later.simulatedQueue.map((e) => [e.taskId, e.completionTime, e.movedLaterSeconds]),
    soon.simulatedQueue.map((e) => [e.taskId, e.completionTime, e.movedLaterSeconds]),
  );
  assert.notEqual(later.bufferSeconds, soon.bufferSeconds);
  assert.equal(soon.feasible, false);
  assert.equal(later.feasible, true);
});

/* ── 7 · Several cross-department tasks share one queue ───────────────────── */

test("cross-department tasks queue alongside the employee's own work", () => {
  /* Work reaching Pramod from elsewhere — different creators, different
     departments. What matters is that it is HIS, which `assigneeIds` decides. */
  const fromDesign = task({
    taskId: "XD-1",
    title: "From Design",
    senderTimerWindowSecs: 6 * H,
    priority: 2,
    createdBy: "DESIGN_TL",
  });
  const fromSales = task({
    taskId: "XD-2",
    title: "From Sales",
    senderTimerWindowSecs: 3 * H,
    priority: 3,
    createdBy: "SALES_TL",
  });

  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 4,
    estimatedWorkSeconds: 2 * H,
    tasks: [EXISTING, fromDesign, fromSales],
  });

  assert.deepEqual(
    r.simulatedQueue.map((e) => e.taskId),
    ["PROD-1", "XD-1", "XD-2", "__proposed__"],
  );
  assert.deepEqual(
    r.simulatedQueue.map((e) => e.position),
    [1, 2, 3, 4],
  );
  /* Everything ahead of it blocks it, whichever department sent it. */
  assert.equal(r.blockingTasks.length, 3);
  assert.equal(
    r.blockingTasks.reduce((n, b) => n + b.estimatedDuration, 0),
    17 * H,
  );
  /* Arriving at the back disturbs nobody. */
  assert.equal(r.affectedTasks.length, 0);
});

/* ── Dragging ─────────────────────────────────────────────────────────────── */

/* A three-task desk: 8h, the new task, then 2h behind it. */
const BEHIND = task({
  taskId: "PROD-2",
  title: "Inventory update",
  senderTimerWindowSecs: 2 * H,
  priority: 2,
});

const drag = (over: Record<string, unknown>) =>
  calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 2,
    estimatedWorkSeconds: 4 * H,
    tasks: [EXISTING, BEHIND],
    ...over,
  });

test("dragging the new task from P2 to P1 pulls its date in and pushes the rest out", () => {
  const before = drag({});
  const after = drag({ orderOverride: ["__proposed__", "PROD-1", "PROD-2"] });

  assert.equal(after.simulatedPosition, 1);
  assert.deepEqual(
    after.simulatedQueue.map((e) => e.taskId),
    ["__proposed__", "PROD-1", "PROD-2"],
  );
  /* The task itself gains. */
  assert.ok(
    Date.parse(after.estimatedCompletionTime!) <
      Date.parse(before.estimatedCompletionTime!),
  );
  /* The task it JUMPED pays for it. */
  const p1Before = before.simulatedQueue.find((e) => e.taskId === "PROD-1")!;
  const p1After = after.simulatedQueue.find((e) => e.taskId === "PROD-1")!;
  assert.equal(p1Before.movedLaterSeconds, 0);
  assert.ok(p1After.movedLaterSeconds > 0);
  assert.ok(
    Date.parse(p1After.completionTime!) > Date.parse(p1Before.completionTime!),
  );

  /* The task BEHIND both of them does not, and this is the case a planner gets
     wrong by eye: PROD-2 still has the same twelve hours in front of it either
     way, so reordering those twelve changes nothing for it. Only crossing a
     task moves that task — swapping two tasks above a third leaves the third
     exactly where it was. */
  const p2Before = before.simulatedQueue.find((e) => e.taskId === "PROD-2")!;
  const p2After = after.simulatedQueue.find((e) => e.taskId === "PROD-2")!;
  assert.equal(p2After.completionTime, p2Before.completionTime);
  assert.equal(p2After.movedLaterSeconds, p2Before.movedLaterSeconds);

  /* Both rows still read as affected — PROD-2 by the insertion itself, which
     is real and was already true before the drag. */
  assert.equal(before.affectedTasks.length, 1);
  assert.equal(after.affectedTasks.length, 2);
});

test("dragging an existing task down reports IT as delayed", () => {
  /* The baseline is the employee's real queue today, never the preview's own
     order. Measured against the preview, a task dragged down would compare
     against itself and report "no change" — the one row the reader most needs
     a warning on. */
  const r = drag({ orderOverride: ["PROD-2", "__proposed__", "PROD-1"] });
  const demoted = r.simulatedQueue.find((e) => e.taskId === "PROD-1")!;
  const promoted = r.simulatedQueue.find((e) => e.taskId === "PROD-2")!;
  assert.equal(demoted.position, 3);
  assert.ok(demoted.movedLaterSeconds > 0);
  assert.equal(promoted.position, 1);
  assert.equal(promoted.movedLaterSeconds, 0);
});

test("dragging to the last position starts the task behind everything", () => {
  const r = drag({ orderOverride: ["PROD-1", "PROD-2", "__proposed__"] });
  assert.equal(r.simulatedPosition, 3);
  assert.equal(r.blockingTasks.length, 2);
  assert.equal(
    r.blockingTasks.reduce((n, b) => n + b.estimatedDuration, 0),
    10 * H,
  );
  /* Arriving at the back disturbs nobody, whichever way the reader got there. */
  assert.equal(r.affectedTasks.length, 0);
});

test("an order that omits tasks keeps them, it does not drop them", () => {
  /* A short list must never silently shorten the queue — every omitted task
     would vanish from the chain and flatter every date on screen. */
  const r = drag({ orderOverride: ["__proposed__"] });
  assert.deepEqual(
    r.simulatedQueue.map((e) => e.taskId),
    ["__proposed__", "PROD-1", "PROD-2"],
  );
});

test("unknown and repeated ids in an order are ignored, not obeyed", () => {
  const r = drag({
    orderOverride: ["GHOST", "__proposed__", "PROD-1", "__proposed__", "PROD-2"],
  });
  assert.deepEqual(
    r.simulatedQueue.map((e) => e.taskId),
    ["__proposed__", "PROD-1", "PROD-2"],
  );
});

test("an empty queue is draggable-safe: the task is simply first", () => {
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 4 * H,
    tasks: [],
    orderOverride: ["__proposed__"],
  });
  assert.equal(r.simulatedPosition, 1);
  assert.equal(r.simulatedQueue.length, 1);
  assert.equal(r.blockingTasks.length, 0);
  assert.equal(r.affectedTasks.length, 0);
});

test("tasks sharing a priority number still have one settled order", () => {
  /* Two P1s are legal in the data and the queue must not preview two ways —
     otherwise a drag lands somewhere different each time it is read. */
  const tied = [
    task({ taskId: "B", title: "B", senderTimerWindowSecs: 2 * H, priority: 1 }),
    task({ taskId: "A", title: "A", senderTimerWindowSecs: 2 * H, priority: 1 }),
  ];
  const once = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 3,
    estimatedWorkSeconds: H,
    tasks: tied,
  });
  const twice = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 3,
    estimatedWorkSeconds: H,
    tasks: [...tied].reverse(),
  });
  assert.deepEqual(
    once.simulatedQueue.map((e) => e.taskId),
    twice.simulatedQueue.map((e) => e.taskId),
  );
  /* And a drag over that tie is honoured exactly. */
  const dragged = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 3,
    estimatedWorkSeconds: H,
    tasks: tied,
    orderOverride: ["B", "__proposed__", "A"],
  });
  assert.deepEqual(
    dragged.simulatedQueue.map((e) => e.taskId),
    ["B", "__proposed__", "A"],
  );
});

test("a task whose budget is unsettled is not in the queue and cannot be dragged", () => {
  /* Only settled work holds a place. An override naming an unsettled task must
     not smuggle it into the chain, or the panel would promise dates built on
     hours nobody has agreed to. */
  const unsettled = task({
    taskId: "ARGUING",
    title: "Budget under negotiation",
    senderTimerWindowSecs: 40 * H,
    priority: 1,
    status: "pending_tl_hours",
  });
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 4 * H,
    tasks: [EXISTING, unsettled],
    orderOverride: ["ARGUING", "__proposed__", "PROD-1"],
  });
  assert.equal(
    r.simulatedQueue.some((e) => e.taskId === "ARGUING"),
    false,
  );
  assert.deepEqual(
    r.simulatedQueue.map((e) => e.taskId),
    ["__proposed__", "PROD-1"],
  );
});

test("dragging changes the verdict, and the requested deadline still does not", () => {
  /* Monday 18:00 IST — reachable from the front, not from behind eight hours. */
  const deadline = "2026-08-03T12:30:00.000Z";
  const behind = drag({ committedDeadline: deadline });
  const front = drag({
    committedDeadline: deadline,
    orderOverride: ["__proposed__", "PROD-1", "PROD-2"],
  });

  assert.equal(behind.feasible, false);
  assert.equal(front.feasible, true);
  assert.ok(behind.bufferSeconds! < 0 && front.bufferSeconds! > 0);

  /* Same drag, a later commitment: every workload figure identical, only the
     verdict moves. The deadline is the yardstick, never an input. */
  const laterDeadline = drag({
    committedDeadline: "2026-08-07T12:30:00.000Z",
    orderOverride: ["__proposed__", "PROD-1", "PROD-2"],
  });
  assert.equal(laterDeadline.estimatedStartTime, front.estimatedStartTime);
  assert.equal(
    laterDeadline.estimatedCompletionTime,
    front.estimatedCompletionTime,
  );
  assert.deepEqual(
    laterDeadline.simulatedQueue.map((e) => [
      e.taskId,
      e.position,
      e.completionTime,
      e.movedLaterSeconds,
    ]),
    front.simulatedQueue.map((e) => [
      e.taskId,
      e.position,
      e.completionTime,
      e.movedLaterSeconds,
    ]),
  );
  assert.notEqual(laterDeadline.bufferSeconds, front.bufferSeconds);
});
