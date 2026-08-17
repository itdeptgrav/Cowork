import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorksheet,
  getCellStyleId,
  getCellValue,
  setCellStyleId,
  setCellValue,
  type Worksheet,
} from "@/lib/spreadsheet/model";
import { rowHeight } from "@/lib/spreadsheet/metrics";
import { metricsOf } from "@/lib/spreadsheet/model";
import {
  deleteCols,
  deleteRows,
  freezeCols,
  freezeRows,
  insertCols,
  insertRows,
  shiftCells,
  setColsHidden,
  setRowHeight,
  setRowsHidden,
} from "@/lib/spreadsheet/structure";

function sheet(cells: Record<string, string>): Worksheet {
  let ws = createWorksheet("s", "Sheet1");
  for (const [ref, value] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    const col = m[1].charCodeAt(0) - 65;
    const row = Number(m[2]) - 1;
    ws = setCellValue(ws, row, col, value);
  }
  return ws;
}

test("insert row: cells below shift down and formulas stay semantically correct", () => {
  // The spec's example: A1=10, A2=20, B1==A1+A2. Insert a row above row 1.
  const ws = sheet({ A1: "10", A2: "20", B1: "=A1+A2" });
  const next = insertRows(ws, 0, 1);
  // Row 1 (index 0) is now blank; the data moved down one.
  assert.equal(getCellValue(next, 0, 0), "");
  assert.equal(getCellValue(next, 1, 0), "10"); // A2
  assert.equal(getCellValue(next, 2, 0), "20"); // A3
  // The formula moved to B2 and still names the same two values.
  assert.equal(getCellValue(next, 1, 1), "=A2+A3");
});

test("insert row below a selection places the blank line after it", () => {
  const ws = sheet({ A1: "x", A2: "y" });
  const next = insertRows(ws, 1, 1); // insert at index 1 (below row 1)
  assert.equal(getCellValue(next, 0, 0), "x");
  assert.equal(getCellValue(next, 1, 0), "");
  assert.equal(getCellValue(next, 2, 0), "y");
});

test("delete row: cells below shift up and references to it become #REF!", () => {
  const ws = sheet({ A1: "10", A2: "20", A3: "30", B1: "=A2" });
  const next = deleteRows(ws, 1, 1); // delete row 2 (index 1)
  assert.equal(getCellValue(next, 0, 0), "10");
  assert.equal(getCellValue(next, 1, 0), "30"); // A3 moved up to A2
  assert.equal(getCellValue(next, 0, 1), "=#REF!"); // B1 pointed at the deleted A2
});

test("insert column: cells shift right and column references follow", () => {
  const ws = sheet({ A1: "10", B1: "=A1*2" });
  const next = insertCols(ws, 0, 1); // insert a column to the left of A
  assert.equal(getCellValue(next, 0, 0), ""); // new blank column A
  assert.equal(getCellValue(next, 0, 1), "10"); // A1 → B1
  assert.equal(getCellValue(next, 0, 2), "=B1*2"); // B1 → C1, ref A1 → B1
});

test("delete column: cells shift left and references update", () => {
  const ws = sheet({ A1: "1", B1: "2", C1: "=B1" });
  const next = deleteCols(ws, 0, 1); // delete column A
  assert.equal(getCellValue(next, 0, 0), "2"); // B1 → A1
  assert.equal(getCellValue(next, 0, 1), "=A1"); // C1 → B1, ref B1 → A1
});

test("styles shift with their cells on a structural edit", () => {
  let ws = sheet({ A1: "x" });
  ws = setCellStyleId(ws, 0, 0, 5);
  const next = insertRows(ws, 0, 1);
  assert.equal(getCellStyleId(next, 0, 0), 0); // the new blank row
  assert.equal(getCellStyleId(next, 1, 0), 5); // the style moved with A1 → A2
});

test("resize sets an override; the default height drops it", () => {
  const ws = createWorksheet("s", "Sheet1");
  const tall = setRowHeight(ws, 3, 40);
  assert.equal(rowHeight(metricsOf(tall), 3), 40);
  const reset = setRowHeight(tall, 3, tall.defaultRowHeight);
  assert.equal(3 in reset.rowHeights, false, "resetting to default removes the override");
});

test("resize overrides shift with a structural edit", () => {
  let ws = createWorksheet("s", "Sheet1");
  ws = setRowHeight(ws, 2, 50);
  const next = insertRows(ws, 0, 1);
  assert.equal(rowHeight(metricsOf(next), 2), next.defaultRowHeight);
  assert.equal(rowHeight(metricsOf(next), 3), 50); // the override moved down with the row
});

test("hide/show a range of rows, reflected as zero height", () => {
  const ws = createWorksheet("s", "Sheet1");
  const hidden = setRowsHidden(ws, 2, 4, true);
  assert.equal(rowHeight(metricsOf(hidden), 3), 0);
  const shown = setRowsHidden(hidden, 2, 4, false);
  assert.equal(rowHeight(metricsOf(shown), 3), shown.defaultRowHeight);
});

test("hidden columns survive a structural shift", () => {
  let ws = createWorksheet("s", "Sheet1");
  ws = setColsHidden(ws, 1, 1, true); // hide column B
  const next = insertCols(ws, 0, 1); // insert a column at the left
  assert.equal(next.hiddenCols[1], undefined, "old B no longer hidden");
  assert.equal(next.hiddenCols[2], true, "the hidden column moved from index 1 to 2");
});

