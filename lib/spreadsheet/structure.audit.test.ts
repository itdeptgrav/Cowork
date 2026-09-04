/**
 * Structure audit — insert/delete of rows, columns and cell blocks.
 *
 * The one edit that moves the whole sheet. Reference semantics (Excel/Sheets):
 * cells at or past the cut shift; every formula ANYWHERE is rewritten so it
 * keeps naming the same data — absolute refs included; a reference into a
 * deletion becomes #REF!; a range losing lines contracts, gaining them grows;
 * axis metadata (heights, hidden flags, freeze counts) shifts with its lines.
 *
 * Documented model choices exercised here as documented, not as bugs:
 *  · the grid is FIXED SIZE — an insert pushes cells off the far edge (they are
 *    dropped), a delete opens blanks at it;
 *  · merges, links, comments, validations, conditional formats and filters are
 *    NOT reference-tracked through structural edits (merge.ts / structure.ts
 *    both call this out).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCellRef, type Rect } from "@/lib/spreadsheet/coordinates";
import {
  createWorksheet,
  getCellStyleId,
  getCellValue,
  setCellStyleId,
  setCellValue,
  type Worksheet,
} from "@/lib/spreadsheet/model";
import { applyMerge } from "@/lib/spreadsheet/merge";
import { structuralCommand } from "@/lib/spreadsheet/history";
import {
  deleteCols,
  deleteRows,
  freezeCols,
  freezeRows,
  insertCols,
  insertRows,
  setColWidth,
  setColsHidden,
  setRowHeight,
  setRowsHidden,
  shiftCells,
} from "@/lib/spreadsheet/structure";

function sheet(cells: Record<string, string>, rows = 1000, cols = 100): Worksheet {
  let ws = createWorksheet("s", "Sheet1", rows, cols);
  for (const [ref, value] of Object.entries(cells)) {
    const p = parseCellRef(ref)!;
    ws = setCellValue(ws, p.row, p.col, value);
  }
  return ws;
}

const rect = (t: number, l: number, b: number, r: number): Rect =>
  ({ top: t, left: l, bottom: b, right: r });

/* ── Row/column shifts at the boundaries ──────────────────────────────────── */

test("AUDIT: multi-row insert at 0 shifts everything by the count and rewrites refs", () => {
  const ws = sheet({ A1: "10", A2: "20", B1: "=A1+A2" });
  const next = insertRows(ws, 0, 3);
  assert.equal(getCellValue(next, 0, 0), "");
  assert.equal(getCellValue(next, 2, 0), "");
  assert.equal(getCellValue(next, 3, 0), "10");
  assert.equal(getCellValue(next, 4, 0), "20");
  assert.equal(getCellValue(next, 3, 1), "=A4+A5");
});

test("AUDIT: insert at the sheet's end changes nothing (fixed grid, nothing beyond)", () => {
  const ws = sheet({ A1: "x", A5: "y" }, 5, 5);
  const next = insertRows(ws, 5, 1);
  assert.deepEqual(next.cells, ws.cells);
  assert.equal(next.rowCount, 5, "the grid does not grow");
});

test("AUDIT: an insert pushes the last rows OFF the fixed grid (documented model)", () => {
  // Documented divergence from Sheets (which grows the grid) and from Excel
  // (which blocks the insert): the pushed-off cells are dropped.
  const ws = sheet({ A5: "last", A4: "kept" }, 5, 5);
  const next = insertRows(ws, 0, 1);
  assert.equal(getCellValue(next, 4, 0), "kept", "A4 moved into the last row");
  assert.equal(Object.keys(next.cells).length, 1, "the old last row fell off");
  assert.equal(next.rowCount, 5);
});

test("AUDIT: delete spanning past the end drops what exists and keeps the rest", () => {
  const ws = sheet({ A3: "keep", A4: "gone", A5: "gone too" }, 5, 5);
  const next = deleteRows(ws, 3, 10); // only rows 4-5 exist to delete
  assert.equal(getCellValue(next, 2, 0), "keep");
  assert.equal(Object.keys(next.cells).length, 1);
  assert.equal(next.rowCount, 5, "count stays fixed; blanks open at the end");
});

