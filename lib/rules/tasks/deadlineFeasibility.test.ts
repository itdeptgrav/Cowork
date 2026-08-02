import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateDeadlineFeasibility } from "./deadlineFeasibility.ts";
import { addWorkingSecs } from "../../legacy-ui/officeDueDate.js";

/**
 * Will this task finish in time if it goes here?
 *
 * Driven through the REAL `addWorkingSecs` — production's own office-hours
 * walk, including nights, off days and breaks — because a preview computed a
 * different way would promise dates the engine then contradicts.
 */

/* Mon–Fri 09:00–18:00, no breaks. Simple enough to reason about by hand and
   real enough that nights and weekends genuinely bite. */
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
/* `blockedDates` is a Set — the port checks membership with `.has`. Passing an
   array threw, which is the fixture being wrong rather than the engine. */
const work = (anchorMs: number, secs: number) =>
  addWorkingSecs(anchorMs, secs, SCHEDULE, new Set<string>(), []);

/* Monday 09:00 IST — the start of a working week, so a nine-hour day is one
   full day and the arithmetic is checkable by eye. */
const MONDAY_9AM = Date.parse("2026-08-03T03:30:00.000Z");
const H = 3600;

function task(over: Record<string, unknown>) {
  return {
    status: "in_progress",
    assigneeIds: ["E1"],
    ...over,
  } as never;
}

const base = {
  employeeId: "E1",
  nowMs: MONDAY_9AM,
  addWorkingSecs: work,
};

/* ── 1 · An empty queue ───────────────────────────────────────────────────── */

test("with nothing else on, an eight-hour task fits before tomorrow", () => {
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 8 * H,
    committedDeadline: "2026-08-04T12:30:00.000Z", // Tue 18:00 IST
    tasks: [],
  });
  assert.equal(r.feasible, true);
  assert.equal(r.simulatedPosition, 1);
  assert.equal(r.blockingTasks.length, 0);
  assert.ok(r.bufferSeconds !== null && r.bufferSeconds > 0);
});

/* ── 2 · A full queue ─────────────────────────────────────────────────────── */

test("twenty hours already committed pushes an eight-hour task past tomorrow", () => {
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 9,
    estimatedWorkSeconds: 8 * H,
    committedDeadline: "2026-08-04T12:30:00.000Z", // Tue 18:00 IST
    tasks: [
      task({ taskId: "A", senderTimerWindowSecs: 10 * H, priority: 1 }),
      task({ taskId: "B", senderTimerWindowSecs: 10 * H, priority: 2 }),
    ],
  });
  assert.equal(r.feasible, false);
  assert.ok(r.bufferSeconds !== null && r.bufferSeconds < 0);
  assert.deepEqual(
    r.blockingTasks.map((b) => b.taskId),
    ["A", "B"],
  );
  assert.match(r.explanation, /misses the deadline/);
  assert.match(r.explanation, /2 tasks ahead of it/);
});

/* ── 3 · Moving up improves the date ──────────────────────────────────────── */

test("moving from last to first finishes sooner", () => {
  const tasks = [
    task({ taskId: "A", senderTimerWindowSecs: 8 * H, priority: 1 }),
    task({ taskId: "B", senderTimerWindowSecs: 8 * H, priority: 2 }),
    task({ taskId: "C", senderTimerWindowSecs: 8 * H, priority: 3 }),
    task({ taskId: "D", senderTimerWindowSecs: 8 * H, priority: 4 }),
  ];
  const last = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 5,
    estimatedWorkSeconds: 4 * H,
    committedDeadline: null,
    tasks,
  });
  const first = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 4 * H,
    committedDeadline: null,
    tasks,
  });
  assert.ok(
    Date.parse(first.estimatedCompletionTime!) <
      Date.parse(last.estimatedCompletionTime!),
    "moving up did not finish sooner",
  );
  assert.equal(first.simulatedPosition, 1);
  assert.equal(last.simulatedPosition, 5);
});

test("at the front nothing blocks and it starts now", () => {
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 2 * H,
    committedDeadline: null,
    tasks: [task({ taskId: "A", senderTimerWindowSecs: 8 * H, priority: 1 })],
  });
  assert.equal(r.blockingTasks.length, 0);
  assert.equal(r.estimatedStartTime, new Date(MONDAY_9AM).toISOString());
});

/* ── 4 · Unsettled budgets ARE workload, for this preview ─────────────────── */

