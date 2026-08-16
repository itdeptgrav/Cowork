import assert from "node:assert/strict";
import { test } from "node:test";
import type { Rect } from "@/lib/spreadsheet/coordinates";
import {
  cellSelection,
  selectCell,
  extendTo,
  moveActive,
  extendActive,
  edgeInDirection,
  selectAllRect,
  dataRegion,
  selectAllStep,
  moveHome,
  moveEnd,
  rowEnd,
  type Bounds,
  type FilledFn,
} from "@/lib/spreadsheet/selection";

const B: Bounds = { rows: 100, cols: 26 };

/** A filled-cell predicate over an explicit set of "row,col" keys. */
function filledOf(...cells: [number, number][]): FilledFn {
  const set = new Set(cells.map(([r, c]) => `${r},${c}`));
  return (r, c) => set.has(`${r},${c}`);
}

test("cellSelection is a single cell at the position", () => {
  const s = cellSelection({ row: 2, col: 3 });
  assert.deepEqual(s.anchor, { row: 2, col: 3 });
  assert.deepEqual(s.active, { row: 2, col: 3 });
  assert.deepEqual(s.range, { top: 2, left: 3, bottom: 2, right: 3 });
});

test("selectCell clamps inside the grid", () => {
  assert.deepEqual(selectCell({ row: -5, col: 999 }, B).active, {
    row: 0,
    col: 25,
  });
});

test("extendTo keeps the anchor and spans the rectangle", () => {
  const start = cellSelection({ row: 0, col: 0 }); // A1
  const s = extendTo(start, { row: 4, col: 2 }, B); // to C5
  assert.deepEqual(s.anchor, { row: 0, col: 0 });
  assert.deepEqual(s.active, { row: 4, col: 2 });
  assert.deepEqual(s.range, { top: 0, left: 0, bottom: 4, right: 2 });
});

test("moveActive steps from the active cell and collapses the range", () => {
  // Range A1:C5 with the active cell at the drag end, C5. A plain arrow moves
  // from the active cell and collapses the selection to one cell.
  const s = extendTo(cellSelection({ row: 0, col: 0 }), { row: 4, col: 2 }, B);
  assert.deepEqual(s.active, { row: 4, col: 2 });
  const down = moveActive(s, "down", B);
  assert.deepEqual(down.active, { row: 5, col: 2 });
  assert.deepEqual(down.range, { top: 5, left: 2, bottom: 5, right: 2 });
});

test("moveActive clamps at the edges", () => {
  const topLeft = cellSelection({ row: 0, col: 0 });
  assert.deepEqual(moveActive(topLeft, "up", B).active, { row: 0, col: 0 });
  assert.deepEqual(moveActive(topLeft, "left", B).active, { row: 0, col: 0 });
});

test("extendActive grows the selection by one (Shift+arrow)", () => {
  const s = cellSelection({ row: 2, col: 2 });
  const ext = extendActive(s, "right", B);
  assert.deepEqual(ext.anchor, { row: 2, col: 2 });
  assert.deepEqual(ext.active, { row: 2, col: 3 });
  assert.deepEqual(ext.range, { top: 2, left: 2, bottom: 2, right: 3 });
});

test("edgeInDirection: filled run jumps to its far end", () => {
  // A1..A5 filled; from A1 pressing Ctrl+Down lands on A5.
  const filled = filledOf([0, 0], [1, 0], [2, 0], [3, 0], [4, 0]);
  assert.deepEqual(edgeInDirection({ row: 0, col: 0 }, "down", filled, B), {
    row: 4,
    col: 0,
  });
});

test("edgeInDirection: from a filled cell over a gap skips to the next filled", () => {
  // A1 filled, A2..A4 blank, A5 filled. Ctrl+Down from A1 lands on A5.
  const filled = filledOf([0, 0], [4, 0]);
  assert.deepEqual(edgeInDirection({ row: 0, col: 0 }, "down", filled, B), {
    row: 4,
    col: 0,
  });
});

test("edgeInDirection: nothing ahead jumps to the boundary", () => {
  const filled = filledOf([0, 0]);
  assert.deepEqual(edgeInDirection({ row: 0, col: 0 }, "down", filled, B), {
    row: B.rows - 1,
    col: 0,
  });
  assert.deepEqual(edgeInDirection({ row: 0, col: 0 }, "right", filled, B), {
    row: 0,
    col: B.cols - 1,
  });
});

test("edgeInDirection: already at the edge stays put", () => {
  const filled = filledOf();
  assert.deepEqual(edgeInDirection({ row: 0, col: 0 }, "up", filled, B), {
    row: 0,
    col: 0,
  });
});

test("dataRegion: contiguous block around the active cell", () => {
  // A 2×2 block A1,B1,A2,B2 plus an isolated D5 that must NOT be included.
  const filled = filledOf([0, 0], [0, 1], [1, 0], [1, 1], [4, 3]);
  const region = dataRegion({ row: 0, col: 0 }, filled, B);
  assert.deepEqual(region, { top: 0, left: 0, bottom: 1, right: 1 });
});

test("dataRegion: an isolated empty cell is just itself", () => {
  const filled = filledOf([4, 3]);
  assert.deepEqual(dataRegion({ row: 0, col: 0 }, filled, B), {
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
  });
});

test("selectAllStep: data region first, whole sheet next", () => {
  const filled = filledOf([0, 0], [0, 1], [1, 0], [1, 1]);
  const region: Rect = { top: 0, left: 0, bottom: 1, right: 1 };

  const first = selectAllStep(cellSelection({ row: 0, col: 0 }), filled, B);
  assert.deepEqual(first.range, region, "first press selects the data region");

  const second = selectAllStep(first, filled, B);
  assert.deepEqual(
    second.range,
    selectAllRect(B),
    "second press selects the whole sheet",
  );
});

test("selectAllStep on a blank sheet selects everything on the second press", () => {
  const filled = filledOf();
  const first = selectAllStep(cellSelection({ row: 2, col: 2 }), filled, B);
  // A single-cell region collapses straight to selecting everything.
  assert.deepEqual(first.range, selectAllRect(B));
});

test("Home and End move within the active row", () => {
  const filled = filledOf([3, 0], [3, 1], [3, 2]); // A4..C4 filled
  const s = cellSelection({ row: 3, col: 1 });
  assert.deepEqual(moveHome(s).active, { row: 3, col: 0 });
  assert.deepEqual(moveEnd(s, filled, B).active, { row: 3, col: 2 });
  assert.equal(rowEnd(3, filled, B), 2);
  assert.equal(rowEnd(9, filled, B), 0, "empty row ends at column A");
});
