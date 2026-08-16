import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkbook, setCellValue } from "@/lib/spreadsheet/model";
import { StyleRegistry } from "@/lib/spreadsheet/style";
import { serializeWorkbook, deserializeWorkbook } from "@/lib/spreadsheet/persistence";
import { exportWorkbookJson, importWorkbookJson } from "@/lib/spreadsheet/jsonio";
import type { Workbook } from "@/lib/spreadsheet/model";

function sampleWorkbook(): { wb: Workbook; registry: StyleRegistry } {
  let wb = createWorkbook();
  let ws = wb.worksheets[0];
  ws = setCellValue(ws, 0, 0, "Hello");
  ws = setCellValue(ws, 1, 0, "42");
  ws = setCellValue(ws, 2, 0, "=A2*2");
  wb = { ...wb, worksheets: [ws] };
  const registry = new StyleRegistry();
  registry.intern({ bold: true });
  return { wb, registry };
}

test("export then import round-trips a workbook", () => {
  const { wb, registry } = sampleWorkbook();
  const json = exportWorkbookJson(serializeWorkbook(wb, registry));
  const result = importWorkbookJson(json);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { workbook } = deserializeWorkbook(result.workbook);
  const back = workbook.worksheets[0];
  assert.equal(back.cells["A1"].value, "Hello");
  assert.equal(back.cells["A2"].value, "42");
  assert.equal(back.cells["A3"].value, "=A2*2");
});

test("rejects text that is not JSON without throwing", () => {
  const result = importWorkbookJson("this is not json {");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /not valid JSON/i);
});

test("rejects JSON that is not a workbook object", () => {
  assert.equal(importWorkbookJson("[1,2,3]").ok, false);
  assert.equal(importWorkbookJson("42").ok, false);
  assert.equal(importWorkbookJson('"a string"').ok, false);
});

test("rejects a workbook with no sheets", () => {
  const result = importWorkbookJson(JSON.stringify({ version: 1, sheets: [] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /no sheets/i);
});

test("normalises a sparse/partial sheet with sensible defaults", () => {
  const result = importWorkbookJson(
    JSON.stringify({ sheets: [{ name: "Only a name", cells: [{ ref: "B2", value: "x" }] }] }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.name, "Only a name");
  assert.equal(typeof sheet.id, "string");
  assert.equal(sheet.rowCount > 0, true);
  assert.equal(sheet.colCount > 0, true);
  assert.deepEqual(sheet.cells, [{ ref: "B2", value: "x" }]);
});

test("drops malformed cells and non-array styles rather than crashing", () => {
  const result = importWorkbookJson(
    JSON.stringify({
      styles: "not an array",
      sheets: [{ id: "s", name: "S", cells: [{ ref: "A1", value: "ok" }, { noRef: true }, 5, null] }],
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.workbook.styles, []);
  assert.deepEqual(result.workbook.sheets[0].cells, [{ ref: "A1", value: "ok" }]);
  // And the normalised result feeds the deserializer without throwing.
  assert.doesNotThrow(() => deserializeWorkbook(result.workbook));
});

test("falls back to the first sheet when activeSheetId is unknown", () => {
  const result = importWorkbookJson(
    JSON.stringify({ activeSheetId: "ghost", sheets: [{ id: "real", name: "R", cells: [] }] }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.workbook.activeSheetId, "real");
});
