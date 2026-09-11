import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
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

/* ── The head is a task too: nothing is due before it existed ──────────────── */

test("promoting a task raised this afternoon does not date it this morning", () => {
  /**
   * **T254, reported.** Raised 15:48 with a three-hour budget, swapped to P1,
   * and the chain wrote 12:30 — three hours BEFORE the task existed. It arrived
   * overdue and its timer blocked on the spot.
   *
   * The clamp lived in an `else`, so it applied to every task except the head —
   * and the head is the only position where `queueStartMs` can precede the task,
   * because that number is a set of MINIMA across the queue. Promote a
   * late-raised task and it inherited the queue's morning start.
   */
  const morning = T0; // 09:30
  const afternoon = T0 + 6 * HOUR * 1000; // 15:30
  const moved = chainDeadlines({
    queue: [
      task({ taskId: "late", createdAtMs: afternoon, deadlineWindowSecs: 3 * HOUR }),
      task({ taskId: "old", createdAtMs: morning }),
    ],
    anchorMs: morning,
    addWorkingSecs: plainAdd,
  });

  assert.equal(
    moved[0].startsAt,
    new Date(afternoon).toISOString(),
    "the head was scheduled before it existed",
  );
  assert.equal(moved[0].dueDate, new Date(afternoon + 3 * HOUR * 1000).toISOString());
  /* And the one behind it still chains off that finish. */
  assert.equal(moved[1].startsAt, moved[0].dueDate);
});

test("a head raised BEFORE the queue start still anchors at the queue start", () => {
  /* The clamp only ever moves an anchor later. A task that existed before the
     office opened must not drag the queue back to its own creation. */
  const moved = chainDeadlines({
    queue: [task({ taskId: "old", createdAtMs: T0 - 5 * HOUR * 1000 })],
    anchorMs: T0,
    addWorkingSecs: plainAdd,
  });
  assert.equal(moved[0].startsAt, new Date(T0).toISOString());
});

/* ── The field the documents actually carry ────────────────────────────────── */

test("createdAtISO and createdAt are read, not just createdAtMs", () => {
  /**
   * No task document has a `createdAtMs` — all 63 live tasks carry `createdAt`
   * and `createdAtISO`, and every caller spreads the raw document. Reading one
   * undeclared name meant this clamp answered null everywhere and silently did
   * nothing, for every task, for as long as it has existed. The engine reads
   * `createdAtISO ?? createdAt`; so does this now.
   */
  const afternoon = T0 + 6 * HOUR * 1000;
  const iso = new Date(afternoon).toISOString();

  for (const shape of [
    { createdAtISO: iso },
    { createdAt: iso },
    { createdAt: { _seconds: Math.floor(afternoon / 1000) } },
    { createdAtMs: afternoon },
  ]) {
    const moved = chainDeadlines({
      queue: [task({ taskId: "h", ...(shape as Partial<QueueTask>) })],
      anchorMs: T0,
      addWorkingSecs: plainAdd,
    });
    assert.equal(
      moved[0].startsAt,
      iso,
      `not clamped from ${Object.keys(shape)[0]}`,
    );
  }
});

test("createdAtMs still wins where a caller supplies all of them", () => {
  /* The order is `createdAtMs ?? createdAtISO ?? createdAt`, so a caller that
     already resolved the instant is not second-guessed. */
  const a = T0 + 6 * HOUR * 1000;
  const b = T0 + 2 * HOUR * 1000;
  const moved = chainDeadlines({
    queue: [
      task({
        taskId: "h",
        createdAtMs: a,
        createdAtISO: new Date(b).toISOString(),
        createdAt: new Date(b).toISOString(),
      }),
    ],
    anchorMs: T0,
    addWorkingSecs: plainAdd,
  });
  assert.equal(moved[0].startsAt, new Date(a).toISOString());
});

/* ── The invariant the clamp must not break ────────────────────────────────── */