/**
 * **Reversed, deliberately, from "does not delay the simulation".**
 *
 * The original version of this test asserted the opposite of what is below:
 * that a task still negotiating its budget should NOT compete for a place in
 * the chain, reasoning that counting it would show a placement as infeasible
 * over hours neither side had agreed.
 *
 * That protected against one failure mode and produced another, worse one:
 * two people's real, freshly-proposed work — most commonly two subtasks
 * broken out of the same parent in one sitting — is invisible to each other
 * until one of them is accepted. Ask "when will subtask 1 finish" and "when
 * will subtask 2 finish" and both come back with the SAME answer, because
 * each is evaluated as though it were the only thing in the queue. A person
 * looking at two sequential two-hour tasks does not finish both at the same
 * moment, whether or not either has been accepted yet — and a completion
 * preview that says otherwise is not "conservative", it is measurably wrong.
 *
 * The trade-off this reopens: a large, still-negotiable proposal sitting
 * anywhere in someone's queue now pushes out the preview for an unrelated new
 * placement too, until it is negotiated down or accepted. Weighed against two
 * pending tasks silently sharing one date, this is the direction chosen —
 * `windowSecsFor` already uses the proposed figure as the best available
 * estimate everywhere else (it is, after all, what is shown on screen as the
 * task's own time budget), so using it here treats a preview as what it says
 * it is: a preview, not a promise, over whatever the queue currently claims.
 */
test("a task still negotiating its budget DOES compete for a place, using its proposed window", () => {
  const withPending = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 2,
    estimatedWorkSeconds: 4 * H,
    committedDeadline: null,
    tasks: [
      task({
        taskId: "PENDING",
        senderTimerWindowSecs: 20 * H,
        priority: 1,
        budgetState: "WAITING_FOR_ASSIGNEE",
      }),
    ],
  });
  const withNothing = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 4 * H,
    committedDeadline: null,
    tasks: [],
  });
  assert.notEqual(
    withPending.estimatedCompletionTime,
    withNothing.estimatedCompletionTime,
    "an unsettled 20h task ahead of it must push the completion time out — otherwise two pending siblings read as simultaneous",
  );
  assert.equal(
    withPending.blockingTasks.length,
    1,
    "the unsettled task is what is in the way, and the reader is owed that name",
  );
});

test("two pending siblings, same budget, chain — the exact reported symptom", () => {
  /* T716 and T717: two subtasks broken out of the same parent, neither
     accepted, each proposed at two hours. Before the fix both reported the
     same completion time. */
  const tasks = [
    task({
      taskId: "T716",
      senderTimerWindowSecs: 2 * H,
      priority: 1,
      budgetState: "WAITING_FOR_ASSIGNEE",
    }),
  ];
  const secondSubtask = calculateDeadlineFeasibility({
    ...base,
    taskId: "T717",
    proposedPriority: 2,
    estimatedWorkSeconds: 2 * H,
    committedDeadline: null,
    tasks,
  });
  const firstSubtask = calculateDeadlineFeasibility({
    ...base,
    taskId: "T716",
    proposedPriority: 1,
    estimatedWorkSeconds: 2 * H,
    committedDeadline: null,
    tasks,
  });
  assert.notEqual(
    firstSubtask.estimatedCompletionTime,
    secondSubtask.estimatedCompletionTime,
    "T716 and T717 must not land on the same moment",
  );
  assert.equal(
    Date.parse(secondSubtask.estimatedCompletionTime!) -
      Date.parse(firstSubtask.estimatedCompletionTime!),
    2 * H * 1000,
    "T717 is a full two-hour budget behind T716, not simultaneous with it — Date.parse is milliseconds, H is seconds",
  );
});

test("a container ahead in the queue is not counted, even with its old proposed window", () => {
  const withContainer = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 2,
    estimatedWorkSeconds: 2 * H,
    committedDeadline: null,
    tasks: [
      task({
        taskId: "WAS_A_TASK",
        senderTimerWindowSecs: 20 * H,
        priority: 1,
        budgetState: "WAITING_FOR_ASSIGNEE",
        isContainer: true,
      }),
    ],
  });
  const withNothing = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 2 * H,
    committedDeadline: null,
    tasks: [],
  });
  assert.equal(
    withContainer.estimatedCompletionTime,
    withNothing.estimatedCompletionTime,
    "a broken-down task's leftover window must not compete — it holds no place in anyone's queue",
  );
  assert.equal(withContainer.blockingTasks.length, 0);
});

test("an accepted budget DOES delay it", () => {
  /* The other half — otherwise the exclusion above would be hiding real work. */
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 2,
    estimatedWorkSeconds: 4 * H,
    committedDeadline: null,
    tasks: [
      task({
        taskId: "AGREED",
        senderTimerWindowSecs: 8 * H,
        priority: 1,
        budgetState: "ACCEPTED",
      }),
    ],
  });
  assert.deepEqual(r.blockingTasks.map((b) => b.taskId), ["AGREED"]);
});

