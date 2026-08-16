import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeWorksheet,
  createWorkbook,
  getCellValue,
  setCellValue,
  withActiveWorksheet,
  type Workbook,
} from "@/lib/spreadsheet/model";
import {
  createSheet,
  deleteSheet,
  duplicateSheet,
  moveSheet,
  renameSheet,
  setSheetHidden,
  switchSheet,
  visibleSheets,
} from "@/lib/spreadsheet/workbook";
import { FormulaEngine } from "@/lib/spreadsheet/formula";

/** Put a value into a sheet (by id) within a workbook. */
function withCell(wb: Workbook, sheetId: string, row: number, col: number, value: string): Workbook {
  const sheet = wb.worksheets.find((s) => s.id === sheetId)!;
  return withActiveWorksheet(wb, setCellValue(sheet, row, col, value));
}

test("a fresh workbook has one sheet; createSheet adds and activates another", () => {
  const wb = createWorkbook();
  assert.equal(wb.worksheets.length, 1);
  assert.equal(wb.worksheets[0].name, "Sheet1");

  const { workbook: wb2, sheetId } = createSheet(wb);
  assert.equal(wb2.worksheets.length, 2);
  assert.equal(wb2.worksheets[1].name, "Sheet2");
  assert.equal(wb2.activeSheetId, sheetId);
});

test("createSheet gives unique default names, skipping taken ones", () => {
  let wb = createWorkbook(); // Sheet1
  wb = createSheet(wb).workbook; // Sheet2
  wb = renameSheet(wb, wb.worksheets[1].id, "Sheet3"); // rename Sheet2 → Sheet3
  wb = createSheet(wb).workbook; // should be Sheet2 (the free slot)
  assert.deepEqual(
    wb.worksheets.map((s) => s.name),
    ["Sheet1", "Sheet3", "Sheet2"],
  );
});

test("deleteSheet removes a sheet; the last one cannot be deleted", () => {
  let wb = createWorkbook();
  const { workbook, sheetId } = createSheet(wb);
  wb = workbook;
  wb = deleteSheet(wb, sheetId);
  assert.equal(wb.worksheets.length, 1);
  // Deleting the last remaining sheet is a no-op.
  assert.equal(deleteSheet(wb, wb.worksheets[0].id).worksheets.length, 1);
});

test("deleteSheet moves the active selection off the deleted sheet", () => {
  let wb = createWorkbook();
  wb = createSheet(wb).workbook; // active = Sheet2
  const activeId = wb.activeSheetId;
  wb = deleteSheet(wb, activeId);
  assert.notEqual(wb.activeSheetId, activeId);
  assert.ok(wb.worksheets.some((s) => s.id === wb.activeSheetId));
});

test("renameSheet rewrites cross-sheet formulas across the workbook", () => {
  let wb = createWorkbook(); // Sheet1
  const sheet2 = createSheet(wb);
  wb = sheet2.workbook; // Sheet1 + Sheet2
  // Sheet1!B1 = =Sheet2!A1
  wb = withCell(wb, wb.worksheets[0].id, 0, 1, "=Sheet2!A1");

  wb = renameSheet(wb, sheet2.sheetId, "Revenue");
  assert.equal(wb.worksheets[1].name, "Revenue");
  assert.equal(getCellValue(wb.worksheets[0], 0, 1), "=Revenue!A1");
});

test("renameSheet rejects a blank or colliding name", () => {
  let wb = createWorkbook();
  wb = createSheet(wb).workbook; // Sheet1, Sheet2
  const id2 = wb.worksheets[1].id;
  assert.equal(renameSheet(wb, id2, "   ").worksheets[1].name, "Sheet2"); // blank ignored
  assert.equal(renameSheet(wb, id2, "Sheet1").worksheets[1].name, "Sheet2"); // collision ignored
});

