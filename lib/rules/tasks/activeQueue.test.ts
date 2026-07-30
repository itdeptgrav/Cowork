import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  activeQueuePositions,
  isActiveInQueue,
  isActivePriorityTask,
  nextActiveRank,
  queueRankFor,
  type QueueEntry,
} from "./activeQueue.ts";

/**
 * P1/P2/P3 over the tasks still in play.
 *
 * The reported fault: a completed P1 kept slot 1 for ever, so the next thing to
 * do read "P2" and there was no P1 on the screen at all. Nothing here changes a
 * lifecycle or writes a rank — it decides which number is DISPLAYED.
 */

function entry(over: Partial<QueueEntry> & { taskId: string }): QueueEntry {
  return { status: "in_progress", storedRank: null, ...over };
}

/* ── The scenario from the request ────────────────────────────────────────── */

const A = entry({ taskId: "A", storedRank: 1 });
const B = entry({ taskId: "B", storedRank: 2 });
const C = entry({ taskId: "C", storedRank: 3 });

test("three active tasks number 1, 2, 3", () => {
  const p = activeQueuePositions([A, B, C]);
  assert.deepEqual([p.get("A"), p.get("B"), p.get("C")], [1, 2, 3]);
});

test("completing P1 moves P2 up to P1 and P3 up to P2", () => {
  /* The whole request, in one assertion. */
  const p = activeQueuePositions([{ ...A, status: "completed" }, B, C]);
  assert.equal(p.get("B"), 1);
  assert.equal(p.get("C"), 2);
});

test("the completed task holds no position at all", () => {
  /* Absent rather than null: asking a closed task for its queue position is the
     wrong question, and a missing key says so more clearly. */
  const p = activeQueuePositions([{ ...A, status: "completed" }, B, C]);
  assert.equal(p.has("A"), false);
});

test("completing the middle of the queue closes only that gap", () => {
  const p = activeQueuePositions([A, { ...B, status: "completed" }, C]);
  assert.deepEqual([p.get("A"), p.get("C")], [1, 2]);
});

/* ── Which statuses hold a slot ───────────────────────────────────────────── */

test("every way a task leaves the queue removes it", () => {
  for (const status of [
    "completed", "cancelled", "assignment_rejected", "draft",
  ]) {
    const p = activeQueuePositions([{ ...A, status }, B]);
    assert.equal(p.has("A"), false, `${status} still occupies a slot`);
    assert.equal(p.get("B"), 1, `${status} did not let the queue move up`);
  }
});

test("work that can still come back keeps its slot", () => {
  /* `in_review` is submitted, not finished — rework returns it to the same
     desk, and a task that may land back on you has not left your day. */
  for (const status of [
    "assigned", "deadline_negotiation", "confirmed", "in_progress", "in_review",
  ]) {
    assert.equal(isActiveInQueue(status), true, `${status} should hold a slot`);
  }
});

test("a task held at a cross-department gate needs no special case", () => {
  /* It carries no assignees, so it never enters a queue in the first place —
     the gate parks the person in `pendingAssigneeId` precisely because the work
     is not yet theirs. */
  assert.equal(isActiveInQueue("pending_approval"), false);
});

/* ── Ordering is preserved, never invented ───────────────────────────────── */

test("an explicit ranking is never overridden, only compacted", () => {
  /* Stored 1, 5, 9 with nothing between them is still first, second, third —
     the gaps close and the ORDER does not move. */
  const p = activeQueuePositions([
    entry({ taskId: "X", storedRank: 9 }),
    entry({ taskId: "Y", storedRank: 1 }),
    entry({ taskId: "Z", storedRank: 5 }),
  ]);
  assert.deepEqual([p.get("Y"), p.get("Z"), p.get("X")], [1, 2, 3]);
});

test("tasks sharing a rank keep the order a manager dragged them into", () => {
  /* `order` is legacy's `(index + 1) * 1000`, written beside the rank by the
     drag handler for exactly this. */
  const p = activeQueuePositions([
    entry({ taskId: "second", storedRank: 1, order: 2000 }),
    entry({ taskId: "first", storedRank: 1, order: 1000 }),
  ]);
  assert.deepEqual([p.get("first"), p.get("second")], [1, 2]);
});