/* ── 5 · Finished work is ignored ─────────────────────────────────────────── */

test("completed and cancelled tasks do not consume time", () => {
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 3,
    estimatedWorkSeconds: 4 * H,
    committedDeadline: null,
    tasks: [
      task({ taskId: "DONE", senderTimerWindowSecs: 40 * H, priority: 1, status: "completed" }),
      task({ taskId: "GONE", senderTimerWindowSecs: 40 * H, priority: 2, status: "cancelled" }),
    ],
  });
  assert.equal(r.blockingTasks.length, 0);
  assert.equal(r.estimatedStartTime, new Date(MONDAY_9AM).toISOString());
});

/* ── 6 · Whose queue ──────────────────────────────────────────────────────── */

test("the simulation runs on the queue it is handed, and only that", () => {
  /* Cross-department: the ASSIGNEE does the work, so the creator's own load has
     no bearing. The caller supplies the queue, so it cannot silently be the
     wrong person's — this asserts the engine adds nothing of its own. */
  const r = calculateDeadlineFeasibility({
    ...base,
    employeeId: "RECEIVER",
    proposedPriority: 1,
    estimatedWorkSeconds: 4 * H,
    committedDeadline: null,
    tasks: [],
  });
  assert.equal(r.blockingTasks.length, 0);
  assert.equal(r.simulatedPosition, 1);
});

/* ── The real calendar ────────────────────────────────────────────────────── */

test("work does not run through the night", () => {
  /* Nine working hours from Monday 09:00 lands Tuesday, not the same evening —
     a naive hours-from-now sum would say 18:00 Monday. */
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 12 * H,
    committedDeadline: null,
    tasks: [],
  });
  const finish = new Date(r.estimatedCompletionTime!);
  assert.ok(
    finish.getTime() > MONDAY_9AM + 12 * H * 1000,
    "the calendar was not consulted",
  );
});

test("the preview uses production's own arithmetic", () => {
  /* Same function the engine calls. A separate implementation would drift and
     the preview would promise dates that never arrive. */
  const direct = work(MONDAY_9AM, 6 * H);
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 6 * H,
    committedDeadline: null,
    tasks: [],
  });
  assert.equal(r.estimatedCompletionTime, direct);
});

/* ── Answers, not just verdicts ───────────────────────────────────────────── */

test("an infeasible placement suggests what to do about it", () => {
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 3,
    estimatedWorkSeconds: 8 * H,
    committedDeadline: "2026-08-03T12:30:00.000Z", // Mon 18:00 IST
    tasks: [
      task({ taskId: "A", senderTimerWindowSecs: 8 * H, priority: 1 }),
      task({ taskId: "B", senderTimerWindowSecs: 8 * H, priority: 2 }),
    ],
  });
  assert.equal(r.feasible, false);
  const actions = r.suggestions.map((s) => s.action);
  assert.deepEqual(actions, [
    "increase_priority",
    "increase_budget",
    "request_deadline_change",
  ]);
});

test("moving up is not suggested to something already first", () => {
  /* There is nothing left to overtake, and offering it would send somebody to a
     control that changes nothing. */
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 40 * H,
    committedDeadline: "2026-08-03T12:30:00.000Z",
    tasks: [],
  });
  assert.equal(r.feasible, false);
  assert.equal(
    r.suggestions.some((s) => s.action === "increase_priority"),
    false,
  );
});

test("a feasible placement suggests nothing and blocks nobody", () => {
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 2,
    estimatedWorkSeconds: 1 * H,
    committedDeadline: "2026-08-14T12:30:00.000Z",
    tasks: [task({ taskId: "A", senderTimerWindowSecs: 2 * H, priority: 1 })],
  });
  assert.equal(r.feasible, true);
  assert.deepEqual(r.suggestions, []);
  assert.deepEqual(r.blockingTasks, []);
});

/* ── Honest edges ─────────────────────────────────────────────────────────── */

test("no committed deadline is not an infeasible one", () => {
  /* Saying "will not meet its deadline" about a task nobody promised a date for
     would invent a commitment. */
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 100 * H,
    committedDeadline: null,
    tasks: [],
  });
  assert.equal(r.feasible, true);
  assert.equal(r.bufferSeconds, null);
  assert.match(r.explanation, /nothing to miss/);
});

