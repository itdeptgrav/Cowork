/**
 * Structural-rewrite audit — what formulas become when rows/columns are
 * inserted or deleted before, at, after, and THROUGH referenced cells and
 * ranges, plus cell-block (region) shifts and the cross-sheet cases.
 *
 * Expected values are Google Sheets' / Excel's.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  transformRegionShift,
  transformStructural,
  type RegionShiftOp,
  type StructuralOp,
} from "@/lib/spreadsheet/formula/rewrite";
import { createWorkbook, createWorksheet } from "@/lib/spreadsheet/model";
import { deleteRows, deleteRowsWorkbook } from "@/lib/spreadsheet/structure";
import { createSheet } from "@/lib/spreadsheet/workbook";

const rowInsert = (at: number, count = 1): StructuralOp => ({ axis: "row", at, count, mode: "insert" });
const rowDelete = (at: number, count = 1): StructuralOp => ({ axis: "row", at, count, mode: "delete" });
const colInsert = (at: number, count = 1): StructuralOp => ({ axis: "col", at, count, mode: "insert" });
const colDelete = (at: number, count = 1): StructuralOp => ({ axis: "col", at, count, mode: "delete" });

/* ── Deleting through ranges ──────────────────────────────────────────────── */

test("AUDIT: deleting a middle row contracts a range by one", () => {
  // =SUM(A1:A5), delete row 3 → =SUM(A1:A4)  (the classic case)
  assert.equal(transformStructural("=SUM(A1:A5)", rowDelete(2)), "=SUM(A1:A4)");
});

test("AUDIT: deleting the first or last row of a range contracts it", () => {
  assert.equal(transformStructural("=SUM(A2:A5)", rowDelete(1)), "=SUM(A2:A4)", "first row");
  assert.equal(transformStructural("=SUM(A2:A5)", rowDelete(4)), "=SUM(A2:A4)", "last row");
});

test("AUDIT: a deletion overlapping a range edge keeps only the survivors", () => {
  // Rows 1-4 deleted from A3:A6 → original rows 5,6 land at rows 1,2.
  assert.equal(transformStructural("=SUM(A3:A6)", rowDelete(0, 4)), "=SUM(A1:A2)");
  // Rows 5-9 deleted from A3:A6 → original rows 3,4 stay put.
  assert.equal(transformStructural("=SUM(A3:A6)", rowDelete(4, 5)), "=SUM(A3:A4)");
});

test("AUDIT: deleting a range entirely is #REF!", () => {
  assert.equal(transformStructural("=SUM(A3:A6)", rowDelete(2, 4)), "=SUM(#REF!)", "exact span");
  assert.equal(transformStructural("=SUM(A3:A6)", rowDelete(1, 6)), "=SUM(#REF!)", "superset span");
});

test("AUDIT: single references around a multi-row deletion", () => {
  const op = rowDelete(2, 2); // delete rows 3-4
  assert.equal(transformStructural("=A2", op), "=A2", "before: untouched");
  assert.equal(transformStructural("=A3", op), "=#REF!", "inside: gone");
  assert.equal(transformStructural("=A4", op), "=#REF!", "inside: gone");
  assert.equal(transformStructural("=A5", op), "=A3", "after: shifts up by the count");
});

/* ── Inserting around ranges ──────────────────────────────────────────────── */

test("AUDIT: inserting above a range shifts it whole; inside or at its end grows it", () => {
  assert.equal(transformStructural("=SUM(A2:A4)", rowInsert(0)), "=SUM(A3:A5)", "above → shift");
  assert.equal(transformStructural("=SUM(A2:A4)", rowInsert(1)), "=SUM(A3:A5)", "at the first row → shift");
  assert.equal(transformStructural("=SUM(A2:A4)", rowInsert(2)), "=SUM(A2:A5)", "inside → grow");
  assert.equal(transformStructural("=SUM(A2:A4)", rowInsert(3)), "=SUM(A2:A5)", "at the last row → grow");
  assert.equal(transformStructural("=SUM(A2:A4)", rowInsert(4)), "=SUM(A2:A4)", "just below → untouched");
});

