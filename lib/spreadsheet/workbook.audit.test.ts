/**
 * Workbook-operations audit — sheet create/rename/delete/duplicate/move/hide
 * invariants, the formula-rewrite on rename, and id/name uniqueness under
 * adversarial sequences.
 *
 * Assertions state CORRECT behaviour; failures are tagged `// BUG(...)`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkbook, getCellValue, setCellValue, type Workbook } from "@/lib/spreadsheet/model";
import { csvToWorksheet } from "@/lib/spreadsheet/csvio";
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

function names(wb: Workbook): string[] {
  return wb.worksheets.map((s) => s.name);
}

test("AUDIT: default names fill gaps and ids are never reused by live sheets", () => {
  let wb = createWorkbook(); // Sheet1 / sheet-1
  wb = createSheet(wb).workbook; // Sheet2 / sheet-2
  wb = createSheet(wb).workbook; // Sheet3 / sheet-3
  wb = deleteSheet(wb, "sheet-2"); // Sheet2's NAME is free again
  const { workbook, sheetId } = createSheet(wb);
  assert.equal(workbook.worksheets.find((s) => s.id === sheetId)!.name, "Sheet2", "the freed name is refilled");
  assert.equal(
    new Set(workbook.worksheets.map((s) => s.id)).size,
    workbook.worksheets.length,
    "ids stay unique",
  );
});

test("AUDIT: the last sheet cannot be deleted; deleting the active one activates a neighbour", () => {
  let wb = createWorkbook();
  assert.equal(deleteSheet(wb, "sheet-1"), wb, "the only sheet is undeletable");

  wb = createSheet(wb).workbook; // sheet-2 active
  wb = createSheet(wb).workbook; // sheet-3 active
  wb = switchSheet(wb, "sheet-2");
  wb = deleteSheet(wb, "sheet-2");
  assert.deepEqual(names(wb), ["Sheet1", "Sheet3"]);
  assert.equal(wb.activeSheetId, "sheet-3", "the sheet that took its place becomes active");

  // Deleting the LAST sheet while it is active activates the new last.
  wb = switchSheet(wb, "sheet-3");
  wb = deleteSheet(wb, "sheet-3");
  assert.equal(wb.activeSheetId, "sheet-1");
});

test("AUDIT: rename rewrites references in EVERY sheet, including the renamed one", () => {
  let wb = createWorkbook();
  wb = createSheet(wb).workbook; // Sheet2
  let s1 = wb.worksheets[0];
  s1 = setCellValue(s1, 0, 0, "=Sheet2!A1+1");
  let s2 = wb.worksheets[1];
  s2 = setCellValue(s2, 0, 0, "5");
  s2 = setCellValue(s2, 1, 0, "=Sheet2!A1*2"); // self-reference by name
  wb = { ...wb, worksheets: [s1, s2] };

  wb = renameSheet(wb, "sheet-2", "Revenue");
  assert.equal(getCellValue(wb.worksheets[0], 0, 0), "=Revenue!A1+1");
  assert.equal(getCellValue(wb.worksheets[1], 1, 0), "=Revenue!A1*2");
});

test("AUDIT: rename rejects blanks and case-insensitive collisions, unchanged workbook", () => {
  let wb = createWorkbook();
  wb = createSheet(wb).workbook; // Sheet2
  assert.equal(renameSheet(wb, "sheet-2", "   "), wb);
  assert.equal(renameSheet(wb, "sheet-2", "sheet1"), wb, "'sheet1' collides with 'Sheet1'");
  const recased = renameSheet(wb, "sheet-1", "SHEET1");
  assert.notEqual(recased, wb, "re-casing a sheet's OWN name is allowed");
  assert.equal(recased.worksheets[0].name, "SHEET1");
});

test("AUDIT: duplicate copies content by value — edits to the copy never leak back", () => {
  let wb = createWorkbook();
  let s1 = wb.worksheets[0];
  s1 = setCellValue(s1, 0, 0, "original");
  s1 = { ...s1, cellStyles: { A1: 4 }, rowHeights: { 0: 44 }, frozenRows: 1 };
  wb = { ...wb, worksheets: [s1] };

  const { workbook: dup, sheetId } = duplicateSheet(wb, "sheet-1");
  assert.deepEqual(names(dup), ["Sheet1", "Sheet1 copy"]);
  assert.equal(dup.activeSheetId, sheetId);

  const copy = dup.worksheets[1];
  assert.equal(getCellValue(copy, 0, 0), "original");
  assert.equal(copy.cellStyles["A1"], 4);
  assert.equal(copy.rowHeights[0], 44);
  assert.equal(copy.frozenRows, 1);

  // Mutating the copy through the model API must not touch the source's maps.
  const edited = setCellValue(copy, 0, 0, "changed");
  assert.equal(getCellValue(edited, 0, 0), "changed");
  assert.equal(getCellValue(dup.worksheets[0], 0, 0), "original");

  // Duplicating again numbers the name instead of colliding.
  const again = duplicateSheet(dup, "sheet-1").workbook;
  assert.deepEqual(names(again), ["Sheet1", "Sheet1 copy 2", "Sheet1 copy"]);
});

test("AUDIT: an imported sheet is re-ided, renamed on collision, and keeps its cells", () => {
  let wb = createWorkbook();
  wb = renameSheet(wb, "sheet-1", "Imported");
  const parsed = csvToWorksheet("csv-temp", "whatever", "a,b\nc,d");
  const { workbook, sheetId } = addSheet(wb, parsed, "Imported");
  assert.equal(sheetId, "sheet-2", "a fresh id, not the parsed sheet's temp id");
  assert.deepEqual(names(workbook), ["Imported", "Imported 2"]);
  assert.equal(getCellValue(workbook.worksheets[1], 1, 1), "d");
  assert.equal(workbook.activeSheetId, sheetId);
});

test("AUDIT: moveSheet clamps out-of-range targets and preserves the set of sheets", () => {
  let wb = createWorkbook();
  wb = createSheet(wb).workbook;
  wb = createSheet(wb).workbook; // Sheet1, Sheet2, Sheet3
  assert.deepEqual(names(moveSheet(wb, "sheet-1", 99)), ["Sheet2", "Sheet3", "Sheet1"]);
  assert.deepEqual(names(moveSheet(wb, "sheet-3", -5)), ["Sheet3", "Sheet1", "Sheet2"]);
  assert.deepEqual(names(moveSheet(wb, "sheet-2", 1)), ["Sheet1", "Sheet2", "Sheet3"], "no-op move");
  assert.equal(moveSheet(wb, "ghost", 0), wb, "an unknown id changes nothing");
});

test("AUDIT: hiding never hides the last visible sheet, and hiding the active moves selection", () => {
  let wb = createWorkbook();
  wb = createSheet(wb).workbook; // Sheet2, active
  wb = setSheetHidden(wb, "sheet-2", true);
  assert.equal(wb.worksheets[1].hidden, true);
  assert.equal(wb.activeSheetId, "sheet-1", "selection moved to the first visible sheet");
  assert.deepEqual(visibleSheets(wb).map((s) => s.name), ["Sheet1"]);

  const blocked = setSheetHidden(wb, "sheet-1", true);
  assert.equal(blocked, wb, "the last visible sheet stays visible");

  wb = setSheetHidden(wb, "sheet-2", false);
  assert.deepEqual(visibleSheets(wb).length, 2);
});

test("AUDIT: switching to a nonexistent sheet is a no-op, not a broken active id", () => {
  const wb = createWorkbook();
  assert.equal(switchSheet(wb, "sheet-404"), wb);
  assert.equal(switchSheet(wb, "sheet-1").activeSheetId, "sheet-1");
});
