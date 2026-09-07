/**
 * Selection audit — edges of the grid, edges of the data.
 *
 * Adversarial cases for the selection algebra: moving and extending at the
 * sheet's four borders, Ctrl+Arrow region-edge jumps in every neighbourhood
 * shape, and the Ctrl+A data-region/whole-sheet ladder. Reference semantics are
 * Google Sheets / Excel.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cellSelection,
  dataRegion,
  edgeInDirection,
  extendActive,
  extendTo,
  moveActive,
  moveDocumentEnd,
  moveDocumentStart,
  moveEnd,
  moveHome,
  moveToEdge,
  rowEnd,
  selectAllRect,
  selectAllStep,
  selectCell,
  type Bounds,
  type FilledFn,
} from "@/lib/spreadsheet/selection";

const B: Bounds = { rows: 10, cols: 8 };

function filledOf(...cells: [number, number][]): FilledFn {
  const set = new Set(cells.map(([r, c]) => `${r},${c}`));
  return (r, c) => set.has(`${r},${c}`);
}

test("AUDIT: moveActive stops dead at all four borders instead of wrapping", () => {
  const tl = cellSelection({ row: 0, col: 0 });
  assert.deepEqual(moveActive(tl, "up", B).active, { row: 0, col: 0 });
  assert.deepEqual(moveActive(tl, "left", B).active, { row: 0, col: 0 });
  const br = cellSelection({ row: 9, col: 7 });
  assert.deepEqual(moveActive(br, "down", B).active, { row: 9, col: 7 });
  assert.deepEqual(moveActive(br, "right", B).active, { row: 9, col: 7 });
});

test("AUDIT: selectCell clamps any out-of-grid position onto the border", () => {
  assert.deepEqual(selectCell({ row: -3, col: -3 }, B).active, { row: 0, col: 0 });
  assert.deepEqual(selectCell({ row: 100, col: 100 }, B).active, { row: 9, col: 7 });
  assert.deepEqual(selectCell({ row: -1, col: 100 }, B).active, { row: 0, col: 7 });
});

test("AUDIT: extendActive at a border keeps the range instead of losing it", () => {
  // Anchor B2, extended up to B1 — extending up again must not move anything.
  let sel = extendTo(cellSelection({ row: 1, col: 1 }), { row: 0, col: 1 }, B);
  sel = extendActive(sel, "up", B);
  assert.deepEqual(sel.range, { top: 0, left: 1, bottom: 1, right: 1 });
  assert.deepEqual(sel.anchor, { row: 1, col: 1 }, "anchor survives the clamp");
});

test("AUDIT: shrinking an extension back across the anchor flips the rectangle", () => {
  // Anchor C3; extend right to D3, then step left twice: D3 → C3 → B3.
  let sel = extendTo(cellSelection({ row: 2, col: 2 }), { row: 2, col: 3 }, B);
  sel = extendActive(sel, "left", B);
  assert.deepEqual(sel.range, { top: 2, left: 2, bottom: 2, right: 2 }, "back to one cell");
  sel = extendActive(sel, "left", B);
  assert.deepEqual(
    sel.range,
    { top: 2, left: 1, bottom: 2, right: 2 },
    "the range flips to the anchor's other side, as dragging through it does",
  );
});

test("AUDIT: Ctrl+Arrow from inside a run rides to the run's last filled cell", () => {
  const filled = filledOf([0, 0], [1, 0], [2, 0], [3, 0]);
  assert.deepEqual(edgeInDirection({ row: 0, col: 0 }, "down", filled, B), { row: 3, col: 0 });
  // From mid-run the jump still goes to the run's end, not one step.
  assert.deepEqual(edgeInDirection({ row: 1, col: 0 }, "down", filled, B), { row: 3, col: 0 });
});

test("AUDIT: Ctrl+Arrow from a run's end skips the blank gap to the next island", () => {
  const filled = filledOf([0, 0], [1, 0], [5, 0], [6, 0]);
  assert.deepEqual(edgeInDirection({ row: 1, col: 0 }, "down", filled, B), { row: 5, col: 0 });
  // And from the second island's end, with nothing below, to the boundary.
  assert.deepEqual(edgeInDirection({ row: 6, col: 0 }, "down", filled, B), { row: 9, col: 0 });
});

test("AUDIT: Ctrl+Arrow from an empty cell lands on the first filled cell ahead", () => {
  const filled = filledOf([0, 3]);
  assert.deepEqual(edgeInDirection({ row: 0, col: 0 }, "right", filled, B), { row: 0, col: 3 });
  // Adjacent filled counts as "first ahead" — one step.
  const adjacent = filledOf([0, 1]);
  assert.deepEqual(edgeInDirection({ row: 0, col: 0 }, "right", adjacent, B), { row: 0, col: 1 });
});

test("AUDIT: Ctrl+Arrow on an empty sheet jumps to the boundary; at it, stays", () => {
  const none: FilledFn = () => false;
  assert.deepEqual(edgeInDirection({ row: 4, col: 4 }, "down", none, B), { row: 9, col: 4 });
  assert.deepEqual(edgeInDirection({ row: 9, col: 4 }, "down", none, B), { row: 9, col: 4 });
  assert.deepEqual(edgeInDirection({ row: 4, col: 4 }, "left", none, B), { row: 4, col: 0 });
  // moveToEdge wraps the same maths into a selection.
  const sel = moveToEdge(cellSelection({ row: 4, col: 4 }), "up", none, B);
  assert.deepEqual(sel.active, { row: 0, col: 4 });
});

test("AUDIT: dataRegion grows over a solid block from any cell inside it", () => {
  // A 3×2 block at B2:C4.
  const filled = filledOf([1, 1], [1, 2], [2, 1], [2, 2], [3, 1], [3, 2]);
  const expected = { top: 1, left: 1, bottom: 3, right: 2 };
  assert.deepEqual(dataRegion({ row: 1, col: 1 }, filled, B), expected);
  assert.deepEqual(dataRegion({ row: 3, col: 2 }, filled, B), expected);
  assert.deepEqual(dataRegion({ row: 2, col: 1 }, filled, B), expected);
});

test("AUDIT: dataRegion includes data connected only diagonally (current region)", () => {
  /* A1 and B2 filled, nothing else. Excel's CurrentRegion and Sheets' Ctrl+A
     both treat diagonal contact as connected — the region is bounded by fully
     blank rows/columns, so A1:B2 is one region. The border scan extends one
     cell past each side of the rectangle, so the corner neighbour is seen. */
  const filled = filledOf([0, 0], [1, 1]);
  assert.deepEqual(
    dataRegion({ row: 0, col: 0 }, filled, B),
    { top: 0, left: 0, bottom: 1, right: 1 },
  );
});