test("a priority past the end of the queue means last", () => {
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 99,
    estimatedWorkSeconds: 1 * H,
    committedDeadline: null,
    tasks: [task({ taskId: "A", senderTimerWindowSecs: 1 * H, priority: 1 })],
  });
  assert.equal(r.simulatedPosition, 2);
});

test("an existing task is not counted against itself", () => {
  /* Previewing a move for a task already in the queue must not have it block
     its own placement. */
  const tasks = [
    task({ taskId: "ME", senderTimerWindowSecs: 8 * H, priority: 3 }),
    task({ taskId: "A", senderTimerWindowSecs: 8 * H, priority: 1 }),
  ];
  const r = calculateDeadlineFeasibility({
    ...base,
    taskId: "ME",
    proposedPriority: 1,
    estimatedWorkSeconds: 8 * H,
    committedDeadline: null,
    tasks,
  });
  assert.equal(r.currentPosition, 2, "it was second by stored rank");
  assert.equal(r.blockingTasks.length, 0, "it blocked itself");
});

test("nothing is mutated — the caller's array is untouched", () => {
  const tasks = [task({ taskId: "A", senderTimerWindowSecs: 8 * H, priority: 1 })];
  const before = JSON.stringify(tasks);
  calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 4 * H,
    committedDeadline: null,
    tasks,
  });
  assert.equal(JSON.stringify(tasks), before);
});

/* ── The trace and the knock-on ───────────────────────────────────────────── */

test("the simulated queue shows the whole order, not just this task", () => {
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 2,
    estimatedWorkSeconds: 4 * H,
    committedDeadline: null,
    tasks: [
      task({ taskId: "A", title: "Task A", senderTimerWindowSecs: 4 * H, priority: 1 }),
      task({ taskId: "B", title: "Task B", senderTimerWindowSecs: 4 * H, priority: 2 }),
    ],
  });
  assert.deepEqual(
    r.simulatedQueue.map((e) => [e.position, e.taskId]),
    [[1, "A"], [2, "__proposed__"], [3, "B"]],
  );
});

test("inserting pushes what is below it, and says by how much", () => {
  /* The reason a preview must simulate the CHAIN: a placement that looks fine
     for this task can make three others late. */
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 4 * H,
    committedDeadline: null,
    tasks: [
      task({ taskId: "A", title: "Task A", senderTimerWindowSecs: 4 * H, priority: 1 }),
    ],
  });
  assert.deepEqual(r.affectedTasks.map((t) => t.taskId), ["A"]);
  assert.ok(r.affectedTasks[0].movedLaterSeconds > 0);
  assert.match(r.calculationTrace.join(" "), /Task A moves later by/);
});

test("nothing below means nothing affected", () => {
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 9,
    estimatedWorkSeconds: 2 * H,
    committedDeadline: null,
    tasks: [task({ taskId: "A", title: "Task A", senderTimerWindowSecs: 2 * H, priority: 1 })],
  });
  assert.deepEqual(r.affectedTasks, []);
});

test("the trace explains placement, then the calendar, then the verdict", () => {
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 2,
    estimatedWorkSeconds: 4 * H,
    committedDeadline: "2026-08-14T12:30:00.000Z",
    tasks: [
      task({ taskId: "A", title: "Task A", senderTimerWindowSecs: 4 * H, priority: 1 }),
    ],
  });
  const joined = r.calculationTrace.join(" | ");
  assert.match(joined, /Placed at position 2/);
  assert.match(joined, /Waits for Task A/);
  assert.match(joined, /Finishes /);
  assert.match(joined, /before the deadline/);
});

test("a late finish is stated as an overrun, not as slack", () => {
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 40 * H,
    committedDeadline: "2026-08-03T12:30:00.000Z",
    tasks: [],
  });
  assert.match(r.calculationTrace.join(" "), /Overruns the deadline by/);
});

test("repeated closed days are not repeated in the trace", () => {
  /* A long gap logs every skipped day; four identical "office closed" lines say
     no more than one. */
  const r = calculateDeadlineFeasibility({
    ...base,
    proposedPriority: 1,
    estimatedWorkSeconds: 2 * H,
    committedDeadline: null,
    tasks: [],
    explainWorkingSecs: () => [
      { type: "off", date: "2026-08-08" },
      { type: "off", date: "2026-08-08" },
      { type: "holiday", date: "2026-08-15", name: "Independence Day" },
    ],
  });
  const closed = r.calculationTrace.filter((l) => l.includes("2026-08-08"));
  assert.equal(closed.length, 1);
  assert.match(r.calculationTrace.join(" "), /Independence Day/);
});
