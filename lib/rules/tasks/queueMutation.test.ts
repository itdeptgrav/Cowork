import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  normalizePriorityQueue,
  type QueueCandidate,
} from "./priorityQueue.ts";

/**
 * **The invariant survives every mutation path**, not just the read.
 *
 * The queue was made correct on read last session. This one closes the writes:
 * nothing that can disturb an ordering may leave it invalid, and no caller has
 * to remember to say so.
 *
 * The behavioural half is driven through `normalizePriorityQueue` — the function
 * both repositories call — and the wiring half is asserted on source, because
 * "every mutation path calls it" is a claim about the code rather than about one
 * calculation.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
const raw = (p: string) => readFileSync(p, "utf8");

const LEGACY = "lib/repositories/legacy/index.ts";
const MOCK = "lib/repositories/mock/index.ts";

/** A person's queue, as stored. */
const q = (...ranks: (number | null)[]): QueueCandidate[] =>
  ranks.map((storedRank, i) => ({
    taskId: `t${i}`,
    status: "in_progress",
    storedRank,
    createdAtMs: 1000 + i,
  }));

/* ── 1/2 · Priority mutations normalise ──────────────────────────────────── */

test("1 · changing a priority normalises the queue", () => {
  /* Both paths through `changePriority`: the reorder branch, and the single-task
     branch that writes one rank directly. The second is the one that could store
     P7 on a one-task queue and leave nothing at 1..6. */
  const src = code(LEGACY);
  const at = src.indexOf("async changePriority(");
  const body = src.slice(at, src.indexOf("async #recalculateQueueDeadlines", at));
  assert.ok(body.length > 0, "the slice anchors no longer match");
  assert.match(
    body,
    /await this\.normalizePriorities\(employeeId as EmployeeId\)/,
    "the single-rank branch does not normalise",
  );
  /* And the reorder branch normalises via `reorderPriorities`, which does its
     own — asserted separately below. */
  assert.match(body, /await this\.reorderPriorities\(/);

  const mock = code(MOCK);
  const mockAt = mock.indexOf("async changePriority(");
  assert.match(
    mock.slice(mockAt, mock.indexOf("#renumber(employeeIds", mockAt)),
    /this\.#renumber\(\[String\(input\.employeeId\)\]\)/,
  );
});

test("2 · reordering normalises the queue", () => {
  const src = code(LEGACY);
  const at = src.indexOf("async reorderPriorities(");
  const body = src.slice(at, at + 2500);
  assert.match(body, /await this\.normalizePriorities\(employeeId\)/);
  /* BEFORE the re-schedule: the dates are chained in queue order, and chaining a
     queue that is about to be renumbered computes them twice. */
  assert.ok(
    body.indexOf("normalizePriorities") <
      body.indexOf("#recalculateQueueDeadlines"),
    "the queue is re-scheduled before it is renumbered",
  );
});

/* ── 3/4/5/6/7 · The lifecycle paths ─────────────────────────────────────── */

test("3 · completing a task shifts the rest up", () => {
  /* P2 completes. The stored ranks of the survivors are renumbered so nothing is
     left at 2, and the completed task keeps what it finished with. */
  const before: QueueCandidate[] = [
    { taskId: "a", status: "in_progress", storedRank: 1 },
    { taskId: "b", status: "completed", storedRank: 2 },
    { taskId: "c", status: "in_progress", storedRank: 3 },
  ];
  const queue = normalizePriorityQueue(before);
  assert.deepEqual([...queue.ranks.entries()], [["a", 1], ["c", 2]]);
  assert.equal(queue.ranks.has("b"), false);
  assert.equal(
    queue.changes.some((ch) => ch.taskId === "b"),
    false,
    "the completed task was renumbered",
  );
});

test("4 · a newly assigned task lands on a continuous queue", () => {
  /* A new task arrives at the back with whatever rank the engine gave it —
     `open count + 1`, which collides the moment the queue has a gap. Normalising
     makes the result continuous regardless of what it arrived carrying. */
  const queue = normalizePriorityQueue([
    { taskId: "a", status: "in_progress", storedRank: 1 },
    { taskId: "b", status: "in_progress", storedRank: 3 },
    /* The engine counted 2 open tasks and stored 3 — colliding with `b`. */
    { taskId: "new", status: "in_progress", storedRank: 3 },
  ]);
  assert.deepEqual([...queue.ranks.values()].sort((x, y) => x - y), [1, 2, 3]);
  assert.equal(new Set(queue.ranks.values()).size, 3);
});

test("5 · reassignment repairs BOTH queues", () => {
  /* The one thing the write funnel cannot work out for itself: after the write
     the read-back names the NEW holders, and the person who lost the work is gone
     from the document — but their queue still has a gap where the task was.

     So `#write` takes their ids, and `#normalizeAfterWrite` unions them with the
     current holders. */
  const src = code(LEGACY);
  assert.match(src, /priorHolders: string\[\] = \[\]/);
  const at = src.indexOf("async #normalizeAfterWrite(");
  const body = src.slice(at, src.indexOf("async #readTaskView(", at));
  assert.match(body, /priorHolders\.filter\(Boolean\)/);
  assert.match(body, /view\.assignments/);
  assert.match(body, /view\.pendingAssignees/);
  /* Each queue independently — a rank is per person, so one person's move cannot
     renumber somebody else's day. */
  assert.match(body, /for \(const employeeId of affected\)/);

  /* And the calculation itself: the loser's queue closes its gap, the gainer's
     makes room. */
  const loser = normalizePriorityQueue([
    { taskId: "kept", status: "in_progress", storedRank: 1 },
    /* `moved` is gone from their assignments entirely. */
    { taskId: "other", status: "in_progress", storedRank: 3 },
  ]);
  assert.deepEqual([...loser.ranks.entries()], [["kept", 1], ["other", 2]]);

  const gainer = normalizePriorityQueue([
    { taskId: "theirs", status: "in_progress", storedRank: 1 },
    { taskId: "moved", status: "in_progress", storedRank: 1 },
  ]);
  assert.deepEqual([...gainer.ranks.values()].sort((x, y) => x - y), [1, 2]);
});

test("6 · duplicates cannot be produced through a mutation API", () => {
  /* Whatever a caller asks for, the persisted result is 1..N. Driven over a range
     of hostile inputs rather than one, because a single case can pass by luck. */
  for (const ranks of [
    [1, 1, 1],
    [5, 5, 5, 5],
    [null, null, null],
    [10, 1, 10, 1],
    [3, 3, 1, 2, 2],
  ]) {
    const queue = normalizePriorityQueue(q(...ranks));
    const values = [...queue.ranks.values()].sort((x, y) => x - y);
    assert.deepEqual(
      values,
      ranks.map((_, i) => i + 1),
      `${JSON.stringify(ranks)} produced ${JSON.stringify(values)}`,
    );
    assert.equal(new Set(values).size, values.length);
  }
});

test("7 · completed tasks are never modified", () => {
  /* Not by the per-user normaliser, and not by the all-users repair. A closed
     task's rank is the only priority record that survives — nothing persists a
     per-change history — so rewriting it would destroy the "was P3" it renders. */
  const queue = normalizePriorityQueue([
    { taskId: "done", status: "completed", storedRank: 1 },
    { taskId: "killed", status: "cancelled", storedRank: 2 },
    { taskId: "live", status: "in_progress", storedRank: 7 },
  ]);
  assert.deepEqual(
    queue.changes.map((c) => c.taskId),
    ["live"],
    "an inactive task was included in the writes",
  );

  /* And the all-users repair writes only `queue.changes`, so the same holds. */
  const src = code(LEGACY);
  const at = src.indexOf("async normalizePrioritiesAllUsers(");
  const body = src.slice(at, src.indexOf("async reorderPriorities(", at));
  assert.match(body, /for \(const change of queue\.changes\)/);
  assert.equal(
    /status.*=.*"completed"|batch\.update\(doc\(db, "cowork_tasks", t\.id\)/.test(body),
    false,
    "the repair reaches beyond the active changes",
  );
});

test("8 · normalising twice is zero further changes", () => {
  /* Load-bearing, because normalisation now runs after EVERY mutation. A sort
     that was not total would renumber differently on each call and write every
     time — turning a repair into churn. */
  for (const ranks of [[1, 1, 3, 5], [9, 2, 2], [null, 1]]) {
    const first = normalizePriorityQueue(q(...ranks));
    const second = normalizePriorityQueue(
      q(...ranks).map((c) => ({ ...c, storedRank: first.ranks.get(c.taskId) ?? null })),
    );
    assert.equal(second.isNormal, true, `${JSON.stringify(ranks)} did not settle`);
    assert.equal(second.changes.length, 0);
    /* And a third time, to catch a two-cycle. */
    const third = normalizePriorityQueue(
      q(...ranks).map((c) => ({ ...c, storedRank: second.ranks.get(c.taskId) ?? null })),
    );
    assert.deepEqual([...third.ranks.entries()], [...second.ranks.entries()]);
  }
});

test("9 · concurrent mutations cannot leave an invalid queue", () => {
  /* **What the guarantee is, and what it is not.**
   *
   * A client-side Firestore transaction cannot run a QUERY, so a queue read with
   * `where(...)` cannot be read and written atomically. What makes the race safe
   * is the shape of the calculation: `calculatePriorityOrder` is a TOTAL sort over
   * stored fields, so two normalisations of the same data converge on the same
   * answer.
   *
   * So the invariant survives any interleaving. What a race can cost is ORDERING
   * INTENT — a normalise computed one write behind persists the older order, and
   * the next mutation's normalise corrects it. Last-writer-wins on the order;
   * never-invalid on the shape. */
  const start = q(1, 1, 3, 5);

  /* Two concurrent readers see the same stored state and each compute a repair. */
  const a = normalizePriorityQueue(start);
  const b = normalizePriorityQueue(start);
  assert.deepEqual([...a.ranks.entries()], [...b.ranks.entries()], "the sort is not total");

  /* Whichever commits last, the result is valid. */
  for (const winner of [a, b]) {
    const values = [...winner.ranks.values()].sort((x, y) => x - y);
    assert.deepEqual(values, [1, 2, 3, 4]);
  }

  /* And an interleaving where one lands on top of the other's result still
     converges rather than oscillating. */
  const afterA = start.map((c) => ({ ...c, storedRank: a.ranks.get(c.taskId) ?? null }));
  const bOnTopOfA = normalizePriorityQueue(afterA);
  assert.equal(bOnTopOfA.isNormal, true);
  assert.equal(bOnTopOfA.changes.length, 0);

  /* The reasoning is recorded where the write happens, not only here. */
  assert.match(raw(LEGACY), /the ordering is\s*\n?\s*\* last-writer-wins/);
});

/* ── The funnel · no caller has to remember ──────────────────────────────── */

test("every lifecycle mutation normalises, because the funnel does", () => {
  /* `#write` is the single funnel for the task lifecycle — 22 call sites,
     including acceptance, completion, review, budget changes and creation. A
     normalise bolted onto each is 22 chances to forget, and the forgotten one is
     where duplicates come back. */
  const src = code(LEGACY);
  const at = src.indexOf("async #write<T>(");
  const body = src.slice(at, src.indexOf("async #normalizeAfterWrite(", at));
  assert.ok(body.length > 0, "the slice anchors no longer match");
  assert.match(body, /await this\.#normalizeAfterWrite\(view, priorHolders\)/);

  /* AFTER the read-back, never before — normalisation is a consequence of a
     change that has already landed. */
  assert.ok(
    body.indexOf("#readTaskView(taskId)") < body.indexOf("#normalizeAfterWrite"),
    "the queue is renumbered before the write is confirmed",
  );

  /* Enough call sites that the funnel is genuinely the coverage. */
  const sites = (src.match(/this\.#write\(/g) ?? []).length;
  assert.ok(sites >= 20, `expected the funnel to cover the lifecycle, found ${sites}`);
});

test("normalisation never runs during a read", () => {
  /* The race the brief rules out: render → write → normalise. Every call sits in
     a mutation, so no read path may reach it. */
  const src = code(LEGACY);
  for (const reader of [
    "async listTasks(",
    "async #readTaskView(",
    "async #activeQueueOf(",
    "async getTask(",
  ]) {
    const at = src.indexOf(reader);
    if (at < 0) continue;
    const body = src.slice(at, src.indexOf("\n  async ", at + 10));
    assert.equal(
      /normalizePriorities|#renumber/.test(body),
      false,
      `${reader} normalises during a read`,
    );
  }
});

test("a failed renumber does not fail the mutation the caller asked for", () => {
  /* Their change HAS landed. Reporting it as failed would send them to do it
     again — and `normalizePriorities` is idempotent, so the next mutation closes
     the gap. */
  const src = code(LEGACY);
  const at = src.indexOf("async #normalizeAfterWrite(");
  const body = src.slice(at, src.indexOf("async #readTaskView(", at));
  assert.match(body, /catch \(error\)/);
  assert.match(body, /console\.error/);
  assert.equal(
    /return \{\s*ok: false/.test(body),
    false,
    "a renumbering failure surfaces as a failed mutation",
  );
});

/* ── The all-users repair ────────────────────────────────────────────────── */

test("the all-users repair is admin-only and reports what it changed", () => {
  const src = code(LEGACY);
  const at = src.indexOf("async normalizePrioritiesAllUsers(");
  const body = src.slice(at, src.indexOf("async reorderPriorities(", at));
  assert.match(body, /maySettings\(\{ archetype: this\.#ctx\.archetype \?\? null \}\)/);
  assert.match(body, /SETTINGS_REFUSAL/);
  /* Reports per user, so a repair is auditable rather than a bare count. */
  assert.match(body, /perUser/);
  assert.match(body, /scanned/);
  /* One batch per person: Firestore caps a batch at 500 writes, and a partial
     commit that renumbered half a queue would be worse than not running. */
  assert.match(body, /writeBatch\(db\)/);
  /* And one person's failure does not abandon the rest. */
  assert.match(body, /catch \(error\)/);

  /* `holdersOf`, so somebody behind a cross-department gate is repaired too —
     exactly the person whose queue nobody has been looking at. */
  assert.match(body, /holdersOf\(\{/);
});

test("both repositories expose the same repair surface", () => {
  for (const path of [LEGACY, MOCK]) {
    const src = code(path);
    assert.ok(
      src.includes("async normalizePriorities("),
      `${path} has no per-user repair`,
    );
    assert.ok(
      src.includes("async normalizePrioritiesAllUsers("),
      `${path} has no all-users repair`,
    );
  }
});