test("AUDIT: Ctrl+A ladder — data region first, whole sheet second", () => {
  const filled = filledOf([0, 0], [0, 1], [1, 0], [1, 1]); // solid A1:B2
  let sel = cellSelection({ row: 0, col: 0 });
  sel = selectAllStep(sel, filled, B);
  assert.deepEqual(sel.range, { top: 0, left: 0, bottom: 1, right: 1 }, "first press: region");
  sel = selectAllStep(sel, filled, B);
  assert.deepEqual(sel.range, selectAllRect(B), "second press: everything");
});

test("AUDIT: Ctrl+A cycles back to the data region on the third press", () => {
  /* **This reverses what this test used to assert**, by the owner's decision
     (4 Sep 2026). Excel and Sheets latch on the whole sheet, and that latch is
     the reported problem: overshooting had no way back except clicking a cell,
     which also threw away where you were. Pressing the same key again is what
     somebody already does when a toggle goes one step too far. */
  const filled = filledOf([0, 0], [0, 1], [1, 0], [1, 1]);
  const region = { top: 0, left: 0, bottom: 1, right: 1 };
  let sel = cellSelection({ row: 0, col: 0 });
  sel = selectAllStep(sel, filled, B);
  assert.deepEqual(sel.range, region, "first press: the data region");
  sel = selectAllStep(sel, filled, B);
  assert.deepEqual(sel.range, selectAllRect(B), "second press: everything");
  sel = selectAllStep(sel, filled, B);
  assert.deepEqual(sel.range, region, "third press: back to the data region");
});

test("AUDIT: Ctrl+A on an isolated empty cell selects the whole sheet at once", () => {
  const none: FilledFn = () => false;
  const sel = selectAllStep(cellSelection({ row: 4, col: 4 }), none, B);
  assert.deepEqual(sel.range, selectAllRect(B));
});

test("AUDIT: Home/End/document jumps at their edges", () => {
  const filled = filledOf([2, 0], [2, 5], [7, 3]);
  assert.deepEqual(moveHome(cellSelection({ row: 2, col: 6 })).active, { row: 2, col: 0 });
  assert.deepEqual(moveEnd(cellSelection({ row: 2, col: 0 }), filled, B).active, { row: 2, col: 5 });
  assert.equal(rowEnd(4, filled, B), 0, "an empty row's end is its start");
  assert.deepEqual(moveDocumentStart().active, { row: 0, col: 0 });
  assert.deepEqual(moveDocumentEnd(filled, B).active, { row: 7, col: 5 },
    "Ctrl+End is the bounding corner of used rows × used columns");
  assert.deepEqual(moveDocumentEnd(() => false, B).active, { row: 0, col: 0 });
});