test("AUDIT: a multi-line insert shifts by its whole count, absolutes included", () => {
  assert.equal(transformStructural("=A1+$A$2", rowInsert(0, 3)), "=A4+$A$5");
  assert.equal(transformStructural("=SUM($B$1:B3)", colInsert(0, 2)), "=SUM($D$1:D3)");
});

/* ── Columns, letters and anchors ─────────────────────────────────────────── */

test("AUDIT: column ops cross the Z/AA boundary correctly", () => {
  assert.equal(transformStructural("=Z1+SUM(X1:Z1)", colInsert(0)), "=AA1+SUM(Y1:AA1)");
  assert.equal(transformStructural("=AA1", colDelete(0)), "=Z1");
});

test("AUDIT: column delete through a range contracts it", () => {
  assert.equal(transformStructural("=SUM(B1:D1)", colDelete(2)), "=SUM(B1:C1)");
  assert.equal(transformStructural("=SUM(B1:C1)", colDelete(1, 2)), "=SUM(#REF!)");
});

test("AUDIT: each endpoint keeps its own $ anchors through a structural op", () => {
  assert.equal(transformStructural("=SUM($A$2:A$5)", rowDelete(2)), "=SUM($A$2:A$4)");
  assert.equal(transformStructural("=$A$1", rowDelete(0)), "=#REF!", "an absolute ref can still die");
});

/* ── Pass-through fidelity ────────────────────────────────────────────────── */

test("AUDIT: strings, numbers and error literals pass through a rewrite", () => {
  assert.equal(
    transformStructural('=IF(A3>0,"A3",#REF!+1e3)', rowInsert(0)),
    '=IF(A4>0,"A3",#REF!+1e3)',
  );
  assert.equal(transformStructural('=LEN("a""b")+A2', rowDelete(0)), '=LEN("a""b")+A1');
  assert.equal(transformStructural("hello", rowInsert(0)), "hello", "a non-formula is untouched");
  assert.equal(transformStructural("=A1@", rowInsert(0)), "=A1@", "an untokenizable formula is untouched");
});

test("AUDIT: whitespace the author typed survives a rewrite", () => {
  // Sheets keeps "=A1 + A2" spaced as written when a row insert renumbers it —
  // the re-emitter works from each token's source slice, so everything that is
  // not a rewritten reference comes back exactly as written.
  assert.equal(transformStructural("=A1 + A2", rowInsert(0)), "=A2 + A3");
  assert.equal(
    transformStructural('=IF( A1 > 0 , "x" , SUM( A2:A3 ) )', rowInsert(0)),
    '=IF( A2 > 0 , "x" , SUM( A3:A4 ) )',
  );
});

/* ── Cross-sheet structural rewrites ──────────────────────────────────────── */

test("AUDIT: a qualified reference to ANOTHER sheet is untouched by this sheet's edit", () => {
  // Correct: the op is on the formula's own sheet; Sheet2's rows did not move.
  assert.equal(
    transformStructural("=Sheet2!A5+A5", rowDelete(0)),
    "=Sheet2!A5+A4",
  );
  assert.equal(
    transformStructural("='Sales Data'!A1:B2+SUM(A2:A3)", rowInsert(0)),
    "='Sales Data'!A1:B2+SUM(A3:A4)",
  );
});

test("AUDIT: a self-qualified reference follows a structural edit on its own sheet", () => {
  // A formula on Sheet1 may spell its own sheet out: =Sheet1!A5. Deleting row 3
  // of Sheet1 moves that data to A4, and Sheets rewrites the reference — the
  // qualifier does not exempt it.
  const ws = createWorksheet("sheet-1", "Sheet1");
  ws.cells["A5"] = { value: "10" };
  ws.cells["B1"] = { value: "=Sheet1!A5" };
  ws.cells["C1"] = { value: "=A5" };
  const next = deleteRows(ws, 2, 1);
  assert.equal(next.cells["C1"].value, "=A4", "the unqualified twin is rewritten");
  assert.equal(next.cells["B1"].value, "=Sheet1!A4");
});