test("AUDIT: deleting every row leaves an empty sheet with cleared axis metadata", () => {
  let ws = sheet({ A1: "a", C3: "b", E5: "c" }, 5, 5);
  ws = setRowHeight(ws, 2, 50);
  ws = setRowsHidden(ws, 3, 3, true);
  ws = freezeRows(ws, 2);
  const next = deleteRows(ws, 0, 5);
  assert.deepEqual(next.cells, {});
  assert.deepEqual(next.rowHeights, {});
  assert.deepEqual(next.hiddenRows, {});
  assert.equal(next.frozenRows, 0);
});

test("AUDIT: column ops mirror row ops — multi-insert, boundary delete, ref rewrite", () => {
  const ws = sheet({ A1: "1", B1: "2", C1: "=A1+B1" });
  const inserted = insertCols(ws, 1, 2);
  assert.equal(getCellValue(inserted, 0, 0), "1");
  assert.equal(getCellValue(inserted, 0, 3), "2");
  assert.equal(getCellValue(inserted, 0, 4), "=A1+D1");

  const deleted = deleteCols(ws, 0, 2);
  assert.equal(getCellValue(deleted, 0, 0), "=#REF!+#REF!", "both refs died with their columns");
});

/* ── Formula rewriting: ranges, anchors, sheets ───────────────────────────── */

test("AUDIT: absolute references follow a structural move exactly like relative ones", () => {
  // Copy-shift holds $-anchors still; a structural edit must NOT — the data
  // itself moved (the spec's worked example).
  const ws = sheet({ E1: "=$A$2+A2" });
  const next = insertRows(ws, 0, 1);
  assert.equal(getCellValue(next, 1, 4), "=$A$3+A3");
  const delNext = deleteCols(sheet({ E5: "=$B$1" }), 1, 1);
  assert.equal(getCellValue(delNext, 4, 3), "=#REF!", "an absolute ref dies with its column too");
});

test("AUDIT: a range GROWS when lines are inserted inside it, shifts when above it", () => {
  const ws = sheet({ H1: "=SUM(A1:A5)", I1: "=SUM(A2:A3)", J1: "=SUM(A1:A2)" });
  const next = insertRows(ws, 2, 1); // inside A1:A5, above nothing else's start
  assert.equal(getCellValue(next, 0, 7), "=SUM(A1:A6)", "spanning range grew");
  assert.equal(getCellValue(next, 0, 8), "=SUM(A2:A4)", "range straddling the cut grew");
  assert.equal(getCellValue(next, 0, 9), "=SUM(A1:A2)", "range wholly above is untouched");
  const below = insertRows(sheet({ H1: "=SUM(A1:A5)" }), 5, 1);
  assert.equal(getCellValue(below, 0, 7), "=SUM(A1:A5)", "insert below the range: no growth");
});

test("AUDIT: a range CONTRACTS as its lines are deleted, to #REF! when none survive", () => {
  // The probe formula lives at H21 (row 20), clear of every deleted band; it
  // is read back from the row it lands on after the delete.
  const ws = sheet({ H21: "=SUM(A2:A4)" });
  assert.equal(getCellValue(deleteRows(ws, 1, 1), 19, 7), "=SUM(A2:A3)", "top endpoint deleted");
  assert.equal(getCellValue(deleteRows(ws, 3, 1), 19, 7), "=SUM(A2:A3)", "bottom endpoint deleted");
  assert.equal(getCellValue(deleteRows(ws, 2, 1), 19, 7), "=SUM(A2:A3)", "middle deleted");
  assert.equal(getCellValue(deleteRows(ws, 1, 3), 17, 7), "=SUM(#REF!)", "whole range deleted");
  assert.equal(getCellValue(deleteRows(ws, 0, 2), 18, 7), "=SUM(A1:A2)", "partial from above");
  assert.equal(getCellValue(deleteRows(ws, 3, 7), 13, 7), "=SUM(A2:A3)", "partial past the end");
});

