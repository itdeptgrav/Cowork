import assert from "node:assert/strict";
import { test } from "node:test";
import {
  insertionIndex,
  insertionOffset,
  moveWithin,
  orderChanged,
  type RowOffset,
} from "./dragReorder.ts";

/* Four rows, 40px tall, stacked from the top of the list. Midpoints therefore
   fall at 20, 60, 100 and 140. */
const ROWS: RowOffset[] = [
  { top: 0, height: 40 },
  { top: 40, height: 40 },
  { top: 80, height: 40 },
  { top: 120, height: 40 },
];

test("the gap flips at a row's midpoint, not at its edge", () => {
  assert.equal(insertionIndex(ROWS, 0), 0);
  assert.equal(insertionIndex(ROWS, 19), 0);
  assert.equal(insertionIndex(ROWS, 21), 1, "past the middle of row 0");
  assert.equal(insertionIndex(ROWS, 59), 1);
  assert.equal(insertionIndex(ROWS, 61), 2);
});

test("below the last row is the gap at the end, not the last row", () => {
  assert.equal(insertionIndex(ROWS, 141), 4);
  assert.equal(insertionIndex(ROWS, 10_000), 4);
});

test("above the list is the gap at the top", () => {
  assert.equal(insertionIndex(ROWS, -50), 0);
});

test("an empty list has exactly one gap", () => {
  assert.equal(insertionIndex([], 0), 0);
  assert.equal(insertionIndex([], 999), 0);
});

test("the indicator is drawn at the top of the row that would be pushed down", () => {
  assert.equal(insertionOffset(ROWS, 0), 0);
  assert.equal(insertionOffset(ROWS, 1), 40);
  assert.equal(insertionOffset(ROWS, 3), 120);
});

test("the last gap draws below the last row, not on top of it", () => {
  assert.equal(insertionOffset(ROWS, 4), 160);
  assert.equal(insertionOffset(ROWS, 99), 160, "clamped rather than off the end");
});

test("moving a row UP lands it exactly at the gap", () => {
  assert.deepEqual(moveWithin(["a", "b", "c", "d"], "d", 1), ["a", "d", "b", "c"]);
  assert.deepEqual(moveWithin(["a", "b", "c", "d"], "c", 0), ["c", "a", "b", "d"]);
});

test("moving a row DOWN accounts for the space it vacates", () => {
  /* The whole reason this function exists. The gap index counts the dragged row
     while it is still in place, so `a` to gap 2 means "after b", which is index
     1 once `a` has been lifted out. Without the adjustment every downward move
     lands one short. */
  assert.deepEqual(moveWithin(["a", "b", "c", "d"], "a", 2), ["b", "a", "c", "d"]);
  assert.deepEqual(moveWithin(["a", "b", "c", "d"], "a", 3), ["b", "c", "a", "d"]);
});

test("a row can reach the very bottom", () => {
  /* The case the off-by-one hides: without it, gap 4 puts `a` at index 4 of a
     three-item remainder — which splice clamps back to third, and the row can
     never actually reach the end. */
  assert.deepEqual(moveWithin(["a", "b", "c", "d"], "a", 4), ["b", "c", "d", "a"]);
});

test("dropping a row onto its own gap changes nothing", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(moveWithin(ids, "b", 1), ids);
  assert.deepEqual(moveWithin(ids, "b", 2), ids, "the gap below itself is also a no-op");
});

test("an unknown id leaves the order alone rather than inserting it", () => {
  assert.deepEqual(moveWithin(["a", "b"], "zzz", 0), ["a", "b"]);
});

test("the input is never mutated", () => {
  const ids = ["a", "b", "c"];
  moveWithin(ids, "c", 0);
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("a change is a change of SEQUENCE, not of membership", () => {
  assert.equal(orderChanged(["a", "b"], ["a", "b"]), false);
  assert.equal(orderChanged(["a", "b"], ["b", "a"]), true);
  assert.equal(orderChanged(["a"], ["a", "b"]), true);
  assert.equal(orderChanged([], []), false);
});
