/**
 * Model audit — cell/row helpers, batch writes, bounds, clone independence,
 * defaults, and the sheet naming/uniqueness helpers layered over the model.
 *
 * These tests assert CORRECT behaviour (immutability, sparse-store invariants,
 * real-spreadsheet clear semantics), not what the code happens to do. Any
 * failing assertion is kept and marked // BUG(<id>).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from "@/lib/spreadsheet/metrics";
import {
  DEFAULT_COL_COUNT,
  DEFAULT_ROW_COUNT,
  activeWorksheet,
  applyCellWrites,
  clearRect,
  createWorkbook,
  createWorksheet,
  filledPositions,
  getCell,
  getCellStyleId,
  getCellValue,
  isFilled,
  metricsOf,
  setCellStyleId,
  setCellValue,
  withActiveWorksheet,
  type Workbook,
} from "@/lib/spreadsheet/model";
import { StyleRegistry } from "@/lib/spreadsheet/style";
import { buildTable, templateById } from "@/lib/spreadsheet/templates";
import {
  addSheet,
  createSheet,
  deleteSheet,
  duplicateSheet,
  moveSheet,
  renameSheet,
  setSheetHidden,
  switchSheet,
  visibleSheets,
} from "@/lib/spreadsheet/workbook";

/* ── 1. Creation defaults ─────────────────────────────────────────────────── */

test("AUDIT: a fresh worksheet has the documented shape and defaults", () => {
  const ws = createWorksheet("id-1", "One");
  assert.equal(ws.id, "id-1");
  assert.equal(ws.name, "One");
  assert.equal(ws.rowCount, DEFAULT_ROW_COUNT);
  assert.equal(ws.colCount, DEFAULT_COL_COUNT);
  assert.deepEqual(ws.cells, {});
  assert.deepEqual(ws.cellStyles, {});
  assert.deepEqual(ws.rowHeights, {});
  assert.deepEqual(ws.colWidths, {});
  assert.equal(ws.frozenRows, 0);
  assert.equal(ws.frozenCols, 0);
  assert.equal(ws.defaultRowHeight, DEFAULT_ROW_HEIGHT);
  assert.equal(ws.defaultColWidth, DEFAULT_COL_WIDTH);
  const custom = createWorksheet("id-2", "Two", 50, 8);
  assert.equal(custom.rowCount, 50);
  assert.equal(custom.colCount, 8);
});

test("AUDIT: a fresh workbook has one sheet, and it is the active one", () => {
  const wb = createWorkbook();
  assert.equal(wb.worksheets.length, 1);
  assert.equal(wb.worksheets[0].name, "Sheet1");
  assert.equal(wb.activeSheetId, wb.worksheets[0].id);
  assert.equal(activeWorksheet(wb), wb.worksheets[0]);
});

test("AUDIT: activeWorksheet falls back to the first sheet on a dangling id", () => {
  const wb = createWorkbook();
  const dangling: Workbook = { ...wb, activeSheetId: "gone" };
  assert.equal(activeWorksheet(dangling), wb.worksheets[0]);
});

/* ── 2. Single-cell writes — sparse-store invariants ──────────────────────── */

test("AUDIT: cleared and never-touched are the same stored state", () => {
  let ws = createWorksheet("s", "S");
  ws = setCellValue(ws, 2, 3, "hello");
  assert.equal(getCellValue(ws, 2, 3), "hello");
  assert.ok("D3" in ws.cells, "stored under its A1 key");

  ws = setCellValue(ws, 2, 3, "");
  assert.equal(getCellValue(ws, 2, 3), "");
  assert.equal(Object.keys(ws.cells).length, 0, "an empty value deletes the key");
  assert.equal(getCell(ws, 2, 3), undefined);
});