test("AUDIT: another sheet's references INTO the edited sheet are rewritten", () => {
  // Sheets: deleting a row on Sheet1 rewrites =Sheet1!A3 everywhere in the
  // workbook — other sheets' formulas follow the moved data (or gain #REF!).
  const base = createWorkbook(); // sheet-1 "Sheet1"
  const { workbook: wb } = createSheet(base); // + sheet-2 "Sheet2"
  wb.worksheets[0].cells["A3"] = { value: "10" };
  wb.worksheets[0].cells["B1"] = { value: "=A3" };
  wb.worksheets[1].cells["A1"] = { value: "=Sheet1!A3" };
  wb.worksheets[1].cells["B1"] = { value: "=A3" };

  // The workbook-level operation — what "delete row 2 of Sheet1" must run so
  // every sheet's formulas keep naming the same data.
  const after = deleteRowsWorkbook(wb, "sheet-1", 1, 1);

  assert.equal(after.worksheets[0].cells["B1"].value, "=A2", "on-sheet formula follows");
  assert.equal(after.worksheets[1].cells["A1"].value, "=Sheet1!A2");
  assert.equal(
    after.worksheets[1].cells["B1"].value,
    "=A3",
    "Sheet2's bare refs point at Sheet2 — its own rows did not move",
  );
});

test("AUDIT: a workbook delete turns other sheets' refs into the cut to #REF!", () => {
  const base = createWorkbook();
  const { workbook: wb } = createSheet(base);
  wb.worksheets[1].cells["A1"] = { value: "=Sheet1!A2+SUM(Sheet1!A1:A9)" };
  const after = deleteRowsWorkbook(wb, "sheet-1", 1, 1);
  assert.equal(
    after.worksheets[1].cells["A1"].value,
    "=#REF!+SUM(Sheet1!A1:A8)",
    "a dead qualified ref is #REF!; a qualified range contracts",
  );
});

/* ── Region (cell-block) shifts ───────────────────────────────────────────── */

const downInsert: RegionShiftOp = {
  rect: { top: 1, left: 1, bottom: 2, right: 2 }, // B2:C3
  axis: "row",
  mode: "insert",
};
const upDelete: RegionShiftOp = {
  rect: { top: 1, left: 1, bottom: 2, right: 2 }, // B2:C3
  axis: "row",
  mode: "delete",
};

test("AUDIT: inserting a block shifts only references in its band", () => {
  assert.equal(transformRegionShift("=B5", downInsert), "=B7", "in band, below → moves");
  assert.equal(transformRegionShift("=B1", downInsert), "=B1", "in band, above → stays");
  assert.equal(transformRegionShift("=A5", downInsert), "=A5", "left of band → stays");
  assert.equal(transformRegionShift("=D5", downInsert), "=D5", "right of band → stays");
});

test("AUDIT: a range wholly inside the band moves; a straddling range is left alone", () => {
  assert.equal(transformRegionShift("=SUM(B2:B9)", downInsert), "=SUM(B4:B11)");
  assert.equal(
    transformRegionShift("=SUM(A2:B9)", downInsert),
    "=SUM(A2:B9)",
    "covers moved and unmoved cells — deliberately untouched",
  );
});

test("AUDIT: deleting a block #REF!s references into it and closes the gap", () => {
  assert.equal(transformRegionShift("=B2", upDelete), "=#REF!");
  assert.equal(transformRegionShift("=C3", upDelete), "=#REF!");
  assert.equal(transformRegionShift("=B5", upDelete), "=B3");
  assert.equal(transformRegionShift("=SUM(B2:B3)", upDelete), "=SUM(#REF!)", "fully deleted");
  assert.equal(transformRegionShift("=SUM(B2:B9)", upDelete), "=SUM(B2:B7)", "contracts");
});

test("AUDIT: a horizontal block shift moves only its row band", () => {
  const rightInsert: RegionShiftOp = {
    rect: { top: 1, left: 1, bottom: 2, right: 2 },
    axis: "col",
    mode: "insert",
  };
  assert.equal(transformRegionShift("=E2", rightInsert), "=G2", "in the row band → moves right");
  assert.equal(transformRegionShift("=E5", rightInsert), "=E5", "outside the row band → stays");
});
