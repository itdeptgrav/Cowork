import assert from "node:assert/strict";
import { test } from "node:test";
import { copyRange, pasteSizes } from "./clipboard.ts";
import { createWorkbook } from "./model.ts";
import type { Worksheet } from "./model.ts";

/**
 * A picture's size travels with a copy of it.
 *
 * A picture sizes the cell it lives in, so copying one to another cell and
 * arriving at the default 100 × 24 would be arriving cropped. The size is part
 * of the picture the way a style is.
 *
 * The counterweight, and the reason this is not simply "copy the row heights":
 * a row height and a column width belong to the ROW and the COLUMN, not to the
 * cell. Carrying them for every copied cell would mean an ordinary paste of
 * text silently resized whatever columns it landed on.
 */

function sheetWith(sizes: {
  colWidths?: Record<number, number>;
  rowHeights?: Record<number, number>;
}): Worksheet {
  const ws = createWorkbook().worksheets[0];
  return { ...ws, colWidths: sizes.colWidths ?? {}, rowHeights: sizes.rowHeights ?? {} };
}

const ONE_CELL = { top: 0, left: 0, bottom: 0, right: 0 };
const BOUNDS = { rows: 1000, cols: 100 };

test("nothing is recorded when the caller cannot say what is a picture", () => {
  /* Every existing caller passes no predicate, and none of them should start
     resizing the destination. */
  const clip = copyRange(sheetWith({}), ONE_CELL);
  assert.equal(clip.imageSizes, undefined);
});

test("a copied picture carries the cell's own size", () => {
  const ws = sheetWith({ colWidths: { 0: 250 }, rowHeights: { 0: 124 } });
  const clip = copyRange(ws, ONE_CELL, false, () => true);
  assert.deepEqual(clip.imageSizes, [{ row: 0, col: 0, width: 250, height: 124 }]);
});

test("a picture in a default-sized cell still carries that size", () => {
  /* Otherwise pasting it onto a column somebody had widened would silently
     stretch the picture to fit. */
  const ws = sheetWith({});
  const clip = copyRange(ws, ONE_CELL, false, () => true);
  assert.deepEqual(clip.imageSizes, [
    { row: 0, col: 0, width: ws.defaultColWidth, height: ws.defaultRowHeight },
  ]);
});

test("only the picture cells are recorded, not the block", () => {
  /* The whole point: text in the same block must not resize anything. */
  const ws = sheetWith({ colWidths: { 0: 250, 1: 80 }, rowHeights: { 0: 124, 1: 40 } });
  const rect = { top: 0, left: 0, bottom: 1, right: 1 };
  const clip = copyRange(ws, rect, false, (r, c) => r === 1 && c === 1);
  assert.deepEqual(clip.imageSizes, [{ row: 1, col: 1, width: 80, height: 40 }]);
});

test("no picture in the block leaves the field off entirely", () => {
  const clip = copyRange(sheetWith({}), ONE_CELL, false, () => false);
  assert.equal(clip.imageSizes, undefined);
});

test("positions are block-relative, so the block can be pasted anywhere", () => {
  const ws = sheetWith({ colWidths: { 5: 300 }, rowHeights: { 9: 200 } });
  const clip = copyRange(ws, { top: 8, left: 4, bottom: 9, right: 5 }, false, (r, c) => r === 9 && c === 5);
  assert.deepEqual(clip.imageSizes, [{ row: 1, col: 1, width: 300, height: 200 }]);
});

/* ── Landing them ─────────────────────────────────────────────────────────── */

test("a size lands offset from the paste site", () => {
  const ws = sheetWith({ colWidths: { 0: 250 }, rowHeights: { 0: 124 } });
  const clip = copyRange(ws, ONE_CELL, false, () => true);
  assert.deepEqual(pasteSizes(clip, { row: 4, col: 2 }, BOUNDS), [
    { row: 4, col: 2, width: 250, height: 124 },
  ]);
});

test("a block with no pictures lands no sizes", () => {
  const clip = copyRange(sheetWith({}), ONE_CELL, false, () => false);
  assert.deepEqual(pasteSizes(clip, { row: 4, col: 2 }, BOUNDS), []);
});

test("a picture overhanging the sheet's edge is dropped, like any other cell", () => {
  const ws = sheetWith({ colWidths: { 0: 250, 1: 250 } });
  const clip = copyRange(ws, { top: 0, left: 0, bottom: 0, right: 1 }, false, () => true);
  const landed = pasteSizes(clip, { row: 0, col: 99 }, BOUNDS);
  assert.equal(landed.length, 1, "the overhanging column is gone");
  assert.equal(landed[0].col, 99);
});

test("a cut carries sizes too — the picture is moving, not being retyped", () => {
  const ws = sheetWith({ colWidths: { 0: 250 }, rowHeights: { 0: 124 } });
  const clip = copyRange(ws, ONE_CELL, true, () => true);
  assert.equal(clip.cut, true);
  assert.deepEqual(clip.imageSizes, [{ row: 0, col: 0, width: 250, height: 124 }]);
});