test("AUDIT: a no-op write returns the SAME worksheet reference", () => {
  let ws = createWorksheet("s", "S");
  assert.equal(setCellValue(ws, 0, 0, ""), ws, "clearing a cell that was never set");
  ws = setCellValue(ws, 0, 0, "v");
  assert.equal(setCellValue(ws, 0, 0, "v"), ws, "rewriting the same value");
  const styled = setCellStyleId(ws, 0, 0, 4);
  assert.equal(setCellStyleId(styled, 0, 0, 4), styled, "re-applying the same style id");
  assert.equal(setCellStyleId(ws, 5, 5, 0), ws, "resetting a never-styled cell");
});

test("AUDIT: style id 0 deletes its key — reset and never-formatted are one state", () => {
  let ws = createWorksheet("s", "S");
  ws = setCellStyleId(ws, 1, 1, 7);
  assert.equal(getCellStyleId(ws, 1, 1), 7);
  ws = setCellStyleId(ws, 1, 1, 0);
  assert.equal(getCellStyleId(ws, 1, 1), 0);
  assert.equal(Object.keys(ws.cellStyles).length, 0);
});

/* ── 3. Batch writes ──────────────────────────────────────────────────────── */

test("AUDIT: applyCellWrites applies in order — the later write to a cell wins", () => {
  let ws = createWorksheet("s", "S");
  ws = setCellValue(ws, 0, 0, "a");

  // Overwrite then restore: the final state must equal the original value.
  const restored = applyCellWrites(ws, [
    { row: 0, col: 0, value: "b" },
    { row: 0, col: 0, value: "a" },
  ]);
  assert.equal(getCellValue(restored, 0, 0), "a");

  // Write then clear: the cell must end deleted, not blank-stored.
  const cleared = applyCellWrites(ws, [
    { row: 5, col: 5, value: "x" },
    { row: 5, col: 5, value: "" },
  ]);
  assert.equal(getCellValue(cleared, 5, 5), "");
  assert.ok(!("F6" in cleared.cells), "a cleared cell stores nothing");

  // Clear then write: the write survives.
  const filled = applyCellWrites(ws, [
    { row: 0, col: 0, value: "" },
    { row: 0, col: 0, value: "z" },
  ]);
  assert.equal(getCellValue(filled, 0, 0), "z");
});

test("AUDIT: applyCellWrites leaves the input worksheet untouched and no-ops cheaply", () => {
  let ws = createWorksheet("s", "S");
  ws = setCellValue(ws, 1, 1, "keep");
  ws = setCellStyleId(ws, 1, 1, 3);
  const before = JSON.stringify(ws);

  assert.equal(applyCellWrites(ws, []), ws, "an empty batch is identity");
  assert.equal(
    applyCellWrites(ws, [{ row: 1, col: 1, value: "keep", styleId: 3 }]),
    ws,
    "an all-no-op batch is identity",
  );

  const changed = applyCellWrites(ws, [
    { row: 1, col: 1, value: "changed" },
    { row: 2, col: 2, value: "new", styleId: 5 },
  ]);
  assert.equal(JSON.stringify(ws), before, "the input worksheet is never mutated");
  assert.equal(getCellValue(ws, 1, 1), "keep");
  assert.equal(getCellValue(changed, 1, 1), "changed");
  assert.equal(getCellValue(changed, 2, 2), "new");
  assert.equal(getCellStyleId(changed, 2, 2), 5);
});

test("AUDIT: a write can carry a value, a style, or both — omitted aspects stay put", () => {
  let ws = createWorksheet("s", "S");
  ws = applyCellWrites(ws, [{ row: 0, col: 0, value: "v", styleId: 2 }]);
  assert.equal(getCellValue(ws, 0, 0), "v");
  assert.equal(getCellStyleId(ws, 0, 0), 2);

  const valueOnly = applyCellWrites(ws, [{ row: 0, col: 0, value: "w" }]);
  assert.equal(getCellStyleId(valueOnly, 0, 0), 2, "style untouched by a value-only write");

  const styleOnly = applyCellWrites(ws, [{ row: 0, col: 0, styleId: 0 }]);
  assert.equal(getCellValue(styleOnly, 0, 0), "v", "value untouched by a style-only write");
  assert.equal(getCellStyleId(styleOnly, 0, 0), 0);
});

