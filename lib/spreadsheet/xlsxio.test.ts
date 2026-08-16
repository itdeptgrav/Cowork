import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorksheet, setCellValue, type Workbook } from "@/lib/spreadsheet/model";
import { StyleRegistry } from "@/lib/spreadsheet/style";
import { workbookToXlsx, xlsxToWorkbook } from "@/lib/spreadsheet/xlsxio";

function twoSheetWorkbook(): { wb: Workbook; registry: StyleRegistry } {
  let a = createWorksheet("sheet-1", "Sales");
  a = setCellValue(a, 0, 0, "Item");
  a = setCellValue(a, 0, 1, "Price");
  a = setCellValue(a, 1, 0, "Apple");
  a = setCellValue(a, 1, 1, "1.5");
  a = setCellValue(a, 2, 1, "=B2*2"); // a formula

  let b = createWorksheet("sheet-2", "Notes");
  b = setCellValue(b, 0, 0, "Hello, world");

  return { wb: { worksheets: [a, b], activeSheetId: "sheet-1" }, registry: new StyleRegistry() };
}

test("round-trips values, a formula, multiple sheets and sheet names", () => {
  const { wb, registry } = twoSheetWorkbook();
  const bytes = workbookToXlsx(wb, registry);
  assert.ok(bytes && (bytes as ArrayBuffer).byteLength > 0);

  const result = xlsxToWorkbook(bytes);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { sheets } = result.workbook;
  assert.equal(sheets.length, 2);
  assert.deepEqual(sheets.map((s) => s.name), ["Sales", "Notes"]);

  const sales = sheets[0];
  const byRef = Object.fromEntries(sales.cells.map((c) => [c.ref, c.value]));
  assert.equal(byRef["A1"], "Item");
  assert.equal(byRef["A2"], "Apple");
  assert.equal(byRef["B2"], "1.5"); // number preserved
  assert.equal(byRef["B3"], "=B2*2"); // formula preserved (leading =)

  assert.equal(
    Object.fromEntries(sheets[1].cells.map((c) => [c.ref, c.value]))["A1"],
    "Hello, world",
  );
});

test("preserves a number format kind through the round trip", () => {
  const registry = new StyleRegistry();
  const styleId = registry.intern({ numberFormat: { kind: "percent" } });
  let ws = createWorksheet("sheet-1", "S");
  ws = setCellValue(ws, 0, 0, "0.25");
  ws = { ...ws, cellStyles: { A1: styleId } };
  const wb: Workbook = { worksheets: [ws], activeSheetId: "sheet-1" };

  const result = xlsxToWorkbook(workbookToXlsx(wb, registry));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const sheet = result.workbook.sheets[0];
  const cell = sheet.cells.find((c) => c.ref === "A1");
  assert.ok(cell);
  // The style id maps into the returned style table as a percent format.
  const style = cell!.style !== undefined ? result.workbook.styles[cell!.style] : undefined;
  assert.equal(style?.numberFormat?.kind, "percent");
});

test("arbitrary junk never throws — it returns a result to handle", () => {
  const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  let result: ReturnType<typeof xlsxToWorkbook> | undefined;
  assert.doesNotThrow(() => {
    result = xlsxToWorkbook(junk);
  });
  assert.equal(typeof result!.ok, "boolean");
});

test("a corrupt XLSX (ZIP magic, junk body) returns an error, not a crash", () => {
  // "PK\x03\x04" is the ZIP local-file header xlsx begins with; the rest is
  // garbage, so unzipping must fail cleanly.
  const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9, 9, 9, 9, 9]);
  const result = xlsxToWorkbook(corrupt);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(typeof result.error, "string");
});

test("sheet names are sanitised to Excel's rules on export", () => {
  let ws = createWorksheet("sheet-1", "A/very:long*name[that]needs\\trimming to thirty one chars max");
  ws = setCellValue(ws, 0, 0, "x");
  const wb: Workbook = { worksheets: [ws], activeSheetId: "sheet-1" };
  const result = xlsxToWorkbook(workbookToXlsx(wb, new StyleRegistry()));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const name = result.workbook.sheets[0].name;
  assert.ok(name.length <= 31);
  assert.equal(/[:\\/?*[\]]/.test(name), false);
});
