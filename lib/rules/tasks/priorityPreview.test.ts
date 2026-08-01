import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diffQueues,
  isNoOpReorder,
  subjectOf,
  summariseDiff,
  type QueueSnapshotRow,
} from "./priorityPreview.ts";

const at = (hour: number): string =>
  new Date(Date.UTC(2026, 7, 3, hour, 0, 0)).toISOString();

const row = (
  taskId: string,
  rank: number,
  dueAt: string | null,
  title = taskId.toUpperCase(),
): QueueSnapshotRow => ({ taskId, title, rank, dueAt });

/* A queue of three, and the same three with `c` promoted to the front — the
   ordinary case the confirmation dialog exists for. */
const BEFORE = [row("a", 1, at(11)), row("b", 2, at(14)), row("c", 3, at(17))];
const AFTER = [row("c", 1, at(14)), row("a", 2, at(16)), row("b", 3, at(18))];

test("the table is ordered by where things end up, not where they were", () => {
  assert.deepEqual(
    diffQueues(BEFORE, AFTER).map((r) => r.taskId),
    ["c", "a", "b"],
  );
});

test("each row carries both ranks and both deadlines", () => {
  const [promoted] = diffQueues(BEFORE, AFTER);
  assert.equal(promoted.taskId, "c");
  assert.equal(promoted.previousRank, 3);
  assert.equal(promoted.newRank, 1);
  assert.equal(promoted.previousDueAt, at(17));
  assert.equal(promoted.newDueAt, at(14));
});

test("a deadline pulled earlier reports a negative shift, never zero", () => {
  /* The promoted task finishes SOONER. A signed figure is what lets one dialog
     say "3 hours earlier" instead of showing a bare date change and leaving the
     reader to subtract. */
  const [promoted] = diffQueues(BEFORE, AFTER);
  assert.equal(promoted.shiftedBySecs, -3 * 3600);
});

test("the tasks it displaced report the delay it cost them", () => {
  const rows = diffQueues(BEFORE, AFTER);
  const a = rows.find((r) => r.taskId === "a")!;
  const b = rows.find((r) => r.taskId === "b")!;
  assert.equal(a.shiftedBySecs, 5 * 3600);
  assert.equal(b.shiftedBySecs, 4 * 3600);
});

test("moved is about the position, and is independent of the date", () => {
  /* A task can keep its rank and still have its deadline move — everything
     ahead of it grew — and it can move rank with no dated commitment at all.
     Conflating the two is how "5 deadlines moved" gets said about a change that
     moved none. */
  const before = [row("a", 1, at(11)), row("b", 2, at(14))];
  const after = [row("a", 1, at(13)), row("b", 2, at(16))];
  const rows = diffQueues(before, after);
  assert.deepEqual(
    rows.map((r) => r.moved),
    [false, false],
  );
  assert.deepEqual(
    rows.map((r) => r.shiftedBySecs),
    [2 * 3600, 2 * 3600],
  );
});

test("an undated task reports no shift rather than NaN", () => {
  const rows = diffQueues([row("a", 1, null)], [row("a", 2, null)]);
  assert.equal(rows[0].shiftedBySecs, 0);
  assert.equal(rows[0].moved, true);
});

test("an unparseable stored date reports no shift rather than NaN", () => {
  const rows = diffQueues([row("a", 1, "not a date")], [row("a", 1, at(9))]);
  assert.equal(rows[0].shiftedBySecs, 0);
});

test("a task new to the queue has no previous rank and is not 'moved'", () => {
  const rows = diffQueues([row("a", 1, at(11))], [row("n", 1, at(11)), row("a", 2, at(14))]);
  const fresh = rows.find((r) => r.taskId === "n")!;
  assert.equal(fresh.previousRank, null);
  assert.equal(fresh.moved, false, "there is no position for it to have moved from");
});

