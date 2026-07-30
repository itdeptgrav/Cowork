import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import {
  assignPriorityRanks,
  calculatePriorityOrder,
  isActiveWorkload,
  normalizePriorityQueue,
  type QueueCandidate,
} from "./priorityQueue.ts";
import { nextActiveRank, type QueueEntry } from "./activeQueue.ts";
import {
  addWallClockDuration,
  cascadeShifts,
  isDuplicateCascade,
  CASCADE_DEDUP_WINDOW_MS,
  type CascadeQueueEntry,
} from "./priorityCascade.ts";
import { anchorMsFor, chainDeadlines } from "./priorityDeadline.ts";
import {
  displaySecs,
  elapsedSecs,
  runDurationSecs,
  timerDisplayState,
} from "./timer.ts";

/**
 * The Priority + Timer + P1-cascade model, verified end to end.
 *
 * The eighteen scenarios the brief named. Where the behaviour lives in a pure
 * rule it is driven through that rule; where it lives in a repository write it
 * is asserted on source, because "starting a timer re-chains the queue" is a
 * claim about the wiring, not about one calculation — and the legacy repository
 * writes Firestore, which does not unit-test.
 *
 * **Source anchors are code constructs, never comments.** `code()` strips
 * comments first, so a slice bounded by a doc-comment runs to end of file — the
 * single most repeated mistake in this codebase's tests. Every slice here is
 * bounded by a method signature.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const LEGACY = "lib/repositories/legacy/index.ts";
const MOCK = "lib/repositories/mock/index.ts";

/** A live queue entry, as `activeQueue`/`priorityQueue` read it. */
const entry = (taskId: string, storedRank: number | null): QueueEntry => ({
  taskId,
  status: "in_progress",
  storedRank,
});

const cand = (taskId: string, storedRank: number | null): QueueCandidate => ({
  taskId,
  status: "in_progress",
  storedRank,
  createdAtMs: 1000 + Number(taskId.replace(/\D/g, "") || 0),
});

/* ══ PRIORITY ═══════════════════════════════════════════════════════════════ */

test("1 · a new task lands at the bottom of the person's queue", () => {
  /* The brief says "count + 1". The codebase deliberately uses HIGHEST rank + 1,
     because a raw count collides the instant the queue has a gap — three tasks
     at 5, 6, 7 give a count of 3, so "count + 1" would store 4 and land the new
     task ABOVE all three. Gaps are not hypothetical: closing a task leaves one.
     The invariant the brief actually wants — new work goes to the back — holds. */
  assert.equal(nextActiveRank([]), 1);
  assert.equal(nextActiveRank([entry("a", 1), entry("b", 2)]), 3);
  assert.equal(
    nextActiveRank([entry("a", 5), entry("b", 6), entry("c", 7)]),
    8,
    "a new task must land behind a gapped queue, not jump into the gap",
  );
});

test("2 · a queue never carries duplicate priorities", () => {
  for (const ranks of [
    [1, 1, 1],
    [5, 5, 5, 5],
    [null, null, null],
    [10, 1, 10, 1],
    [2, 2, 3, 3, 1],
  ]) {
    const q = normalizePriorityQueue(
      ranks.map((r, i) => cand(`t${i}`, r)),
    );
    const values = [...q.ranks.values()];
    assert.equal(
      new Set(values).size,
      values.length,
      `duplicates survived normalising ${JSON.stringify(ranks)}`,
    );
  }
});

test("3 · a queue never carries gaps", () => {
  const q = normalizePriorityQueue([cand("a", 3), cand("b", 7), cand("c", 9)]);
  assert.deepEqual(
    [...q.ranks.values()].sort((x, y) => x - y),
    [1, 2, 3],
    "the survivors must be 1..N with nothing missing",
  );
});