test("AUDIT: reversed range endpoints keep their orientation through a delete", () => {
  const ws = sheet({ H1: "=SUM(A5:A1)" });
  assert.equal(getCellValue(deleteRows(ws, 1, 1), 0, 7), "=SUM(A4:A1)");
});

test("AUDIT: existing #REF! literals and non-formulas pass through unharmed", () => {
  const ws = sheet({ A5: "=SUM(#REF!)", B5: "100", C5: "A1:B2" });
  const next = insertRows(ws, 0, 1);
  assert.equal(getCellValue(next, 5, 0), "=SUM(#REF!)");
  assert.equal(getCellValue(next, 5, 1), "100");
  assert.equal(getCellValue(next, 5, 2), "A1:B2", "ref-looking TEXT is not rewritten");
});

test("AUDIT: references to ANOTHER sheet never move when THIS sheet is edited", () => {
  // Sheet2's data did not move; the formula cell did. Correct on both counts.
  const ws = sheet({ A5: "=Sheet2!A5+'Other Name'!B2" });
  const next = insertRows(ws, 0, 1);
  assert.equal(getCellValue(next, 5, 0), "=Sheet2!A5+'Other Name'!B2");
});

test("AUDIT: a SELF-qualified reference must move like its bare twin", () => {
  /* "=Sheet1!A5" written ON Sheet1 names exactly the same cell as "=A5".
     After inserting a row above, both must say row 6 — Excel and Sheets
     rewrite qualified self-references on structural edits. */
  const ws = sheet({ E1: "=Sheet1!A5+A5" }); // worksheet name is "Sheet1"
  const next = insertRows(ws, 0, 1);
  assert.equal(getCellValue(next, 1, 4), "=Sheet1!A6+A6");
});

/* ── Axis metadata ────────────────────────────────────────────────────────── */

test("AUDIT: heights/hidden flags shift with inserts and vanish with their line", () => {
  let ws = createWorksheet("s", "Sheet1");
  ws = setRowHeight(ws, 3, 55);
  ws = setRowsHidden(ws, 5, 6, true);
  const ins = insertRows(ws, 0, 2);
  assert.equal(ins.rowHeights[5], 55);
  assert.deepEqual(ins.hiddenRows, { 7: true, 8: true });

  const del = deleteRows(ws, 3, 1); // delete the resized row itself
  assert.equal(3 in del.rowHeights, false, "the override died with its row");
  assert.deepEqual(del.hiddenRows, { 4: true, 5: true });
});

test("AUDIT: column widths and hidden columns mirror the row behaviour", () => {
  let ws = createWorksheet("s", "Sheet1");
  ws = setColWidth(ws, 2, 120);
  ws = setColsHidden(ws, 4, 4, true);
  const ins = insertCols(ws, 0, 1);
  assert.equal(ins.colWidths[3], 120);
  assert.deepEqual(ins.hiddenCols, { 5: true });
  const del = deleteCols(ws, 2, 3); // removes both the wide and the hidden col
  assert.deepEqual(del.colWidths, {});
  assert.deepEqual(del.hiddenCols, {});
});

test("AUDIT: freeze counts under inserts — inside grows, at/below the line does not", () => {
  let ws = createWorksheet("s", "Sheet1");
  ws = freezeRows(ws, 3);
  assert.equal(insertRows(ws, 0, 2).frozenRows, 5, "insert at the top grows the band");
  assert.equal(insertRows(ws, 2, 1).frozenRows, 4, "insert inside grows it");
  assert.equal(insertRows(ws, 3, 5).frozenRows, 3, "insert at the boundary is below it");
  assert.equal(insertRows(ws, 9, 1).frozenRows, 3);
});

test("AUDIT: freeze counts under deletes — only the frozen part of the cut shrinks it", () => {
  let ws = createWorksheet("s", "Sheet1");
  ws = freezeRows(ws, 3);
  assert.equal(deleteRows(ws, 0, 1).frozenRows, 2);
  assert.equal(deleteRows(ws, 1, 5).frozenRows, 1, "cut starts inside, runs past the band");
  assert.equal(deleteRows(ws, 0, 3).frozenRows, 0, "the whole band deleted");
  assert.equal(deleteRows(ws, 0, 9).frozenRows, 0, "over-delete never goes negative");
  assert.equal(deleteRows(ws, 3, 2).frozenRows, 3, "cut at the boundary leaves it");
  const cols = freezeCols(createWorksheet("s", "S"), 2);
  assert.equal(deleteCols(cols, 1, 1).frozenCols, 1, "columns mirror rows");
});

