import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TRANSFORM_HANDLES,
  keepsRatio,
  ratioOf,
  transformCellSize,
} from "./imageTransform.ts";

const START = { width: 400, height: 200 };

/* ── Which handles do what ────────────────────────────────────────────────── */

test("there are eight handles, four of them corners", () => {
  assert.equal(TRANSFORM_HANDLES.length, 8);
  assert.equal(TRANSFORM_HANDLES.filter(keepsRatio).length, 4);
});

test("corners keep the shape, edges do not", () => {
  for (const h of ["nw", "ne", "se", "sw"] as const) assert.equal(keepsRatio(h), true, h);
  for (const h of ["n", "e", "s", "w"] as const) assert.equal(keepsRatio(h), false, h);
});

/* ── Edges: one axis, free ────────────────────────────────────────────────── */

test("the east edge changes width only", () => {
  const out = transformCellSize({ start: START, handle: "e", dx: 60, dy: 999 });
  assert.deepEqual(out, { width: 460, height: 200 });
});

test("the south edge changes height only", () => {
  const out = transformCellSize({ start: START, handle: "s", dx: 999, dy: 50 });
  assert.deepEqual(out, { width: 400, height: 250 });
});

test("dragging a north or west handle outward makes the cell BIGGER", () => {
  /* The cell's top-left is pinned to the grid and cannot move, so pulling the
     top edge upward can only mean taller. Getting the sign wrong here shrinks
     the cell when the hand says grow, which reads as the box fighting you. */
  const up = transformCellSize({ start: START, handle: "n", dx: 0, dy: -40 });
  assert.equal(up.height, 240);
  const left = transformCellSize({ start: START, handle: "w", dx: -40, dy: 0 });
  assert.equal(left.width, 440);
});

/* ── Corners: the picture's shape is kept ─────────────────────────────────── */

test("a corner drag keeps the picture's ratio, not the cell's", () => {
  /* The cell is 400×200 (2:1) but the PICTURE is 1:1 here — a cell somebody
     already squashed. The first corner drag should snap back to the picture's
     true shape rather than preserving the distortion for ever. */
  const out = transformCellSize({ start: START, handle: "se", dx: 100, dy: 0, ratio: 1 });
  assert.equal(out.width, 500);
  assert.equal(out.height, 500);
});

test("a corner follows whichever axis moved further, proportionally", () => {
  /* Compared as a fraction of the starting size. In raw pixels the wide axis
     wins on a wide picture and the box then ignores vertical movement. */
  const ratio = 2;
  /* 10px on a 400-wide side is 2.5%; 30px on a 200-tall side is 15% — height
     dominates, so the height is what the pointer sets. */
  const out = transformCellSize({ start: START, handle: "se", dx: 10, dy: 30, ratio });
  assert.equal(out.height, 230);
  assert.equal(out.width, 460);
});

test("a corner drag with no known ratio just moves both axes", () => {
  /* `naturalWidth` is 0 until the picture decodes. Dividing by that gives
     Infinity, and the cell would collapse on the first pixel of movement. */
  const out = transformCellSize({ start: START, handle: "se", dx: 50, dy: 20 });
  assert.deepEqual(out, { width: 450, height: 220 });
});

test("a ratio that is not a usable number is ignored rather than obeyed", () => {
  for (const ratio of [0, -2, NaN, Infinity]) {
    const out = transformCellSize({ start: START, handle: "se", dx: 50, dy: 20, ratio });
    assert.deepEqual(out, { width: 450, height: 220 }, String(ratio));
  }
});

test("the north-west corner grows both ways as it is dragged out", () => {
  const out = transformCellSize({ start: START, handle: "nw", dx: -100, dy: -50, ratio: 2 });
  assert.equal(out.width, 500);
  assert.equal(out.height, 250);
});

/* ── Bounds ───────────────────────────────────────────────────────────────── */

test("a cell cannot be dragged smaller than the grid's own minimum", () => {
  /* Nothing left to grab to drag it back. Same 24 × 16 a column or row drag
     stops at. */
  const out = transformCellSize({ start: START, handle: "se", dx: -9999, dy: -9999 });
  assert.deepEqual(out, { width: 24, height: 16 });
});

test("there is NO maximum — the import ceiling does not follow the cell", () => {
  /* The whole point of the owner's rule: 480 × 360 applies on the way in and
     to nothing after it. */
  const out = transformCellSize({ start: START, handle: "se", dx: 5000, dy: 0, ratio: 2 });
  assert.equal(out.width, 5400);
  assert.equal(out.height, 2700);
});

test("sizes come back as whole pixels", () => {
  const out = transformCellSize({ start: START, handle: "se", dx: 33, dy: 0, ratio: 3 });
  assert.equal(out.width, Math.round(out.width));
  assert.equal(out.height, Math.round(out.height));
});

/* ── Reading the ratio ────────────────────────────────────────────────────── */

test("a decoded picture gives its ratio", () => {
  assert.equal(ratioOf({ width: 800, height: 400 }), 2);
});

test("an undecoded or missing picture gives none", () => {
  for (const bad of [null, undefined, {}, { width: 0, height: 0 }, { width: 100, height: 0 }, { width: NaN, height: 2 }]) {
    assert.equal(ratioOf(bad), undefined, JSON.stringify(bad));
  }
});
