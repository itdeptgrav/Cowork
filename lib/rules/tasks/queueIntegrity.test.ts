import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { activeQueuePositions } from "./activeQueue.ts";
import { displayPriority } from "./priority.ts";
import {
  assignPriorityRanks,
  describeQueueFault,
  normalizePriorityQueue,
} from "./priorityQueue.ts";

/**
 * The three reported symptoms, reproduced before anything is changed.
 *
 * *"Users can have duplicate P1/P2/P3, completed tasks still show priority, and
 * the ordering is no longer a valid queue."*
 *
 * Written to FAIL first. Each one has to be pinned to a specific read, because
 * the derivation and the stored data disagree — and which of the two a screen
 * shows depends on whose queue the request fetched.
 */

const PRAMOD = "GR0067";
const RAKESH = "GR0045";

/* ── The derivation is already sound ─────────────────────────────────────── */

test("the DERIVED positions are unique and continuous even from bad stored data", () => {
  /* Worth establishing first, because it bounds the bug: `activeQueuePositions`
     numbers by array index, so duplicates and gaps in the stored ranks cannot
     survive it. Whatever is broken is not this. */
  const positions = activeQueuePositions([
    { taskId: "a", status: "in_progress", storedRank: 1 },
    { taskId: "b", status: "in_progress", storedRank: 1 }, // duplicate
    { taskId: "c", status: "in_progress", storedRank: 3 }, // gap
    { taskId: "d", status: "in_progress", storedRank: 5 }, // gap
  ]);
  assert.deepEqual(
    [...positions.values()].sort((x, y) => x - y),
    [1, 2, 3, 4],
    "the derivation must always produce 1..N with no gaps or repeats",
  );
});

/* ── Symptom 1 · duplicates and gaps DO reach a screen ───────────────────── */

test("normalising removes the duplicates and gaps a non-owner would read", () => {
  /* THE REPORTED SYMPTOM, and where it actually comes from.
   *
   * A list read fetches only the VIEWER's queue, so every other person's
   * `queuePosition` is null and `displayPriority` falls back to their STORED
   * rank — which legacy wrote per assignee independently (`open count + 1`,
   * computed before the sibling existed) and which nothing normalised.
   *
   * The derivation cannot produce a duplicate; the stored data can. So the fix is
   * to make the stored data satisfy the rule, which is what
   * `normalizePriorityQueue` does. */
  const candidates = [
    { taskId: "a", status: "in_progress", storedRank: 1 },
    { taskId: "b", status: "in_progress", storedRank: 1 }, // duplicate
    { taskId: "c", status: "in_progress", storedRank: 3 }, // gap at 2
    { taskId: "d", status: "in_progress", storedRank: 5 }, // gap at 4
  ];

  const queue = normalizePriorityQueue(candidates);
  assert.equal(queue.isNormal, false);
  assert.deepEqual(queue.duplicates, [1], "the duplicate is diagnosed");
  assert.deepEqual(queue.gaps, [2, 4], "the gaps are diagnosed");

  /* And the repaired ranks are 1..N, unique and continuous. */
  assert.deepEqual([...queue.ranks.values()].sort((x, y) => x - y), [1, 2, 3, 4]);

  /* Which is what a non-owner then reads — one number per task, no repeats. */
  const shown = queue.order.map((taskId) =>
    displayPriority({
      status: "in_progress",
      viewerId: RAKESH,
      holders: [
        {
          employeeId: PRAMOD,
          rank: queue.ranks.get(taskId) ?? null,
          queuePosition: null,
        },
      ],
    }).rank,
  );
  assert.deepEqual(shown, [1, 2, 3, 4]);
  assert.equal(new Set(shown).size, shown.length);

  /* Idempotent: normalising the repaired queue is zero further writes. Load-
     bearing, because this runs after every priority write — a sort that was not
     total would churn the queue on each call. */
  const again = normalizePriorityQueue(
    candidates.map((c) => ({ ...c, storedRank: queue.ranks.get(c.taskId) ?? null })),
  );
  assert.equal(again.isNormal, true);
  assert.equal(again.changes.length, 0);
});

test("the fault is described rather than silently repaired", () => {
  /* Somebody whose ranks were duplicated has not done anything wrong, so the
     sentence says what happened rather than asking them to fix it. */
  const queue = normalizePriorityQueue([
    { taskId: "a", status: "in_progress", storedRank: 1 },
    { taskId: "b", status: "in_progress", storedRank: 1 },
    { taskId: "c", status: "in_progress", storedRank: 4 },
  ]);
  const fault = describeQueueFault(queue);
  assert.match(fault ?? "", /P1 held by more than one task/);
  assert.match(fault ?? "", /nothing at P2, P3/);
  /* And a healthy queue says nothing at all. */
  assert.equal(
    describeQueueFault(
      normalizePriorityQueue([
        { taskId: "a", status: "in_progress", storedRank: 1 },
        { taskId: "b", status: "in_progress", storedRank: 2 },
      ]),
    ),
    null,
  );
});

/* ── Symptom 2 · "not yet accepted" consumes a slot ──────────────────────── */

test("REPRO: a task the assignee has not accepted holds a priority slot", () => {
  /* `assigned` IS the awaiting-acceptance state — session 5 established that.
     It is currently in `ACTIVE_STATUSES`, so work nobody has taken on pushes
     accepted work down a place. The rule is that priority belongs to active
     workload, and unaccepted work is not yet workload. */
  const positions = activeQueuePositions([
    { taskId: "unaccepted", status: "assigned", storedRank: 1 },
    { taskId: "working", status: "in_progress", storedRank: 2 },
  ]);
  assert.equal(
    positions.has("unaccepted"),
    false,
    "an unaccepted task holds a queue slot",
  );
  assert.equal(
    positions.get("working"),
    1,
    "accepted work is pushed down by work nobody has taken on",
  );
});