test("AUDIT: resize/hide/freeze API edges — default drops override, clamps apply", () => {
  let ws = createWorksheet("s", "Sheet1");
  ws = setRowHeight(ws, 2, 44);
  assert.equal(ws.rowHeights[2], 44);
  ws = setRowHeight(ws, 2, ws.defaultRowHeight);
  assert.equal(2 in ws.rowHeights, false, "default height drops the override");
  assert.equal(setRowHeight(ws, 2, -10).rowHeights[2], 0, "negative clamps to zero");
  assert.equal(setColWidth(ws, 1, -5).colWidths[1], 0);
  assert.deepEqual(setRowsHidden(ws, 6, 4, true).hiddenRows, { 4: true, 5: true, 6: true },
    "reversed from/to still hides the span");
  assert.equal(freezeRows(ws, -3).frozenRows, 0);
  assert.equal(freezeRows(ws, 100000).frozenRows, ws.rowCount);
  assert.equal(freezeCols(ws, 100000).frozenCols, ws.colCount);
});

/* ── The documented reference-tracking gaps ───────────────────────────────── */

test("merges move with the rows they cover through a structural edit", () => {
  /* Once a documented divergence: the merge stayed put while its content moved.
     Now the rectangle follows the cells, and a merge cut down to one cell goes. */
  const ws = { ...createWorksheet("s", "S"), merges: [{ top: 2, left: 0, bottom: 3, right: 1 }] };
  const up = deleteRows(ws, 0, 1);
  assert.deepEqual(up.merges, [{ top: 1, left: 0, bottom: 2, right: 1 }], "the merge rectangle moves up with its content");
  const down = insertRows(ws, 0, 2);
  assert.deepEqual(down.merges, [{ top: 4, left: 0, bottom: 5, right: 1 }]);
  const gone = deleteRows(ws, 2, 2);
  assert.equal(gone.merges, undefined, "a merge whose rows are all deleted is gone");
});

test("links, comments and notes are re-keyed to where their cells moved", () => {
  const ws = {
    ...createWorksheet("s", "S"),
    links: { A1: "https://example.test" },
    notes: { B3: "check this" },
  };
  const down = insertRows(ws, 0, 1);
  assert.deepEqual(down.links, { A2: "https://example.test" }, "the link follows the cell down a row");
  assert.deepEqual(down.notes, { B4: "check this" });
  const gone = deleteRows(ws, 0, 1);
  assert.equal(gone.links, undefined, "a deleted cell's link is gone");
  assert.deepEqual(gone.notes, { B2: "check this" });
});

/* ── Cell-block shifts (Insert ▸ Cells) ───────────────────────────────────── */

test("AUDIT: shift down at a block moves ONLY its band, styles included", () => {
  let ws = sheet({ A1: "a", B1: "b", C1: "c", B2: "under" });
  ws = setCellStyleId(ws, 0, 1, 9);
  const next = shiftCells(ws, rect(0, 1, 1, 1), "down"); // insert B1:B2 blank
  assert.equal(getCellValue(next, 0, 0), "a");
  assert.equal(getCellValue(next, 0, 2), "c");
  assert.equal(getCellValue(next, 0, 1), "");
  assert.equal(getCellValue(next, 1, 1), "");
  assert.equal(getCellValue(next, 2, 1), "b");
  assert.equal(getCellValue(next, 3, 1), "under");
  assert.equal(getCellStyleId(next, 2, 1), 9, "style moved with its cell");
  assert.equal(getCellStyleId(next, 0, 1), 0);
});

test("AUDIT: shift down pushes the band's last cells off the fixed grid", () => {
  const ws = sheet({ B5: "tail", A5: "safe" }, 5, 5);
  const next = shiftCells(ws, rect(0, 1, 0, 1), "down");
  assert.equal(getCellValue(next, 4, 1), "", "B5 fell off the 5-row sheet");
  assert.equal(getCellValue(next, 4, 0), "safe", "column A never moved");
});