test("4 · completed and cancelled tasks leave the queue", () => {
  const before: QueueCandidate[] = [
    { taskId: "a", status: "in_progress", storedRank: 1 },
    { taskId: "done", status: "completed", storedRank: 2 },
    { taskId: "gone", status: "cancelled", storedRank: 3 },
    { taskId: "c", status: "in_progress", storedRank: 4 },
  ];
  const q = normalizePriorityQueue(before);
  assert.deepEqual([...q.ranks.entries()], [["a", 1], ["c", 2]]);
  assert.equal(q.ranks.has("done"), false);
  assert.equal(q.ranks.has("gone"), false);
  /* The closed tasks keep the rank they finished with — they are records, not
     live work, so they are never renumbered. */
  assert.equal(
    q.changes.some((ch) => ch.taskId === "done" || ch.taskId === "gone"),
    false,
    "a closed task was rewritten to make room for live work",
  );
});

test("5 · a drag reorder renumbers 1..N in the dragged order", () => {
  /* `assignPriorityRanks` numbers by array index, so whatever order the drag
     produced becomes 1..N with no gap or duplicate by construction. */
  const dragged = ["c", "a", "b"];
  const ranks = assignPriorityRanks(dragged);
  assert.deepEqual([...ranks.entries()], [["c", 1], ["a", 2], ["b", 3]]);

  /* And the write path renumbers before it re-schedules — the dates are chained
     in queue order, so chaining a queue about to be renumbered computes twice. */
  const src = code(LEGACY);
  const at = src.indexOf("async reorderPriorities(");
  const body = src.slice(at, src.indexOf("async listPriorityConflicts(", at));
  assert.ok(body.length > 0, "reorderPriorities slice anchor drifted");
  assert.match(body, /#recalculateQueueDeadlines\(/);
});

/* ══ TIMER ══════════════════════════════════════════════════════════════════ */

test("6 · a person can hold only one running timer", () => {
  /* Enforced at the write, not the UI: startTimer reads whatever else is running
     and pauses it before it starts the new session. */
  const src = code(LEGACY);
  const at = src.indexOf("async startTimer(");
  const body = src.slice(at, src.indexOf("async pauseTimer(", at));
  assert.ok(body.length > 0, "startTimer slice anchor drifted");
  assert.match(body, /const active = await this\.getActiveTimer\(\)/);
  assert.match(body, /if \(active && active\.taskId !== id\)/);
});

test("7 · starting another task auto-pauses the previous one", () => {
  const src = code(LEGACY);
  const at = src.indexOf("async startTimer(");
  const body = src.slice(at, src.indexOf("async pauseTimer(", at));
  assert.match(
    body,
    /await this\.pauseTimer\(active\.taskId, null, "switched_task"/,
    "the previous timer is not paused with the switched_task reason",
  );
});

test("8 · worked seconds are preserved across a pause/resume", () => {
  /* The banked total is carried, never reset: startTimer reads the existing
     `totalSeconds` and starts the new run from it. */
  const src = code(LEGACY);
  const at = src.indexOf("async startTimer(");
  const body = src.slice(at, src.indexOf("async pauseTimer(", at));
  assert.match(body, /totalSeconds: accumulated/);

  /* And the arithmetic that produces the banked figure is real-elapsed, derived
     from two timestamps — a throttled tab cannot lose or invent time. */
  assert.equal(elapsedSecs(1_000_000, 1_090_000), 90);
  assert.equal(
    runDurationSecs({
      startedAtRealMs: 1_000_000,
      nowRealMs: 1_030_000,
      fallbackSimElapsedMs: 0,
    }),
    30,
  );
  /* Resume continues from the bank rather than restarting the display at 0. */
  assert.equal(
    displaySecs({ isActive: true, startedAtRealMs: 1_000_000 }, 120, 1_010_000),
    130,
  );
});

test("9 · an offline person cannot open a timer at all", () => {
  /* The offline restriction is held at the write, so no duplicate/again-online
     race in the UI can slip a start through — presence is checked before the
     session is written. */
  const src = code(LEGACY);
  const at = src.indexOf("async startTimer(");
  const body = src.slice(at, src.indexOf("async pauseTimer(", at));
  assert.match(body, /presenceWriteRefusal\(await this\.getDutyMode\(\)\)/);
  assert.ok(
    body.indexOf("presenceWriteRefusal") < body.indexOf("await setDoc("),
    "presence is checked before the timer document is written",
  );
});

/* ══ DEADLINE ═══════════════════════════════════════════════════════════════ */

test("10 · working seconds skip breaks and off-days", () => {
  /* Driven through an INJECTED calendar so the assertion is timezone-free: the
     fake advances one working day per 8h and jumps a Sunday. What is verified is
     that `chainDeadlines` schedules the REMAINDER through whatever calendar it is
     given, off-days included, rather than adding wall-clock seconds. The real
     `officeDueDate.addWorkingSecs` is the one the repository injects (asserted in
     the wiring tests); its own off-day maths is covered by outsideOfficeHours. */
  const OFF_DAY_MS = 24 * 3600 * 1000;
  const calls: Array<{ anchorMs: number; secs: number }> = [];
  const fakeWork = (anchorMs: number, secs: number) => {
    calls.push({ anchorMs, secs });
    /* Pretend the window spans a Sunday: the wall-clock result is the work plus
       a whole skipped day. A naive addition would omit the extra day. */
    return new Date(anchorMs + secs * 1000 + OFF_DAY_MS).toISOString();
  };
  const anchor = Date.parse("2026-07-31T09:30:00.000Z");
  const out = chainDeadlines({
    queue: [
      {
        taskId: "A",
        assigneeIds: ["P"],
        priority: 1,
        senderTimerWindowSecs: 2 * 3600,
        loggedSecs: 0,
      },
    ] as never,
    anchorMs: anchor,
    addWorkingSecs: fakeWork,
  });
  assert.equal(out.length, 1);
  assert.equal(
    calls[0].secs,
    2 * 3600,
    "the full remaining window must be scheduled through the calendar",
  );
  assert.ok(
    Date.parse(out[0].dueDate) - anchor > 2 * 3600 * 1000,
    "the off-day was not skipped — the due date only added working seconds",
  );
});

test("11 · a running task's deadline projects from when work started", () => {
  /* A queue whose leader started within the last day anchors at that start — the
     work is already running, so it is measured from when it actually began. */
  const nowMs = Date.parse("2026-07-30T12:00:00.000Z");
  const startedMs = Date.parse("2026-07-30T09:30:00.000Z");
  const anchor = anchorMsFor({
    leader: { taskId: "A", startedAt: startedMs } as never,
    officeOpenMs: Date.parse("2026-07-30T04:00:00.000Z"),
    nowMs,
  });
  assert.equal(anchor, startedMs, "a running leader must anchor at its start");
  assert.equal(
    timerDisplayState({ isActive: true, startedAtRealMs: startedMs }, 0, nowMs),
    "running",
  );
});

test("12 · a not-yet-started task's deadline projects from office open", () => {
  /* No recent start → the queue has not begun, so it anchors at today's opening
     rather than at whatever moment somebody happened to look. */
  const nowMs = Date.parse("2026-07-30T12:00:00.000Z");
  const officeOpenMs = Date.parse("2026-07-30T04:00:00.000Z");
  const anchor = anchorMsFor({
    leader: { taskId: "A", startedAt: null } as never,
    officeOpenMs,
    nowMs,
  });
  assert.equal(anchor, officeOpenMs);
  assert.equal(
    timerDisplayState(null, 0, nowMs),
    "not_started",
    "a session that never ran is not paused",
  );
  assert.equal(
    timerDisplayState({ isActive: false, startedAtRealMs: null }, 300, nowMs),
    "paused",
    "a stopped session with banked time is paused, not not-started",
  );
});

/* ══ CASCADE ════════════════════════════════════════════════════════════════ */

const casEntry = (
  taskId: string,
  previousRank: number,
  newRank: number,
  remainingSecs: number,
  dueAt: string | null,
): CascadeQueueEntry => ({ taskId, previousRank, newRank, remainingSecs, dueAt });

test("13 · a new P1 pushes every lower task by its inserted work", () => {
  /* D jumps to P1, pushing A/B/C down one. Each moves LATER by D's remaining
     work — the seconds newly inserted ahead of it — and by nothing else. */
  const D_WORK = 2 * 3600;
  const shifts = cascadeShifts({
    entries: [
      casEntry("D", 4, 1, D_WORK, "2026-07-30T18:00:00.000Z"),
      casEntry("A", 1, 2, 3600, "2026-07-30T11:00:00.000Z"),
      casEntry("B", 2, 3, 3600, "2026-07-30T14:00:00.000Z"),
      casEntry("C", 3, 4, 3600, "2026-07-30T15:00:00.000Z"),
    ],
    addDuration: addWallClockDuration,
  });
  const moved = new Map(shifts.map((s) => [s.taskId, s.shiftedBySecs]));
  assert.equal(moved.get("A"), D_WORK);
  assert.equal(moved.get("B"), D_WORK);
  assert.equal(moved.get("C"), D_WORK);
  assert.equal(moved.has("D"), false, "the promoted task does not shift itself");
});

test("14 · dragging a task to P1 re-schedules the queue", () => {
  /* changePriority and reorderPriorities both re-anchor the queue's deadlines
     after the rank write — a rank alone is "priority changed and nothing
     happened". */
  const src = code(LEGACY);
  const cp = src.indexOf("async changePriority(");
  const cpBody = src.slice(cp, src.indexOf("async #parentOf(", cp));
  assert.match(cpBody, /#recalculateQueueDeadlines\(/);
  const ro = src.indexOf("async reorderPriorities(");
  assert.match(
    src.slice(ro, ro + 3000),
    /#recalculateQueueDeadlines\(/,
    "reorderPriorities does not re-schedule",
  );
});

test("15 · starting a P1 timer does NOT move the deadline", () => {
  /* Reversal, made legible. An earlier version re-anchored the queue's dueDate at
     Date.now() on every start — but startTimer is also the resume path, so
     `now + remaining` marched the deadline forward each play. The deadline is
     frozen while a person is online and working (Cases 1-2 of the availability
     rule); only lost availability moves it. So the start path must not touch the
     schedule. */
  const src = code(LEGACY);
  const at = src.indexOf("async startTimer(");
  const body = src.slice(at, src.indexOf("async pauseTimer(", at));
  assert.equal(
    /#recalculateQueueDeadlines\(/.test(body),
    false,
    "starting a timer re-chains the queue — that is the deadline drift",
  );
  assert.equal(
    body.includes("dueDate"),
    false,
    "starting a timer writes a deadline — it must stay frozen",
  );
});

test("16 · a confirmed budget extension cascades through the derived queue", () => {
  /* The extension cascade is REAL but needs no write. The operational dates are
     derived on every read from `#chainQueue`, which reads the new budget the
     instant it lands — so applying the budget IS the recalculation. A `dueDate`
     write in the confirm path would be a stale second copy (budgetLoop test 7),
     so this asserts the confirm path does NOT store one and simply re-runs the
     read. */
  const src = code(LEGACY);
  const at = src.indexOf("async confirmTimeBudgetExtension(");
  const body = src.slice(at, src.indexOf("async #applyAgreedBudget(", at));
  assert.ok(body.length > 0, "confirmTimeBudgetExtension slice anchor drifted");
  assert.match(body, /#applyAgreedBudget\(/, "the budget is not applied");
  assert.match(body, /notifyRepositoryChanged\(\)/, "the read is not re-run");
  for (const banned of ["dueDate", "dueAt", "operationalDueAt"]) {
    assert.equal(
      body.includes(banned),
      false,
      `confirming a budget writes ${banned} — the queue is derived, not stored`,
    );
  }

  /* And the behaviour the derived chain produces: +1h of remaining work on the
     leader pushes every follower's date +1h, laid end to end through the
     calendar. Driven through `chainDeadlines` — the function `#chainQueue`
     calls. */
  const H = 3600;
  const add = (anchorMs: number, secs: number) =>
    new Date(anchorMs + secs * 1000).toISOString();
  const anchor = Date.parse("2026-07-30T09:00:00.000Z");
  const queue = [
    { taskId: "P1", assigneeIds: ["P"], priority: 1, senderTimerWindowSecs: 2 * H, loggedSecs: 0 },
    { taskId: "P2", assigneeIds: ["P"], priority: 2, senderTimerWindowSecs: 1 * H, loggedSecs: 0 },
  ];
  const before = chainDeadlines({ queue: queue as never, anchorMs: anchor, addWorkingSecs: add });
  const extended = [{ ...queue[0], senderTimerWindowSecs: 3 * H }, queue[1]];
  const after = chainDeadlines({ queue: extended as never, anchorMs: anchor, addWorkingSecs: add });
  const p2Before = Date.parse(before.find((d) => d.taskId === "P2")!.dueDate);
  const p2After = Date.parse(after.find((d) => d.taskId === "P2")!.dueDate);
  assert.equal(
    (p2After - p2Before) / 1000,
    H,
    "P1's extra hour did not push P2 exactly one hour later",
  );
});

test("17 · a cascade can only move a deadline later, never earlier", () => {
  /* The relative rule makes the floor a property, not a guard: the shift is the
     work inserted ahead, which is non-negative, and addDuration only advances.
     A task that moved UP is never in the result. */
  const shifts = cascadeShifts({
    entries: [
      casEntry("up", 3, 1, 3600, "2026-07-30T15:00:00.000Z"),
      casEntry("down", 1, 2, 3600, "2026-07-30T11:00:00.000Z"),
    ],
    addDuration: addWallClockDuration,
  });
  assert.equal(
    shifts.some((s) => s.taskId === "up"),
    false,
    "a promoted task must never be pulled earlier",
  );
  for (const s of shifts) {
    assert.ok(
      Date.parse(s.newDueAt) >= Date.parse(s.previousDueAt),
      "a cascade produced an earlier deadline",
    );
  }

  /* The written paths touch dueDate only, never the scored commitment, so the
     floor on the commitment holds by construction. */
  const src = code(LEGACY);
  const st = src.indexOf("async #recalculateQueueDeadlines(");
  const body = src.slice(st, src.indexOf("async reorderPriorities(", st));
  assert.match(body, /dueDate,/);
  assert.equal(
    /officialDueDate/.test(body),
    false,
    "the recalculation must not rewrite the scored commitment",
  );
});

test("18 · the same cascade does not fire twice within two minutes", () => {
  assert.equal(CASCADE_DEDUP_WINDOW_MS, 2 * 60 * 1000);
  const base = Date.parse("2026-07-30T09:00:00.000Z");
  const existing = [
    {
      employeeId: "P",
      triggeringTaskId: "D",
      reason: "priority_swap",
      createdAt: new Date(base).toISOString(),
    },
  ];
  const candidate = {
    employeeId: "P",
    triggeringTaskId: "D",
    reason: "priority_swap",
  };
  /* One minute on: the same event observed again. */
  assert.equal(isDuplicateCascade(candidate, existing, base + 60_000), true);
  /* Just past the window: a genuinely new cascade. */
  assert.equal(
    isDuplicateCascade(candidate, existing, base + CASCADE_DEDUP_WINDOW_MS + 1),
    false,
  );
  /* A different trigger within the window is not a duplicate. */
  assert.equal(
    isDuplicateCascade(
      { ...candidate, triggeringTaskId: "E" },
      existing,
      base + 60_000,
    ),
    false,
  );

  /* And the mock wires it: the dedup guard sits before the record is pushed. */
  const mock = code(MOCK);
  const at = mock.indexOf("#applyOrder(");
  const body = mock.slice(at, mock.indexOf("async listPriorityConflicts(", at));
  assert.match(body, /isDuplicateCascade\(/);
  assert.ok(
    body.indexOf("isDuplicateCascade") < body.indexOf("s.cascades.push("),
    "the duplicate check must run before the cascade is recorded",
  );
});

/* A guard on the guards: the two lifecycle predicates stay distinct, because
   collapsing them is what let unaccepted work hold a slot or closed work keep
   one. */
test("membership predicates remain distinct", () => {
  assert.equal(isActiveWorkload(cand("live", 1)), true);
  assert.equal(
    isActiveWorkload({ taskId: "x", status: "completed", storedRank: 1 }),
    false,
  );
  /* calculatePriorityOrder excludes the closed one from the order entirely. */
  assert.deepEqual(
    calculatePriorityOrder([
      cand("a", 2),
      { taskId: "done", status: "completed", storedRank: 1 },
      cand("b", 3),
    ]),
    ["a", "b"],
  );
});