/* ── 4. clearRect — real-spreadsheet "clear contents" ─────────────────────── */

test("AUDIT: clearRect clears values inside the rectangle only, and keeps formatting", () => {
  let ws = createWorksheet("s", "S");
  ws = setCellValue(ws, 1, 1, "in");
  ws = setCellValue(ws, 3, 3, "edge");
  ws = setCellValue(ws, 4, 4, "out");
  ws = setCellStyleId(ws, 1, 1, 6);

  const next = clearRect(ws, { top: 0, left: 0, bottom: 3, right: 3 });
  assert.equal(getCellValue(next, 1, 1), "", "inside is cleared");
  assert.equal(getCellValue(next, 3, 3), "", "the inclusive edge is cleared");
  assert.equal(getCellValue(next, 4, 4), "out", "outside survives");
  // Clearing contents does not strip formatting — the Delete-key contract.
  assert.equal(getCellStyleId(next, 1, 1), 6);

  const empty = createWorksheet("s2", "S2");
  assert.equal(clearRect(empty, { top: 0, left: 0, bottom: 9, right: 9 }), empty, "no-op is identity");
});

/* ── 5. Emptiness predicates and bounds ───────────────────────────────────── */

test("AUDIT: isFilled and filledPositions treat whitespace-only as empty", () => {
  let ws = createWorksheet("s", "S");
  ws = setCellValue(ws, 0, 0, " ");
  ws = setCellValue(ws, 1, 1, "real");
  ws = setCellValue(ws, 2, 2, "0");
  assert.equal(isFilled(ws, 0, 0), false, "a lone space is not content");
  assert.equal(isFilled(ws, 1, 1), true);
  assert.equal(isFilled(ws, 2, 2), true, "zero is content");
  assert.equal(isFilled(ws, 9, 9), false, "never touched");
  assert.deepEqual(
    filledPositions(ws).sort((a, b) => a.row - b.row),
    [
      { row: 1, col: 1 },
      { row: 2, col: 2 },
    ],
  );
});

test("AUDIT: metricsOf mirrors the worksheet's geometry fields", () => {
  let ws = createWorksheet("s", "S");
  ws = { ...ws, rowHeights: { 3: 40 }, colWidths: { 2: 160 }, hiddenRows: { 5: true } };
  const m = metricsOf(ws);
  assert.equal(m.rows, ws.rowCount);
  assert.equal(m.cols, ws.colCount);
  assert.equal(m.defaultRowHeight, ws.defaultRowHeight);
  assert.equal(m.defaultColWidth, ws.defaultColWidth);
  assert.deepEqual(m.rowHeights, { 3: 40 });
  assert.deepEqual(m.colWidths, { 2: 160 });
  assert.deepEqual(m.hiddenRows, { 5: true });
});

/* ── 6. Workbook plumbing ─────────────────────────────────────────────────── */

test("AUDIT: withActiveWorksheet swaps exactly the matching sheet", () => {
  const wb = createWorkbook();
  const edited = setCellValue(wb.worksheets[0], 0, 0, "x");
  const next = withActiveWorksheet(wb, edited);
  assert.equal(next.worksheets[0], edited);
  assert.equal(getCellValue(activeWorksheet(next), 0, 0), "x");
  assert.equal(activeWorksheet(wb).cells["A1"], undefined, "the old workbook is untouched");

  const stranger = createWorksheet("not-here", "Ghost");
  const unchanged = withActiveWorksheet(wb, stranger);
  assert.deepEqual(
    unchanged.worksheets.map((s) => s.id),
    wb.worksheets.map((s) => s.id),
    "an unknown sheet id changes nothing",
  );
});

/* ── 7. Sheet naming and uniqueness ───────────────────────────────────────── */

