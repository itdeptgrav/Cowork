import assert from "node:assert/strict";
import { test } from "node:test";
import { workbookToXlsx, xlsxToWorkbook } from "./xlsx.ts";
import type { Workbook } from "./grid.ts";

function workbook(sheets: Workbook["sheets"]): Workbook {
  return { sheets, activeId: sheets[0]?.id };
}

test("a multi-sheet workbook round-trips its tab names and cell values", () => {
  const wb = workbook([
    {
      id: "a",
      name: "Revenue",
      cells: { A1: "Region", B1: "Total", A2: "North", B2: "100" },
      styles: {},
      rows: 20,
      cols: 10,
    },
    {
      id: "b",
      name: "Costs",
      cells: { A1: "Item", B1: "Amount" },
      styles: {},
      rows: 20,
      cols: 10,
    },
  ]);

  const bytes = workbookToXlsx(wb);
  const back = xlsxToWorkbook(bytes);

  assert.deepEqual(back.sheets.map((s) => s.name), ["Revenue", "Costs"]);
  assert.equal(back.sheets[0].cells.A1, "Region");
  assert.equal(back.sheets[0].cells.B1, "Total");
  assert.equal(back.sheets[0].cells.A2, "North");
  assert.equal(back.sheets[0].cells.B2, "100");
  assert.equal(back.sheets[1].cells.A1, "Item");
  assert.equal(back.sheets[1].cells.B1, "Amount");
});

test("a formula survives the round trip as a formula, not a frozen value", () => {
  const wb = workbook([
    {
      id: "a",
      name: "Sheet1",
      cells: { A1: "10", A2: "20", A3: "=SUM(A1:A2)" },
      styles: {},
      rows: 20,
      cols: 10,
    },
  ]);

  const back = xlsxToWorkbook(workbookToXlsx(wb));
  const written = back.sheets[0].cells.A3;
  assert.ok(written?.startsWith("="), `expected a formula, got ${JSON.stringify(written)}`);
  assert.equal(written, "=SUM(A1:A2)");
});

test("an empty workbook still produces a readable file with one blank sheet", () => {
  const wb = workbook([{ id: "a", name: "Sheet1", cells: {}, styles: {}, rows: 20, cols: 10 }]);
  const back = xlsxToWorkbook(workbookToXlsx(wb));
  assert.equal(back.sheets.length, 1);
  assert.deepEqual(back.sheets[0].cells, {});
});

test("a number format round-trips through the cell's format code", () => {
  const wb = workbook([
    {
      id: "a",
      name: "Sheet1",
      cells: { A1: "1234.5" },
      styles: { A1: { format: "percent" } },
      rows: 20,
      cols: 10,
    },
  ]);
  const back = xlsxToWorkbook(workbookToXlsx(wb));
  assert.equal(back.sheets[0].styles.A1?.format, "percent");
});