test("swapping two ranks swaps their dates rather than dragging the queue", () => {
  /**
   * The reason the note above `queueStartMs` refuses to read the LEADER's
   * `clockStartsAt`: that stamp encodes queue position, so feeding it back in
   * moves the whole chain on every reorder. `createdAtMs` carries no such
   * feedback — when a task was raised is fixed — so clamping on it per task,
   * head included, must leave this property intact.
   */
  const made = T0 - HOUR * 1000; // both raised before the queue starts
  const first = chainDeadlines({
    queue: [
      task({ taskId: "p1", createdAtMs: made }),
      task({ taskId: "p2", createdAtMs: made }),
    ],
    anchorMs: T0,
    addWorkingSecs: plainAdd,
  });
  const swapped = chainDeadlines({
    queue: [
      task({ taskId: "p2", createdAtMs: made }),
      task({ taskId: "p1", createdAtMs: made }),
    ],
    anchorMs: T0,
    addWorkingSecs: plainAdd,
  });

  /* The two SLOTS keep their dates; the tasks exchange them. */
  assert.equal(first[0].dueDate, swapped[0].dueDate);
  assert.equal(first[1].dueDate, swapped[1].dueDate);
  assert.equal(first[0].taskId, "p1");
  assert.equal(swapped[0].taskId, "p2");
});

test("a queue of tasks all raised late starts at the earliest of them", () => {
  /* Every task clamps individually, so a queue raised entirely this afternoon
     begins when its own head was raised — not at an opening nobody was there
     for. */
  const h = T0 + 6 * HOUR * 1000;
  const moved = chainDeadlines({
    queue: [
      task({ taskId: "a", createdAtMs: h }),
      task({ taskId: "b", createdAtMs: h + 600_000 }),
    ],
    anchorMs: T0,
    addWorkingSecs: plainAdd,
  });
  assert.equal(moved[0].startsAt, new Date(h).toISOString());
  /* b was raised while a was still running, so it waits for a rather than for
     its own creation. */
  assert.equal(moved[1].startsAt, moved[0].dueDate);
});

/* ── A reorder must not grant a budget twice ───────────────────────────────── */

const NOW = T0 + 4.5 * HOUR * 1000; // 14:00, the moment of the swap

test("a task pushed into the future is scheduled from what is LEFT", () => {
  /**
   * **The over-grant, reported.** Task 1 carries 5h and has already worked 2h.
   * A swap re-anchors it to 17:00 — past the hours it spent — and the whole 5h
   * was granted again from there: 2h already gone plus 5h more, seven hours for
   * a five-hour task. Everything queued behind inherited the same surplus.
   *
   * `start + full budget` is only right while a task runs from its OWN start,
   * because the hour that leaves the budget is the hour that moves the clock.
   * A reorder moves the start past that work and the cancellation stops holding.
   */
  const ahead = T0 + 7.5 * HOUR * 1000; // 17:00 — after NOW
  const moved = chainDeadlines({
    queue: [
      task({
        taskId: "worked",
        deadlineWindowSecs: 5 * HOUR,
        loggedSecs: 2 * HOUR,
        createdAtMs: ahead,
      }),
    ],
    anchorMs: ahead,
    addWorkingSecs: plainAdd,
    budget: "full",
    nowMs: NOW,
  });
  /* 3h remaining, not 5h. */
  assert.equal(moved[0].dueDate, new Date(ahead + 3 * HOUR * 1000).toISOString());
});

test("a task already running from a past start keeps its FULL budget", () => {
  /**
   * The other half, and the reason this is narrow. A task whose start is behind
   * `nowMs` is running from it: its spent hours already moved the clock, so the
   * full budget is the honest figure and its date must NOT move because
   * somebody logged time. Subtracting there would make a deadline tighten every
   * time its owner worked.
   */
  const moved = chainDeadlines({
    queue: [
      task({
        taskId: "running",
        deadlineWindowSecs: 5 * HOUR,
        loggedSecs: 2 * HOUR,
        createdAtMs: T0,
      }),
    ],
    anchorMs: T0, // 09:30 — before NOW
    addWorkingSecs: plainAdd,
    budget: "full",
    nowMs: NOW,
  });
  assert.equal(moved[0].dueDate, new Date(T0 + 5 * HOUR * 1000).toISOString());
});