test("AUDIT: created sheets take the next free SheetN name, case-insensitively", () => {
  let wb = createWorkbook(); // Sheet1
  wb = createSheet(wb).workbook; // Sheet2
  assert.deepEqual(wb.worksheets.map((s) => s.name), ["Sheet1", "Sheet2"]);

  // Rename Sheet2 to "sheet3" (lower case). The next default must skip it.
  wb = renameSheet(wb, wb.worksheets[1].id, "sheet3");
  wb = createSheet(wb).workbook;
  assert.equal(wb.worksheets[2].name, "Sheet2", "the freed name is reused");
  wb = createSheet(wb).workbook;
  assert.equal(wb.worksheets[3].name, "Sheet4", "sheet3 is taken, whatever its case");
});

test("AUDIT: sheet ids are never reused while a sheet holds one", () => {
  let wb = createWorkbook(); // sheet-1
  const a = createSheet(wb); // sheet-2
  wb = a.workbook;
  const b = createSheet(wb); // sheet-3
  wb = b.workbook;
  assert.notEqual(a.sheetId, b.sheetId);
  wb = deleteSheet(wb, a.sheetId);
  const c = createSheet(wb);
  assert.notEqual(c.sheetId, b.sheetId, "a new id, not a clash with the survivor");
  assert.equal(new Set(c.workbook.worksheets.map((s) => s.id)).size, c.workbook.worksheets.length);
});

test("AUDIT: an imported sheet is re-named on collision and defaults to Imported", () => {
  let wb = createWorkbook();
  const incoming = createWorksheet("temp", "Sheet1");
  const first = addSheet(wb, incoming, "Sheet1");
  wb = first.workbook;
  assert.equal(wb.worksheets[1].name, "Sheet1 2", "a taken name gets a numeric suffix");
  const second = addSheet(wb, incoming, "   ");
  assert.equal(second.workbook.worksheets[2].name, "Imported", "a blank base name has a fallback");
  assert.notEqual(second.workbook.worksheets[2].id, "temp", "the sheet is re-ided");
});

test("AUDIT: renameSheet refuses blanks and case-insensitive collisions, and rewrites formulas", () => {
  let wb = createWorkbook();
  wb = createSheet(wb).workbook; // Sheet2
  const [one, two] = wb.worksheets;
  wb = withActiveWorksheet({ ...wb, activeSheetId: one.id }, setCellValue(one, 0, 0, "=Sheet2!B1+1"));

  assert.equal(renameSheet(wb, two.id, "   "), wb, "blank name refused");
  assert.equal(renameSheet(wb, two.id, "SHEET1"), wb, "collision refused whatever the case");

  const renamed = renameSheet(wb, two.id, "Revenue");
  assert.equal(renamed.worksheets[1].name, "Revenue");
  assert.equal(
    getCellValue(renamed.worksheets[0], 0, 0),
    "=Revenue!B1+1",
    "a formula naming the old sheet is rewritten",
  );
});

/* ── 8. Duplication — clone independence ──────────────────────────────────── */

test("AUDIT: a duplicated sheet is independent — edits to either side never leak", () => {
  let wb = createWorkbook();
  let src = activeWorksheet(wb);
  src = setCellValue(src, 0, 0, "original");
  src = setCellStyleId(src, 0, 0, 4);
  wb = withActiveWorksheet(wb, src);

  const { workbook: dup } = duplicateSheet(wb, src.id);
  const copy = dup.worksheets[1];
  assert.equal(copy.name, "Sheet1 copy");
  assert.equal(getCellValue(copy, 0, 0), "original", "content travels with the copy");

  // Edit the copy: the source must not move.
  const editedCopy = setCellValue(copy, 0, 0, "changed-in-copy");
  assert.equal(getCellValue(editedCopy, 0, 0), "changed-in-copy");
  assert.equal(getCellValue(dup.worksheets[0], 0, 0), "original");

  // Edit the source: the copy must not move.
  const editedSrc = applyCellWrites(dup.worksheets[0], [
    { row: 0, col: 0, value: "changed-in-src", styleId: 9 },
  ]);
  assert.equal(getCellValue(editedSrc, 0, 0), "changed-in-src");
  assert.equal(getCellValue(copy, 0, 0), "original");
  assert.equal(getCellStyleId(copy, 0, 0), 4);

  // A second duplicate of the same name suffixes upward.
  const again = duplicateSheet(dup, src.id);
  assert.equal(again.workbook.worksheets[1].name, "Sheet1 copy 2");
});