/* ── Symptom 3 · the stored data itself violates the invariant ───────────── */

test("inactive work never consumes a slot, at any status", () => {
  /* The whole exclusion list, asserted rather than implied. Each of these has
     held a slot at some point and pushed live work down a place. */
  const inactive = [
    { taskId: "done", status: "completed" },
    { taskId: "killed", status: "cancelled" },
    { taskId: "refused", status: "assignment_rejected" },
    { taskId: "gate", status: "pending_approval" },
    { taskId: "unissued", status: "draft" },
  ];
  const queue = normalizePriorityQueue([
    ...inactive.map((t) => ({ ...t, storedRank: 1 })),
    { taskId: "live", status: "in_progress", storedRank: 9 },
  ]);

  assert.deepEqual(queue.order, ["live"]);
  assert.deepEqual([...queue.ranks.entries()], [["live", 1]]);
  for (const t of inactive) {
    assert.equal(
      queue.ranks.has(t.taskId),
      false,
      `${t.status} consumed a priority slot`,
    );
  }
  /* And an inactive task is never renumbered — a completed task keeps the rank
     it finished with, because it is a record and renders as "was P1". */
  for (const t of inactive) {
    assert.equal(
      queue.changes.some((c) => c.taskId === t.taskId),
      false,
      `${t.status} was renumbered`,
    );
  }
});

test("an unsettled budget holds no slot either", () => {
  const queue = normalizePriorityQueue([
    {
      taskId: "haggling",
      status: "assigned",
      storedRank: 1,
      accepted: true,
      budgetState: "WAITING_FOR_ASSIGNOR",
    },
    { taskId: "ready", status: "in_progress", storedRank: 2 },
  ]);
  assert.deepEqual(queue.order, ["ready"]);
});

test("eight active tasks are P1 through P8 with nothing missing", () => {
  /* The rule as the brief states it. Deliberately more than the five a small
     fixture would use, because the interesting case is a queue long enough for a
     gap to hide in. */
  const queue = normalizePriorityQueue(
    Array.from({ length: 8 }, (_, i) => ({
      taskId: `t${i}`,
      status: "in_progress",
      /* Deliberately awful input: all the same rank, so only the tie-breaks
         decide the order and the ranks must still come out continuous. */
      storedRank: 1,
      createdAtMs: 1000 + i,
    })),
  );
  assert.deepEqual(
    [...queue.ranks.values()].sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  /* And the order follows the tie-break: oldest first. */
  assert.deepEqual(queue.order, ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7"]);
});

test("a queue longer than ten is continuous in the derivation", () => {
  /* `assignPriorityRanks` is deliberately NOT clamped to the 1–10 scale: a person
     with twelve active tasks has a twelfth position, and clamping would put two
     tasks at 10.
     
     ⚠ The STORED rank is a different matter — it is legacy's 1–10 field, read by
     the old app, so `normalizePriorities` clamps the write and the tail
     duplicates there. That limit is real and is recorded in HANDOFF; it is
     invisible to the queue owner, who sees the derived position. */
  const ranks = assignPriorityRanks(
    Array.from({ length: 12 }, (_, i) => `t${i}`),
  );
  assert.deepEqual(
    [...ranks.values()],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
});

test("both repositories normalise through the one function", () => {
  for (const path of [
    "lib/repositories/legacy/index.ts",
    "lib/repositories/mock/index.ts",
  ]) {
    const src = readFile(path);
    const at = src.indexOf("async normalizePriorities(");
    assert.ok(at > 0, `${path} has no normalizePriorities`);
    /* The mock's normaliser sits after its `#renumber` funnel now, so the window
       has to reach past it. */
    const body = src.slice(at, at + 4000);
    assert.match(
      body,
      /normalizePriorityQueue\(/,
      `${path} renumbers without the shared rule`,
    );
    /* Idempotence is a property of the rule, and both must honour it rather than
       writing unconditionally. */
    assert.match(body, /queue\.isNormal/);
  }

  /* And the legacy write uses DOT NOTATION. Writing `assigneePriorities` whole
     would erase every other assignee's rank — the document shape IS the contract,
     because priority has no REST route. */
  const legacy = readFile("lib/repositories/legacy/index.ts");
  /* Bounded by the NEXT method rather than by a character count — the previous
     3000-char window stopped short of the write once the concurrency note was
     added above it, which is the drift these bounds keep running into. */
  const at = legacy.indexOf("async normalizePriorities(");
  const body = legacy.slice(
    at,
    legacy.indexOf("async normalizePrioritiesAllUsers(", at),
  );
  assert.ok(body.length > 0, "the slice anchors no longer match");
  assert.match(body, /\[`assigneePriorities\.\$\{id\}`\]/);
});

test("the derivation and the normaliser cannot disagree", () => {
  /* `activeQueuePositions` delegates, so the reader and the writer are one
     expression of the rule. Before this they were two, which is how a queue could
     read as 1..N and store 1, 1, 3, 5. */
  const src = readFile("lib/rules/tasks/activeQueue.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.match(src, /assignPriorityRanks\(calculatePriorityOrder\(entries\)\)/);
  /* The filter and sort no longer live here. */
  assert.equal(/active\.sort\(/.test(src), false);
});

/** Source, for the assertions that pin where a rule lives. */
function readFile(p: string): string {
  return readFileSync(p, "utf8");
}