test("the surplus is not passed down the queue", () => {
  /* Every task behind the re-anchored one starts from its corrected finish, so
     the two hours are not handed out again further down. */
  const ahead = T0 + 7.5 * HOUR * 1000;
  const moved = chainDeadlines({
    queue: [
      task({ taskId: "a", deadlineWindowSecs: 5 * HOUR, loggedSecs: 2 * HOUR, createdAtMs: ahead }),
      task({ taskId: "b", deadlineWindowSecs: 4 * HOUR, createdAtMs: ahead }),
    ],
    anchorMs: ahead,
    addWorkingSecs: plainAdd,
    budget: "full",
    nowMs: NOW,
  });
  assert.equal(moved[1].startsAt, moved[0].dueDate, "b did not chain off a's real finish");
  assert.equal(moved[1].dueDate, new Date(ahead + 7 * HOUR * 1000).toISOString());
});

test("without nowMs every caller computes exactly what it did before", () => {
  /* The correction is opt-in. `chainDeadlines` is called by the Expected-
     completion projection too, and that must not change. */
  const ahead = T0 + 7.5 * HOUR * 1000;
  const q = [
    task({ taskId: "x", deadlineWindowSecs: 5 * HOUR, loggedSecs: 2 * HOUR, createdAtMs: ahead }),
  ];
  const withOut = chainDeadlines({ queue: q, anchorMs: ahead, addWorkingSecs: plainAdd, budget: "full" });
  assert.equal(withOut[0].dueDate, new Date(ahead + 5 * HOUR * 1000).toISOString());
});

test("a task with nothing logged is unaffected either way", () => {
  const ahead = T0 + 7.5 * HOUR * 1000;
  const q = [task({ taskId: "fresh", deadlineWindowSecs: 5 * HOUR, createdAtMs: ahead })];
  const a = chainDeadlines({ queue: q, anchorMs: ahead, addWorkingSecs: plainAdd, budget: "full" });
  const b = chainDeadlines({ queue: q, anchorMs: ahead, addWorkingSecs: plainAdd, budget: "full", nowMs: NOW });
  assert.equal(a[0].dueDate, b[0].dueDate);
});

test("logged time beyond the budget cannot produce a negative slot", () => {
  /* `remainingWorkSecs` floors at zero; the task still occupies the queue until
     it is submitted, so it must not pull the tasks behind it earlier than its
     own start. */
  const ahead = T0 + 7.5 * HOUR * 1000;
  const moved = chainDeadlines({
    queue: [
      task({ taskId: "spent", deadlineWindowSecs: 2 * HOUR, loggedSecs: 9 * HOUR, createdAtMs: ahead }),
      task({ taskId: "next", deadlineWindowSecs: HOUR, createdAtMs: ahead }),
    ],
    anchorMs: ahead,
    addWorkingSecs: plainAdd,
    budget: "full",
    nowMs: NOW,
  });
  assert.equal(moved[0].dueDate, new Date(ahead).toISOString());
  assert.ok(Date.parse(moved[1].dueDate) > Date.parse(moved[0].dueDate));
});

test("a start exactly at nowMs counts as pushed ahead", () => {
  /* The boundary. A task re-anchored to this instant has not been running from
     it, so its spent hours are behind the start just as they are for 17:00. */
  const moved = chainDeadlines({
    queue: [
      task({ taskId: "edge", deadlineWindowSecs: 5 * HOUR, loggedSecs: 2 * HOUR, createdAtMs: NOW }),
    ],
    anchorMs: NOW,
    addWorkingSecs: plainAdd,
    budget: "full",
    nowMs: NOW,
  });
  assert.equal(moved[0].dueDate, new Date(NOW + 3 * HOUR * 1000).toISOString());
});