test("AUDIT: building a table on a duplicate never disturbs the original's rules", () => {
  const registry = new StyleRegistry();
  let wb = createWorkbook();
  let src = activeWorksheet(wb);
  src = buildTable(src, registry, templateById("task-list")!, { row: 0, col: 0 });
  wb = withActiveWorksheet(wb, src);
  const srcRules = JSON.stringify(src.validations);
  const srcFilter = JSON.stringify(src.filter);

  const { workbook: dup } = duplicateSheet(wb, src.id);
  const copy = dup.worksheets[1];
  // The copy shares the validation ARRAY by reference; a table built on the copy
  // must replace that array on the copy alone, never edit it in place.
  buildTable(copy, registry, templateById("budget")!, { row: 20, col: 0 });
  assert.equal(JSON.stringify(dup.worksheets[0].validations), srcRules);
  assert.equal(JSON.stringify(dup.worksheets[0].filter), srcFilter);
});

/* ── 9. Delete, hide, move ────────────────────────────────────────────────── */

test("AUDIT: the last sheet cannot be deleted, and deleting the active one moves next door", () => {
  let wb = createWorkbook();
  assert.equal(deleteSheet(wb, wb.worksheets[0].id), wb, "a workbook keeps at least one sheet");

  wb = createSheet(wb).workbook; // Sheet2
  wb = createSheet(wb).workbook; // Sheet3, active
  const [s1, s2, s3] = wb.worksheets;
  const afterLast = deleteSheet(wb, s3.id);
  assert.equal(afterLast.activeSheetId, s2.id, "deleting the active tail activates its neighbour");

  const midActive = switchSheet(wb, s2.id);
  const afterMid = deleteSheet(midActive, s2.id);
  assert.equal(afterMid.activeSheetId, s3.id, "deleting an active middle activates the next sheet");
  assert.deepEqual(afterMid.worksheets.map((s) => s.id), [s1.id, s3.id]);
});

test("AUDIT: hiding keeps one sheet visible and moves the selection off a hidden sheet", () => {
  let wb = createWorkbook();
  assert.equal(setSheetHidden(wb, wb.worksheets[0].id, true), wb, "the only sheet stays visible");

  wb = createSheet(wb).workbook;
  const [s1, s2] = wb.worksheets;
  const hidden = setSheetHidden(wb, s2.id, true); // s2 was active
  assert.equal(hidden.activeSheetId, s1.id, "the selection leaves the hidden sheet");
  assert.deepEqual(visibleSheets(hidden).map((s) => s.id), [s1.id]);
  assert.equal(hidden.worksheets.length, 2, "hidden is not deleted");
});

test("AUDIT: moveSheet reorders and clamps an out-of-range index", () => {
  let wb = createWorkbook();
  wb = createSheet(wb).workbook;
  wb = createSheet(wb).workbook;
  const ids = wb.worksheets.map((s) => s.id);
  const moved = moveSheet(wb, ids[0], 2);
  assert.deepEqual(moved.worksheets.map((s) => s.id), [ids[1], ids[2], ids[0]]);
  const clamped = moveSheet(wb, ids[2], 99);
  assert.deepEqual(clamped.worksheets.map((s) => s.id), [ids[0], ids[1], ids[2]].filter((x) => x !== ids[2]).concat(ids[2]));
  assert.equal(moveSheet(wb, "missing", 0), wb, "an unknown sheet moves nothing");
});