test("duplicateSheet copies cells and formatting into a new, uniquely-named sheet", () => {
  let wb = createWorkbook();
  wb = withCell(wb, wb.worksheets[0].id, 0, 0, "hello");
  const { workbook, sheetId } = duplicateSheet(wb, wb.worksheets[0].id);
  wb = workbook;
  assert.equal(wb.worksheets.length, 2);
  assert.equal(wb.worksheets[1].name, "Sheet1 copy");
  assert.equal(getCellValue(wb.worksheets[1], 0, 0), "hello");
  // A copy is independent: editing it does not touch the original.
  const edited = withActiveWorksheet(wb, setCellValue(wb.worksheets[1], 0, 0, "changed"));
  assert.equal(getCellValue(edited.worksheets[0], 0, 0), "hello");
  assert.equal(sheetId, wb.worksheets[1].id);
});

test("moveSheet reorders the tabs", () => {
  let wb = createWorkbook();
  wb = createSheet(wb).workbook; // Sheet1, Sheet2
  wb = createSheet(wb).workbook; // Sheet1, Sheet2, Sheet3
  const third = wb.worksheets[2].id;
  wb = moveSheet(wb, third, 0);
  assert.deepEqual(
    wb.worksheets.map((s) => s.name),
    ["Sheet3", "Sheet1", "Sheet2"],
  );
});

test("hide/unhide a sheet; at least one stays visible", () => {
  let wb = createWorkbook();
  wb = createSheet(wb).workbook; // Sheet1, Sheet2 (active Sheet2)
  const id2 = wb.worksheets[1].id;
  wb = setSheetHidden(wb, id2, true);
  assert.equal(visibleSheets(wb).length, 1);
  assert.notEqual(wb.activeSheetId, id2); // hiding the active sheet moves focus
  // Cannot hide the only visible sheet.
  const only = wb.worksheets.find((s) => !s.hidden)!.id;
  assert.equal(visibleSheets(setSheetHidden(wb, only, true)).length, 1);
  // Unhide brings it back.
  wb = setSheetHidden(wb, id2, false);
  assert.equal(visibleSheets(wb).length, 2);
});

test("switchSheet sets the active sheet, ignoring unknown ids", () => {
  let wb = createWorkbook();
  wb = createSheet(wb).workbook;
  const id0 = wb.worksheets[0].id;
  wb = switchSheet(wb, id0);
  assert.equal(activeWorksheet(wb).id, id0);
  assert.equal(switchSheet(wb, "nope").activeSheetId, id0);
});

/* --- Cross-sheet formulas and dependencies, at the engine level ---------- */

test("the engine resolves cross-sheet references and tracks their dependencies", () => {
  const e = new FormulaEngine();
  e.syncSheets([
    { id: "s1", name: "Sheet1" },
    { id: "s2", name: "Sheet2" },
  ]);
  e.setCell("s2", 0, 0, "10"); // Sheet2!A1
  e.setCell("s1", 0, 0, "=Sheet2!A1");
  assert.equal(e.display("s1", 0, 0).text, "10");

  // A cross-sheet dependency: changing Sheet2!A1 recomputes Sheet1's formula.
  e.setCell("s2", 0, 0, "42");
  assert.equal(e.display("s1", 0, 0).text, "42");
});

test("the engine sums a cross-sheet range", () => {
  const e = new FormulaEngine();
  e.syncSheets([
    { id: "s1", name: "Sheet1" },
    { id: "s2", name: "Sheet2" },
  ]);
  e.setCell("s2", 0, 0, "1");
  e.setCell("s2", 1, 0, "2");
  e.setCell("s2", 2, 0, "3");
  e.setCell("s1", 0, 0, "=SUM(Sheet2!A1:A3)");
  assert.equal(e.display("s1", 0, 0).text, "6");
});

test("a quoted sheet name with spaces resolves; a missing sheet is #REF!", () => {
  const e = new FormulaEngine();
  e.syncSheets([
    { id: "s1", name: "Sheet1" },
    { id: "s3", name: "Sales Data" },
  ]);
  e.setCell("s3", 0, 0, "99");
  e.setCell("s1", 0, 0, "='Sales Data'!A1");
  assert.equal(e.display("s1", 0, 0).text, "99");

  e.setCell("s1", 1, 0, "=Nope!A1");
  assert.equal(e.display("s1", 1, 0).text, "#REF!");
});