test("the reorder path supplies logged time, the full budget and nowMs", () => {
  /**
   * The rule can only correct the over-grant if the caller hands it the three
   * things it needs. `remainingWorkSecs` reads `loggedSecs`, and the reorder
   * path built its queue straight from the task documents — which carry no such
   * field — so "remaining" silently equalled the full budget for every task.
   */
  const src = readFileSync("lib/repositories/legacy/index.ts", "utf8");
  const at = src.indexOf("async #recalculateQueueDeadlines");
  assert.ok(at > 0, "the reorder path was renamed or removed");
  const fn = src.slice(at, src.indexOf("\n  async ", at + 10));

  assert.match(fn, /#loggedSecsByTask\(employeeId\)/, "logged time is not read");
  assert.match(fn, /loggedSecs: loggedByTask\.get\(d\.id\) \?\? 0/, "logged time is not attached");
  assert.match(fn, /budget: "full"/, "a running task would lose time as it worked");
  /* Ordered rather than adjacent: the file is CRLF and carries comments
     between the two, so a line-anchored match is brittle. */
  assert.match(
    fn,
    /budget: "full"[\s\S]*?nowMs,[\s\S]*?addWorkingSecs/,
    "nowMs is not passed to the chain alongside the budget",
  );
});

/* ── The two shapes a priority change actually takes ───────────────────────── */

const EARLY = T0 - HOUR * 1000;
const RAISED_LATE = NOW; // 14:00, when the reorder happens

/** The queue from the worked example: 5h(2h done), 4h, 6h, 3h raised at 14:00. */
const four = () => [
  task({ taskId: "t1", deadlineWindowSecs: 5 * HOUR, loggedSecs: 2 * HOUR, createdAtMs: EARLY }),
  task({ taskId: "t2", deadlineWindowSecs: 4 * HOUR, createdAtMs: EARLY }),
  task({ taskId: "t3", deadlineWindowSecs: 6 * HOUR, createdAtMs: EARLY }),
  task({ taskId: "t4", deadlineWindowSecs: 3 * HOUR, createdAtMs: RAISED_LATE }),
];
const chain = (q: QueueTask[]) =>
  chainDeadlines({ queue: q, anchorMs: T0, addWorkingSecs: plainAdd, budget: "full", nowMs: NOW });
const dueOf = (r: { taskId: string; dueDate: string }[], id: string) =>
  r.find((x) => x.taskId === id)!.dueDate;

test("SWAP TWO (P3 <-> P4): only those two move", () => {
  /* The property the whole "recalculate only what moved" question turns on.
     Tasks above are never reached by the chain, and the pair occupies the same
     total time whichever order it is in — so nothing below them shifts either. */
  const [a, b, c, d] = four();
  const before = chain([a, b, c, d]);
  const after = chain([a, b, d, c]);

  assert.equal(dueOf(after, "t1"), dueOf(before, "t1"), "the head moved");
  assert.equal(dueOf(after, "t2"), dueOf(before, "t2"), "a task above the swap moved");
  assert.notEqual(dueOf(after, "t3"), dueOf(before, "t3"));
  assert.notEqual(dueOf(after, "t4"), dueOf(before, "t4"));
});

test("SWAP TWO: the pair still ends at the same instant", () => {
  /* Which is WHY nothing below them can shift: a + b working hours equals
     b + a, so the queue resumes at the same moment either way. */
  const [a, b, c, d] = four();
  const before = chain([a, b, c, d]);
  const after = chain([a, b, d, c]);
  const lastBefore = before[before.length - 1].dueDate;
  const lastAfter = after[after.length - 1].dueDate;
  assert.equal(lastAfter, lastBefore);
});

test("CASCADE (P4 -> P1): every position moves, and the worked hours are not re-granted", () => {
  /* Task 1 is pushed to second place, past the two hours it already spent, so
     it must be scheduled for the three that are LEFT. Granting five again would
     hand it seven hours for a five-hour task and push t2 and t3 out with it. */
  const [a, b, c, d] = four();
  const after = chain([d, a, b, c]);

  /* t4 leads, starting when it was raised rather than at the queue's opening. */
  assert.equal(after[0].taskId, "t4");
  assert.equal(after[0].startsAt, new Date(RAISED_LATE).toISOString());
  assert.equal(after[0].dueDate, new Date(RAISED_LATE + 3 * HOUR * 1000).toISOString());

  /* t1 takes 3h remaining, not its 5h budget. */
  const t1Start = Date.parse(after[1].startsAt);
  assert.equal(after[1].taskId, "t1");
  assert.equal(after[1].dueDate, new Date(t1Start + 3 * HOUR * 1000).toISOString());

  /* And the two behind it chain off that corrected finish. */
  assert.equal(after[2].startsAt, after[1].dueDate);
  assert.equal(after[3].startsAt, after[2].dueDate);
});

test("CASCADE: the head keeps its full budget when it is already running", () => {
  /* The mirror of the case above. Moving t1 DOWN uses its remainder; leaving it
     at the head, running from a start already behind us, keeps all five hours —
     so nobody's deadline tightens because they worked. */
  const [a, b, c, d] = four();
  const held = chain([a, b, c, d]);
  assert.equal(dueOf(held, "t1"), new Date(T0 + 5 * HOUR * 1000).toISOString());
});