test("with nothing else to separate them, the older task comes first", () => {
  const p = activeQueuePositions([
    entry({ taskId: "new", storedRank: 1, createdAtMs: Date.parse("2026-07-29T10:00:00Z") }),
    entry({ taskId: "old", storedRank: 1, createdAtMs: Date.parse("2026-07-01T10:00:00Z") }),
  ]);
  assert.deepEqual([p.get("old"), p.get("new")], [1, 2]);
});

test("unranked tasks sort to the bottom and are still numbered", () => {
  /* Legacy's 999 sentinel means "never written", not "priority 999" — but the
     task is still in the queue and still needs a position. */
  const p = activeQueuePositions([
    entry({ taskId: "unranked", storedRank: null }),
    entry({ taskId: "ranked", storedRank: 2 }),
  ]);
  assert.deepEqual([p.get("ranked"), p.get("unranked")], [1, 2]);
});

test("the order is total, so the same queue never renders two ways", () => {
  /* Two tasks identical in every tie-break would otherwise depend on whatever
     order the directory returned, and the numbers would shuffle on refresh. */
  const same = [
    entry({ taskId: "b", storedRank: 1 }),
    entry({ taskId: "a", storedRank: 1 }),
  ];
  const first = activeQueuePositions(same);
  const second = activeQueuePositions([...same].reverse());
  assert.deepEqual(
    [first.get("a"), first.get("b")],
    [second.get("a"), second.get("b")],
  );
});

/* ── Per-employee scope ───────────────────────────────────────────────────── */

test("a queue is built only from the entries it was given", () => {
  /* The scope guarantee, structurally: this function has no way to see another
     employee's tasks, so completing one person's P1 cannot renumber anybody
     else's. The caller builds one list per employee. */
  const a = activeQueuePositions([
    entry({ taskId: "X", storedRank: 1 }),
    entry({ taskId: "Y", storedRank: 2 }),
  ]);
  const b = activeQueuePositions([entry({ taskId: "Z", storedRank: 1 })]);
  assert.equal(b.get("Z"), 1);
  const afterClose = activeQueuePositions([
    entry({ taskId: "X", storedRank: 1, status: "completed" }),
    entry({ taskId: "Y", storedRank: 2 }),
  ]);
  assert.equal(afterClose.get("Y"), 1, "A's queue moved up");
  assert.equal(a.get("Y"), 2, "the earlier result was not mutated");
  assert.equal(b.get("Z"), 1, "B's queue is untouched");
});

/* ── Closed tasks keep their record ───────────────────────────────────────── */

test("a closed task reports no live position but remembers its rank", () => {
  const r = queueRankFor(
    { ...A, status: "completed" },
    activeQueuePositions([{ ...A, status: "completed" }, B]),
  );
  assert.equal(r.activeRank, null, "a closed task must not claim a live slot");
  assert.equal(r.storedRank, 1, "what it was carrying is still on the record");
  assert.equal(r.isActive, false);
});

test("an active task reports its position, not its stored number", () => {
  /* The distinction the fix rests on: B is stored 2 and is now first. */
  const positions = activeQueuePositions([{ ...A, status: "completed" }, B]);
  const r = queueRankFor(B, positions);
  assert.equal(r.activeRank, 1);
  assert.equal(r.storedRank, 2);
});

test("the unranked sentinel is never reported as a rank", () => {
  /* 999 means the field was never written. Printing "was P999" on a closed task
     would invent a priority nobody set. */
  const r = queueRankFor(
    entry({ taskId: "q", status: "completed", storedRank: 999 }),
    new Map(),
  );
  assert.equal(r.storedRank, null);
});

/* ── Boundaries ───────────────────────────────────────────────────────────── */

test("an empty queue is empty, not a queue of one", () => {
  assert.equal(activeQueuePositions([]).size, 0);
  assert.equal(
    activeQueuePositions([{ ...A, status: "completed" }]).size,
    0,
  );
});

test("positions are contiguous from 1 with no gaps or repeats", () => {
  const entries = [
    entry({ taskId: "a", storedRank: 4 }),
    entry({ taskId: "b", storedRank: 2, status: "cancelled" }),
    entry({ taskId: "c", storedRank: 7 }),
    entry({ taskId: "d", storedRank: null }),
    entry({ taskId: "e", storedRank: 1, status: "completed" }),
  ];
  const values = [...activeQueuePositions(entries).values()].sort((x, y) => x - y);
  assert.deepEqual(values, [1, 2, 3]);
});