test("freeze counts are set, cleared and clamped", () => {
  const ws = createWorksheet("s", "Sheet1");
  assert.equal(freezeRows(ws, 2).frozenRows, 2);
  assert.equal(freezeRows(ws, 0).frozenRows, 0);
  assert.equal(freezeCols(ws, 3).frozenCols, 3);
  assert.equal(freezeRows(ws, 99999).frozenRows, ws.rowCount);
});

test("inserting within the frozen band grows the freeze; deleting shrinks it", () => {
  let ws = createWorksheet("s", "Sheet1");
  ws = freezeRows(ws, 2); // rows 0,1 frozen
  assert.equal(insertRows(ws, 0, 1).frozenRows, 3); // inserted within → grows
  assert.equal(insertRows(ws, 5, 1).frozenRows, 2); // inserted below → unchanged
  assert.equal(deleteRows(ws, 0, 1).frozenRows, 1); // deleted one frozen row → shrinks
});

/* ── Cell-block shifts (Insert ▸ Cells) ───────────────────────────────────── */

test("inserting cells with a downward shift moves only the block's own columns", () => {
  const ws = sheet({ A1: "keep", B1: "b1", B2: "b2", C1: "c1" });
  // Insert one cell at B1, pushing column B down. A and C must not move.
  const next = shiftCells(ws, { top: 0, left: 1, bottom: 0, right: 1 }, "down");
  assert.equal(getCellValue(next, 0, 0), "keep", "column A is outside the band");
  assert.equal(getCellValue(next, 0, 2), "c1", "column C is outside the band");
  assert.equal(getCellValue(next, 0, 1), "", "B1 is now empty");
  assert.equal(getCellValue(next, 1, 1), "b1", "B1 moved to B2");
  assert.equal(getCellValue(next, 2, 1), "b2", "B2 moved to B3");
});

test("deleting cells with an upward shift drops the block and closes the gap", () => {
  const ws = sheet({ A1: "a1", B1: "b1", B2: "b2", B3: "b3" });
  const next = shiftCells(ws, { top: 0, left: 1, bottom: 0, right: 1 }, "up");
  assert.equal(getCellValue(next, 0, 0), "a1", "column A untouched");
  assert.equal(getCellValue(next, 0, 1), "b2", "B2 moved up into B1");
  assert.equal(getCellValue(next, 1, 1), "b3", "B3 moved up into B2");
  assert.equal(getCellValue(next, 2, 1), "", "the tail is now empty");
});

test("a rightward shift moves only the block's own rows", () => {
  const ws = sheet({ A1: "a1", B1: "b1", A2: "a2", B2: "b2" });
  const next = shiftCells(ws, { top: 0, left: 0, bottom: 0, right: 0 }, "right");
  assert.equal(getCellValue(next, 0, 1), "a1", "A1 moved right into B1");
  assert.equal(getCellValue(next, 0, 2), "b1", "B1 moved right into C1");
  assert.equal(getCellValue(next, 1, 0), "a2", "row 2 is outside the band");
  assert.equal(getCellValue(next, 1, 1), "b2", "row 2 is outside the band");
});

test("styles travel with the cells they belong to", () => {
  let ws = sheet({ B1: "b1" });
  ws = setCellStyleId(ws, 0, 1, 7);
  ws = setCellStyleId(ws, 0, 0, 3);
  const next = shiftCells(ws, { top: 0, left: 1, bottom: 0, right: 1 }, "down");
  assert.equal(getCellStyleId(next, 1, 1), 7, "B1's style moved with it to B2");
  assert.equal(getCellStyleId(next, 0, 0), 3, "A1's style did not move");
});

test("a formula inside the band follows its data; one outside it does not", () => {
  const ws = sheet({ B1: "10", B5: "=B1", A5: "=B1" });
  const next = shiftCells(ws, { top: 0, left: 1, bottom: 0, right: 1 }, "down");
  // B5 itself moved to B6, and its reference followed B1 down to B2.
  assert.equal(getCellValue(next, 5, 1), "=B2", "the in-band formula moved and re-pointed");
  // A5 did not move — but it still points at data that did.
  assert.equal(getCellValue(next, 4, 0), "=B2", "the out-of-band formula re-pointed too");
});

test("a range straddling the band's edge is left exactly as written", () => {
  const ws = sheet({ D1: "=SUM(A1:C1)", E1: "=SUM(B1:B4)" });
  const next = shiftCells(ws, { top: 0, left: 1, bottom: 0, right: 1 }, "down");
  assert.equal(
    getCellValue(next, 0, 3),
    "=SUM(A1:C1)",
    "A1:C1 spans columns that move and columns that do not — no rectangle describes the result",
  );
  assert.equal(
    getCellValue(next, 0, 4),
    "=SUM(B2:B5)",
    "B1:B4 lies wholly inside the band, so it follows",
  );
});

test("a reference into deleted cells becomes #REF!", () => {
  const ws = sheet({ B1: "10", D1: "=B1" });
  const next = shiftCells(ws, { top: 0, left: 1, bottom: 0, right: 1 }, "up");
  assert.equal(getCellValue(next, 0, 3), "=#REF!");
});