test("AUDIT: shift up deletes the block, closes the gap, and #REF!s refs into it", () => {
  const ws = sheet({ B3: "x", B4: "y", B5: "z", E1: "=B3", F1: "=B5" });
  const next = shiftCells(ws, rect(2, 1, 3, 1), "up"); // delete B3:B4
  assert.equal(getCellValue(next, 2, 1), "z", "B5 closed the gap into B3");
  assert.equal(getCellValue(next, 3, 1), "");
  assert.equal(getCellValue(next, 0, 4), "=#REF!", "ref into the deleted block");
  assert.equal(getCellValue(next, 0, 5), "=B3", "ref below the block followed the close-up");
});

test("AUDIT: shift left/right move only the block's own rows", () => {
  const ws = sheet({ A1: "a1", B1: "b1", A2: "a2" });
  const right = shiftCells(ws, rect(0, 0, 0, 0), "right");
  assert.equal(getCellValue(right, 0, 0), "");
  assert.equal(getCellValue(right, 0, 1), "a1");
  assert.equal(getCellValue(right, 0, 2), "b1");
  assert.equal(getCellValue(right, 1, 0), "a2", "row 2 outside the band");

  const wsL = sheet({ A1: "a1", B1: "b1", C1: "c1", B2: "stay" });
  const left = shiftCells(wsL, rect(0, 1, 0, 1), "left"); // delete B1 leftward
  assert.equal(getCellValue(left, 0, 1), "c1", "C1 closed into B1");
  assert.equal(getCellValue(left, 0, 2), "");
  assert.equal(getCellValue(left, 1, 1), "stay");
});

test("AUDIT: a range wholly inside the band grows on insert and contracts on delete", () => {
  const grow = sheet({ E1: "=SUM(B1:B10)" });
  const grown = shiftCells(grow, rect(4, 1, 5, 1), "down"); // insert B5:B6
  assert.equal(getCellValue(grown, 0, 4), "=SUM(B1:B12)");

  const shrink = sheet({ E1: "=SUM(B1:B10)" });
  const shrunk = shiftCells(shrink, rect(4, 1, 5, 1), "up"); // delete B5:B6
  assert.equal(getCellValue(shrunk, 0, 4), "=SUM(B1:B8)");
});

test("AUDIT: a range straddling the band's edge is left alone — even on delete", () => {
  // Excel leaves a straddling range untouched rather than guessing; so does
  // this engine (transformRegionShift doc), including when cells vanish.
  const ws = sheet({ E1: "=SUM(A5:C5)", A5: "1", B5: "2", C5: "3" });
  const next = shiftCells(ws, rect(4, 1, 4, 1), "up"); // delete only B5
  assert.equal(getCellValue(next, 0, 4), "=SUM(A5:C5)");
});

test("AUDIT: whole-line metadata does not move with a block shift (documented)", () => {
  let ws = sheet({ B1: "x" });
  ws = setRowHeight(ws, 0, 60);
  ws = freezeRows(ws, 1);
  const next = shiftCells(ws, rect(0, 1, 0, 1), "down");
  assert.equal(next.rowHeights[0], 60, "the height belongs to the whole line");
  assert.equal(next.frozenRows, 1);
});

/* ── Undo data ────────────────────────────────────────────────────────────── */

test("AUDIT: a structural command snapshots the exact before/after worksheets", () => {
  const before = sheet({ A1: "x" });
  const after = insertRows(before, 0, 1);
  const cmd = structuralCommand("Insert row", before, after);
  assert.equal(cmd.kind, "structural");
  assert.equal(cmd.sheetId, "s");
  assert.equal(cmd.before, before, "undo target is the untouched original object");
  assert.equal(cmd.after, after);
  // The op never mutated the original — undo by snapshot is therefore sound.
  assert.equal(getCellValue(before, 0, 0), "x");
  assert.equal(getCellValue(after, 1, 0), "x");
});
