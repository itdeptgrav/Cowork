import assert from "node:assert/strict";
import { test } from "node:test";
import { selectAllStep, selectionLabel } from "./selection.ts";
import type { Rect } from "./coordinates.ts";

const B = { rows: 100, cols: 26 };

/** A 3×3 block of data at B2:D4, and nothing else. */
const filled = (r: number, c: number) => r >= 1 && r <= 3 && c >= 1 && c <= 3;

const at = (row: number, col: number) => ({
  anchor: { row, col },
  active: { row, col },
  range: { top: row, left: col, bottom: row, right: col },
});
const rect = (s: { range: Rect }) => s.range;
const SHEET: Rect = { top: 0, left: 0, bottom: 99, right: 25 };
const REGION: Rect = { top: 1, left: 1, bottom: 3, right: 3 };

test("the first press takes the data region around the active cell", () => {
  assert.deepEqual(rect(selectAllStep(at(2, 2), filled, B)), REGION);
});

test("the second press takes the whole sheet", () => {
  const first = selectAllStep(at(2, 2), filled, B);
  assert.deepEqual(rect(selectAllStep(first, filled, B)), SHEET);
});

test("the third press comes back to the data region", () => {
  /* The reported gap: it used to latch on the whole sheet, so overshooting
     could only be undone by clicking a cell and starting again. */
  const first = selectAllStep(at(2, 2), filled, B);
  const second = selectAllStep(first, filled, B);
  assert.deepEqual(rect(selectAllStep(second, filled, B)), REGION);
});

test("it keeps cycling, so a fourth press is a second press", () => {
  let sel = at(2, 2);
  const seen: Rect[] = [];
  for (let i = 0; i < 4; i++) {
    sel = selectAllStep(sel, filled, B);
    seen.push(rect(sel));
  }
  assert.deepEqual(seen, [REGION, SHEET, REGION, SHEET]);
});

test("the active cell survives every step", () => {
  /* The region is grown FROM the active cell, so losing it would change which
     region the next press finds. */
  let sel = at(2, 2);
  for (let i = 0; i < 3; i++) {
    sel = selectAllStep(sel, filled, B);
    assert.deepEqual(sel.active, { row: 2, col: 2 });
  }
});

test("a cell on its own goes straight to the whole sheet and stays", () => {
  /* Cycling into a one-cell "region" would offer an empty step. */
  const empty = () => false;
  const first = selectAllStep(at(50, 5), empty, B);
  assert.deepEqual(rect(first), SHEET);
  assert.deepEqual(rect(selectAllStep(first, empty, B)), SHEET);
});

test("a sheet whose data fills it does not latch on an equal rectangle", () => {
  /* Region and sheet are the same rect here; the cycle must not depend on
     telling them apart. */
  const all = () => true;
  let sel = at(0, 0);
  for (let i = 0; i < 3; i++) {
    sel = selectAllStep(sel, all, B);
    assert.deepEqual(rect(sel), SHEET);
  }
});

test("the status bar names what is selected", () => {
  assert.equal(selectionLabel(SHEET, B), "Whole sheet");
  assert.equal(selectionLabel(REGION, B), "3R × 3C");
});

test("a single cell is not labelled — the name box already says it", () => {
  assert.equal(selectionLabel({ top: 4, left: 4, bottom: 4, right: 4 }, B), null);
});

test("whole rows and columns are named as such, not as a size", () => {
  /* "100R × 2C" is a fact about the sheet's height, not about the selection. */
  assert.equal(selectionLabel({ top: 0, left: 3, bottom: 99, right: 4 }, B), "2 columns");
  assert.equal(selectionLabel({ top: 0, left: 3, bottom: 99, right: 3 }, B), "1 column");
  assert.equal(selectionLabel({ top: 7, left: 0, bottom: 9, right: 25 }, B), "3 rows");
  assert.equal(selectionLabel({ top: 7, left: 0, bottom: 7, right: 25 }, B), "1 row");
});