test("this module writes nothing and decides no lifecycle", () => {
  /* It reads the status the engine set. A status assignment here would be a
     second lifecycle implementation, which is how a queue and a task come to
     disagree about whether something is finished. */
  const src = readFileSync("lib/rules/tasks/activeQueue.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const call of ["setDoc(", "updateDoc(", "writeBatch(", "fetch(", "await "]) {
    assert.equal(src.includes(call), false, `it performs "${call}"`);
  }
  assert.equal(/status\s*=\s*["']/.test(src), false, "it assigns a status");
});

/* ── Edge cases from the priority review ──────────────────────────────────── */

test("rework never leaves the queue, so it cannot re-enter at the wrong place", () => {
  /* Case 4, and the reason it needs no repositioning rule at all. `in_review`
     and `in_progress` are BOTH active, and legacy maps `tl_rejected` /
     `ceo_rejected` back to `in_progress` — so a task sent back for rework was
     never out of the queue and keeps the position it already held. Nothing
     jumps to P1 on a rejection. */
  const before = activeQueuePositions([
    entry({ taskId: "A", storedRank: 1 }),
    entry({ taskId: "B", storedRank: 2, status: "in_review" }),
    entry({ taskId: "C", storedRank: 3 }),
  ]);
  const afterRework = activeQueuePositions([
    entry({ taskId: "A", storedRank: 1 }),
    entry({ taskId: "B", storedRank: 2, status: "in_progress" }),
    entry({ taskId: "C", storedRank: 3 }),
  ]);
  assert.deepEqual([...before.entries()], [...afterRework.entries()]);
});

test("a genuinely reopened task re-enters at its old stored rank", () => {
  /* Case 4's other half, stated so the behaviour is a decision and not an
     accident: a task that reached `completed` and came back carries the rank it
     had, so it lands where it was rather than at the end. That is the same rule
     as everywhere else — stored rank orders, position is derived — and a
     manager who wants it elsewhere moves it. */
  const p = activeQueuePositions([
    entry({ taskId: "reopened", storedRank: 1 }),
    entry({ taskId: "current", storedRank: 2 }),
  ]);
  assert.equal(p.get("reopened"), 1);
});

test("the same queue derives identically however the caller found it", () => {
  /* Case 5 at the rules level: two people looking at one employee's queue get
     the same numbers because the derivation depends only on the entries, not on
     who asked. Case 3 too — the order survives being shuffled. */
  const entries = [
    entry({ taskId: "T569", storedRank: 2, createdAtMs: 3 }),
    entry({ taskId: "T587", storedRank: 2, createdAtMs: 4 }),
    entry({ taskId: "T588", storedRank: 3, createdAtMs: 5 }),
    entry({ taskId: "T620", storedRank: 5, createdAtMs: 6 }),
    entry({ taskId: "T626", storedRank: 5, createdAtMs: 7 }),
  ];
  const asEmployee = activeQueuePositions(entries);
  const asManager = activeQueuePositions([...entries].reverse());
  const afterRefresh = activeQueuePositions([entries[3], entries[0], entries[4], entries[2], entries[1]]);
  assert.deepEqual([...asEmployee.entries()].sort(), [...asManager.entries()].sort());
  assert.deepEqual([...asEmployee.entries()].sort(), [...afterRefresh.entries()].sort());
  /* And the duplicates resolve by age, which is a stored field — never by
     arrival order, which is not. */
  assert.equal(asEmployee.get("T569"), 1);
  assert.equal(asEmployee.get("T587"), 2);
});

test("every tie-break is a stored field, so nothing depends on the session", () => {
  /* Case 3. `order` and `createdAtMs` are written to the document; the final
     fallback is the task id. None of them can differ between two browsers. */
  /* The sort moved to `priorityQueue.ts`, which is now the single expression of
     what is in a queue and in what order — `activeQueuePositions` delegates. */
  /* Comments STRIPPED first. `assignPriorityRanks`'s own doc comment explains
     that it "numbers by index" — prose about why the result is continuous, which
     a raw-text search reads as an index-based tie-break. Third time a comment has
     tripped one of these; the convention is `code()` for a reason. */
  const src = readFileSync("lib/rules/tasks/priorityQueue.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const sort = src.slice(
    src.indexOf("export function calculatePriorityOrder("),
    src.indexOf("export function assignPriorityRanks("),
  );
  for (const volatile of ["Date.now", "Math.random", "indexOf", "index"]) {
    assert.equal(sort.includes(volatile), false, `tie-break uses "${volatile}"`);
  }
  for (const stable of ["storedRank", "order", "createdAtMs", "taskId"]) {
    assert.ok(sort.includes(stable), `tie-break ignores "${stable}"`);
  }
});

test("a new task at the bottom does not disturb the tasks above it", () => {
  /* Case 2. The engine ranks a forwarded task `open count + 1`, so it arrives
     last; nothing above it is rewritten and the derived numbers are unchanged. */
  const before = activeQueuePositions([
    entry({ taskId: "A", storedRank: 1 }),
    entry({ taskId: "B", storedRank: 2 }),
  ]);
  const after = activeQueuePositions([
    entry({ taskId: "A", storedRank: 1 }),
    entry({ taskId: "B", storedRank: 2 }),
    entry({ taskId: "NEW", storedRank: 3 }),
  ]);
  assert.equal(before.get("A"), after.get("A"));
  assert.equal(before.get("B"), after.get("B"));
  assert.equal(after.get("NEW"), 3);
});

/* ── Where a new task enters ──────────────────────────────────────────────── */

test("an employee with no tasks gets P1", () => {
  assert.equal(nextActiveRank([]), 1);
});

test("an employee holding P1, P2, P3 gets P4", () => {
  assert.equal(
    nextActiveRank([
      entry({ taskId: "a", storedRank: 1 }),
      entry({ taskId: "b", storedRank: 2 }),
      entry({ taskId: "c", storedRank: 3 }),
    ]),
    4,
  );
});

test("closed tasks are ignored, and the new task shows as P2", () => {
  /* The requested case: P1 and P2 are completed, P3 is active. The new task
     stores rank 4 — one above the highest ACTIVE rank — and DISPLAYS as P2,
     because only two tasks are in play. Stored and displayed differ by design;
     that separation is the whole system. */
  const existing = [
    entry({ taskId: "done1", storedRank: 1, status: "completed" }),
    entry({ taskId: "done2", storedRank: 2, status: "completed" }),
    entry({ taskId: "live", storedRank: 3 }),
  ];
  const rank = nextActiveRank(existing);
  assert.equal(rank, 4, "closed ranks must not push the new task down");

  const positions = activeQueuePositions([
    ...existing,
    entry({ taskId: "new", storedRank: rank }),
  ]);
  assert.equal(positions.get("live"), 1);
  assert.equal(positions.get("new"), 2);
  assert.equal(positions.size, 2);
});

test("a gapped queue does not put the new task in the middle", () => {
  /* The engine's count+1 gives 4 here, which lands ABOVE every existing task.
     This is the defect the rule exists to fix. */
  const existing = [
    entry({ taskId: "a", storedRank: 5 }),
    entry({ taskId: "b", storedRank: 6 }),
    entry({ taskId: "c", storedRank: 7 }),
  ];
  const rank = nextActiveRank(existing);
  assert.equal(rank, 8);
  const positions = activeQueuePositions([...existing, entry({ taskId: "new", storedRank: rank })]);
  assert.equal(positions.get("new"), 4, "the new task must be last");
});

test("two assignees on one task get independent positions", () => {
  /* Each queue is computed from that person's own tasks, so the same new task
     is P4 for a busy assignee and P1 for somebody with nothing. */
  const busy = [
    entry({ taskId: "x", storedRank: 1 }),
    entry({ taskId: "y", storedRank: 2 }),
    entry({ taskId: "z", storedRank: 3 }),
  ];
  assert.equal(nextActiveRank(busy), 4);
  assert.equal(nextActiveRank([]), 1);
  /* And neither computation can see the other's tasks. */
  assert.equal(nextActiveRank(busy), 4, "one queue changed the other");
});

test("a full queue clamps rather than producing a rank outside the scale", () => {
  /* 11 is not a rank — the display layer treats anything outside 1..10 as
     unranked, so an eleventh task would render with no priority at all. */
  const full = Array.from({ length: 10 }, (_, i) =>
    entry({ taskId: `t${i}`, storedRank: i + 1 }),
  );
  assert.equal(nextActiveRank(full), 10);
  const positions = activeQueuePositions([
    ...full,
    entry({ taskId: "new", storedRank: 10, createdAtMs: 9e12 }),
  ]);
  assert.equal(positions.get("new"), 11, "the newer of two 10s still sorts last");
});

test("an unranked existing task does not become rank zero", () => {
  /* `storedRank: null` means never written. Treating it as 0 would make the
     next task rank 1 and put it at the top. */
  assert.equal(
    nextActiveRank([
      entry({ taskId: "unranked", storedRank: null }),
      entry({ taskId: "ranked", storedRank: 3 }),
    ]),
    4,
  );
});

/* ── A budget must be settled before a task takes a slot ──────────────────── */

test("a task awaiting budget acceptance holds no priority slot", () => {
  /* The reported bug. `open` and `pending_deadline_approval` both map to
     `assigned`, which is an active status — so a task nobody had agreed the
     hours for sat in the queue ahead of work that was ready, and pushed
     everything below it down a place. */
  const p = activeQueuePositions([
    entry({ taskId: "A", storedRank: 5, budgetState: "WAITING_FOR_ASSIGNEE" }),
    entry({ taskId: "B", storedRank: 6, budgetState: "ACCEPTED" }),
  ]);
  assert.equal(p.has("A"), false, "an unagreed budget took a slot");
  assert.equal(p.get("B"), 1, "the ready task should lead");
});

test("the scenario in full: accepting a budget moves the task ahead", () => {
  /* P5 waiting, P6 working. Once P5's budget is agreed it takes its rightful
     place ABOVE P6, because the stored rank always ordered them — it was only
     ever a question of whether P5 was in the queue at all. */
  const before = activeQueuePositions([
    entry({ taskId: "T1", storedRank: 5, budgetState: "WAITING_FOR_ASSIGNOR" }),
    entry({ taskId: "T2", storedRank: 6, budgetState: "ACCEPTED" }),
  ]);
  assert.equal(before.get("T2"), 1);
  assert.equal(before.has("T1"), false);

  const after = activeQueuePositions([
    entry({ taskId: "T1", storedRank: 5, budgetState: "ACCEPTED" }),
    entry({ taskId: "T2", storedRank: 6, budgetState: "ACCEPTED" }),
  ]);
  assert.equal(after.get("T1"), 1);
  assert.equal(after.get("T2"), 2);
});

test("every unsettled state is kept out, not just the first", () => {
  for (const state of [
    "WAITING_FOR_ASSIGNEE",
    "WAITING_FOR_ASSIGNOR",
    "SOMETHING_ELSE",
  ]) {
    const p = activeQueuePositions([
      entry({ taskId: "x", storedRank: 1, budgetState: state }),
      entry({ taskId: "ready", storedRank: 9, budgetState: "ACCEPTED" }),
    ]);
    assert.equal(p.has("x"), false, `${state} took a slot`);
    assert.equal(p.get("ready"), 1);
  }
});

test("a task with no budget to settle is active immediately", () => {
  /* A fixed-deadline task has no negotiation. Requiring an acceptance that can
     never come would empty the queue for everybody on that model. */
  for (const state of [null, undefined]) {
    const p = activeQueuePositions([
      entry({ taskId: "fixed", storedRank: 2, budgetState: state }),
    ]);
    assert.equal(p.get("fixed"), 1);
  }
});

test("a negotiating task cannot block the one behind it", () => {
  /* Two tasks, the better-ranked one still being argued about. The other must
     not be held at P2 waiting for a conversation it is not part of. */
  const p = activeQueuePositions([
    entry({ taskId: "arguing", storedRank: 1, budgetState: "WAITING_FOR_ASSIGNOR" }),
    entry({ taskId: "ready", storedRank: 2, budgetState: "ACCEPTED" }),
  ]);
  assert.equal(p.get("ready"), 1);
  assert.equal(p.size, 1);
});

test("completing an active task still exposes the one below it", () => {
  /* The original compaction, unchanged by the budget rule. */
  const p = activeQueuePositions([
    entry({ taskId: "p5", storedRank: 5, status: "completed", budgetState: "ACCEPTED" }),
    entry({ taskId: "p6", storedRank: 6, budgetState: "ACCEPTED" }),
  ]);
  assert.equal(p.get("p6"), 1);
});

test("a new task's rank ignores tasks that are still negotiating", () => {
  /* Otherwise a task nobody has agreed the hours for inflates the next rank
     and leaves a gap that never closes. */
  assert.equal(
    nextActiveRank([
      entry({ taskId: "a", storedRank: 1, budgetState: "ACCEPTED" }),
      entry({ taskId: "b", storedRank: 8, budgetState: "WAITING_FOR_ASSIGNEE" }),
    ]),
    2,
  );
});

test("an unsettled task reports no live rank but keeps its stored one", () => {
  /* It is real work with a real priority — just not yet in the running order. */
  const e = entry({ taskId: "w", storedRank: 5, budgetState: "WAITING_FOR_ASSIGNEE" });
  const r = queueRankFor(e, activeQueuePositions([e]));
  assert.equal(r.activeRank, null);
  assert.equal(r.storedRank, 5);
  assert.equal(r.isActive, false);
});

test("the same input always yields the same order", () => {
  /* Ordering must not depend on arrival, so a refresh cannot renumber. */
  const entries = [
    entry({ taskId: "a", storedRank: 5, budgetState: "ACCEPTED" }),
    entry({ taskId: "b", storedRank: 6, budgetState: "ACCEPTED" }),
    entry({ taskId: "c", storedRank: 1, budgetState: "WAITING_FOR_ASSIGNEE" }),
  ];
  const one = activeQueuePositions(entries);
  const two = activeQueuePositions([...entries].reverse());
  assert.deepEqual([...one.entries()].sort(), [...two.entries()].sort());
});

/* ── One rule for workload, counters and ordering ─────────────────────────── */

test("the shared predicate needs BOTH halves", () => {
  /* Taking the view rather than loose fields is deliberate: a caller cannot
     pass one and forget the other, which is how "status !== completed" became
     several separate definitions of active across the product. */
  const live = { task: { status: "in_progress" } };
  assert.equal(isActivePriorityTask(live), true);
  assert.equal(
    isActivePriorityTask({ ...live, budgetNegotiation: { state: "ACCEPTED" } }),
    true,
  );
  assert.equal(
    isActivePriorityTask({
      ...live,
      budgetNegotiation: { state: "WAITING_FOR_ASSIGNEE" },
    }),
    false,
  );
  assert.equal(isActivePriorityTask({ task: { status: "completed" } }), false);
});

test("workload and the priority queue agree by construction", () => {
  /* They read the same predicate, so a person's task count and their queue
     length cannot disagree — which they did while each surface defined
     "active" for itself. */
  const entries = [
    { taskId: "a", status: "in_progress", storedRank: 1, budgetState: "ACCEPTED" },
    { taskId: "b", status: "assigned", storedRank: 2, budgetState: "WAITING_FOR_ASSIGNEE" },
    { taskId: "c", status: "completed", storedRank: 3, budgetState: "ACCEPTED" },
  ];
  const queued = activeQueuePositions(entries).size;
  const counted = entries.filter((e) =>
    isActivePriorityTask({
      task: { status: e.status },
      budgetNegotiation: e.budgetState ? { state: e.budgetState } : null,
    }),
  ).length;
  assert.equal(queued, counted);
  assert.equal(queued, 1);
});

test("a pending-budget task contributes no hours to a workload total", () => {
  /* Belt and braces on top of the predicate: such a task cannot run a timer
     either — `TimerControl` offers itself only for `confirmed` or
     `in_progress`, and a budget-pending task is `assigned` — so its logged
     time is structurally zero. */
  const timer = readFileSync("components/features/tasks/TimerControl.tsx", "utf8");
  assert.match(
    timer,
    /view\.task\.status === "in_progress" \|\| needsStart/,
  );
  assert.match(timer, /needsStart = view\.task\.status === "confirmed"/);
});