test("a task that has left the queue keeps its previous rank and sorts last", () => {
  const rows = diffQueues(
    [row("a", 1, at(11)), row("gone", 2, at(14)), row("b", 3, at(17))],
    [row("a", 1, at(11)), row("b", 2, at(14))],
  );
  assert.deepEqual(
    rows.map((r) => r.taskId),
    ["a", "b", "gone"],
  );
  const gone = rows.find((r) => r.taskId === "gone")!;
  assert.equal(gone.newRank, null);
  assert.equal(gone.previousRank, 2);
});

test("a renamed task is shown under the name it now has", () => {
  const rows = diffQueues(
    [row("a", 1, at(11), "Old name")],
    [row("a", 1, at(11), "New name")],
  );
  assert.equal(rows[0].title, "New name");
});

test("an order that reads the same is a no-op, however it was arrived at", () => {
  assert.equal(isNoOpReorder(["a", "b", "c"], ["a", "b", "c"]), true);
  assert.equal(isNoOpReorder(["a", "b", "c"], ["a", "c", "b"]), false);
  assert.equal(isNoOpReorder(["a", "b"], ["a", "b", "c"]), false);
  assert.equal(isNoOpReorder([], []), true);
});

test("the summary counts positions and deadlines separately", () => {
  const summary = summariseDiff(diffQueues(BEFORE, AFTER));
  assert.equal(summary.moved, 3);
  assert.equal(summary.delayed, 2);
  assert.equal(summary.pulledEarlier, 1);
  assert.equal(summary.worstDelaySecs, 5 * 3600);
  assert.equal(summary.total, 3);
});

test("a swap at the top leaves everything below it untouched", () => {
  /* Four tasks of equal length; the top two exchange places. The chain below the
     swap is unchanged, so c and d report nothing — which is the reassurance a
     reader weighing the change is actually looking for, and the case
     `priorityCascade.ts` was rewritten over: the old code announced deadline
     moves for tasks nothing had displaced. */
  const before = [row("a", 1, at(11)), row("b", 2, at(14)), row("c", 3, at(17)), row("d", 4, at(20))];
  const after = [row("b", 1, at(11)), row("a", 2, at(14)), row("c", 3, at(17)), row("d", 4, at(20))];
  const rows = diffQueues(before, after);
  assert.equal(rows.find((r) => r.taskId === "c")!.shiftedBySecs, 0);
  assert.equal(rows.find((r) => r.taskId === "d")!.shiftedBySecs, 0);

  const summary = summariseDiff(rows);
  assert.equal(summary.moved, 2, "only the two that changed places");
  assert.equal(summary.delayed, 1);
  assert.equal(summary.pulledEarlier, 1);
});

test("the subject is the task that moved furthest, whichever way it went", () => {
  assert.equal(subjectOf(diffQueues(BEFORE, AFTER))?.taskId, "c");
});

test("dragging a task to the BOTTOM names that task, not the ones it passed", () => {
  /* The defect this pins: `a` falls by two and b and c each rise by one. A rule
     that looked for the biggest promotion would name `b` — a task the reader
     never touched — and the receipt would tell the assignee the wrong story. */
  const before = [row("a", 1, at(11)), row("b", 2, at(14)), row("c", 3, at(17))];
  const after = [row("b", 1, at(11)), row("c", 2, at(14)), row("a", 3, at(17))];
  assert.equal(subjectOf(diffQueues(before, after))?.taskId, "a");
});

test("an adjacent swap names the one that rose", () => {
  /* Both moved by one and nothing in the data distinguishes them, so the tie is
     broken the way people describe the change: "B was moved above A". */
  const before = [row("a", 1, at(11)), row("b", 2, at(14))];
  const after = [row("b", 1, at(11)), row("a", 2, at(14))];
  assert.equal(subjectOf(diffQueues(before, after))?.taskId, "b");
});

test("nothing moved means there is no subject to name", () => {
  assert.equal(subjectOf(diffQueues(BEFORE, BEFORE)), null);
});
