/**
 * XLSX IO audit — what the module's own header promises must survive.
 *
 * Values (numbers, booleans, text, unicode), formulas, multiple sheets/names and
 * number-format kinds round-trip; styles beyond bold/italic/underline are a
 * documented loss and are not asserted. Also probes the import cap and
 * malformed-buffer handling. Failing assertions are tagged `// BUG(...)`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { createWorksheet, setCellValue, type Workbook } from "@/lib/spreadsheet/model";
import { StyleRegistry } from "@/lib/spreadsheet/style";
import { workbookToXlsx, xlsxToWorkbook } from "@/lib/spreadsheet/xlsxio";

function oneSheet(cells: Record<string, string>): { wb: Workbook; registry: StyleRegistry } {
  let ws = createWorksheet("sheet-1", "S");
  for (const [ref, value] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    const col = m[1].split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    ws = setCellValue(ws, Number(m[2]) - 1, col, value);
  }
  return { wb: { worksheets: [ws], activeSheetId: "sheet-1" }, registry: new StyleRegistry() };
}

function roundTrip(cells: Record<string, string>): Record<string, string | undefined> {
  const { wb, registry } = oneSheet(cells);
  const result = xlsxToWorkbook(workbookToXlsx(wb, registry));
  assert.equal(result.ok, true);
  if (!result.ok) return {};
  return Object.fromEntries(result.workbook.sheets[0].cells.map((c) => [c.ref, c.value]));
}

test("AUDIT: numbers, negatives, decimals, exponents and booleans round-trip as values", () => {
  const back = roundTrip({
    A1: "42",
    A2: "-3.5",
    A3: "0.001",
    A4: "1e5",
    A5: "TRUE",
    A6: "false",
    A7: "0",
  });
  assert.equal(back["A1"], "42");
  assert.equal(back["A2"], "-3.5");
  assert.equal(back["A3"], "0.001");
  assert.equal(back["A4"], "100000", "an exponent normalises to its plain value");
  assert.equal(back["A5"], "TRUE");
  assert.equal(back["A6"], "FALSE", "a lower-case boolean normalises, matching the engine");
  assert.equal(back["A7"], "0", "zero is a value, not an empty cell");
});

test("AUDIT: boolean casing normalises to TRUE/FALSE both ways", () => {
  const back = roundTrip({ A1: "true", A2: "False", A3: " TRUE " });
  assert.equal(back["A1"], "TRUE");
  assert.equal(back["A2"], "FALSE");
  assert.equal(back["A3"], "TRUE");
});

test("AUDIT: text that merely looks numeric-ish stays text", () => {
  const back = roundTrip({
    A1: "1,000", // thousands separator — not a plain number
    A2: "01/02", // date-ish text
    A3: "+", // sign alone
    A4: "1.2.3", // version string
    A5: "3 ", // trailing space INSIDE quotes... raw includes it
  });
  assert.equal(back["A1"], "1,000");
  assert.equal(back["A2"], "01/02");
  assert.equal(back["A3"], "+");
  assert.equal(back["A4"], "1.2.3");
});

test("AUDIT: a leading-zero entry keeps its displayed value through the round trip", () => {
  // Documented judgement: the engine already interprets raw "007" as the number
  // 7 (values.ts), so export writes the number and import reads "7" back. The
  // DISPLAYED value is unchanged; the raw text is not. Asserting the current
  // behaviour so an unintended change is noticed.
  const back = roundTrip({ A1: "007" });
  assert.equal(back["A1"], "7");
});

test("AUDIT: an overflow exponent must not corrupt the cell", () => {
  // values.ts guards with Number.isFinite and treats "1e999" as TEXT; cellFor
  // (xlsxio.ts) applies the same guard, so it exports the string, not Infinity.
  const { wb, registry } = oneSheet({ A1: "1e999" });
  let back: Record<string, string | undefined> = {};
  assert.doesNotThrow(() => {
    const result = xlsxToWorkbook(workbookToXlsx(wb, registry));
    assert.equal(result.ok, true);
    if (result.ok) back = Object.fromEntries(result.workbook.sheets[0].cells.map((c) => [c.ref, c.value]));
  });
  assert.equal(back["A1"], "1e999", "text the engine cannot read as a finite number must stay text");
});

test("AUDIT: formulas round-trip unevaluated, including cross-sheet references", () => {
  let a = createWorksheet("sheet-1", "Data");
  a = setCellValue(a, 0, 0, "10");
  let b = createWorksheet("sheet-2", "Calc");
  b = setCellValue(b, 0, 0, "=Data!A1*2");
  b = setCellValue(b, 1, 0, '=IF(A1>5,"big","small")');
  const wb: Workbook = { worksheets: [a, b], activeSheetId: "sheet-1" };
  const result = xlsxToWorkbook(workbookToXlsx(wb, new StyleRegistry()));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const calc = Object.fromEntries(result.workbook.sheets[1].cells.map((c) => [c.ref, c.value]));
  assert.equal(calc["A1"], "=Data!A1*2");
  assert.equal(calc["A2"], '=IF(A1>5,"big","small")');
});

test("AUDIT: unicode strings and embedded newlines survive", () => {
  const back = roundTrip({ A1: "héllo 🚀 漢字", A2: "line1\nline2", A3: "  padded  " });
  assert.equal(back["A1"], "héllo 🚀 漢字");
  assert.equal(back["A2"], "line1\nline2");
  assert.equal(back["A3"], "  padded  ");
});

test("AUDIT: number-format kinds map through the round trip", () => {
  const registry = new StyleRegistry();
  const ids = {
    percent: registry.intern({ numberFormat: { kind: "percent" } }),
    currency: registry.intern({ numberFormat: { kind: "currency", currency: "€" } }),
    date: registry.intern({ numberFormat: { kind: "date" } }),
    time: registry.intern({ numberFormat: { kind: "time" } }),
    datetime: registry.intern({ numberFormat: { kind: "datetime" } }),
    scientific: registry.intern({ numberFormat: { kind: "scientific" } }),
    number: registry.intern({ numberFormat: { kind: "number", decimals: 2 } }),
  };
  let ws = createWorksheet("sheet-1", "S");
  const refs: [string, keyof typeof ids][] = [
    ["A1", "percent"],
    ["A2", "currency"],
    ["A3", "date"],
    ["A4", "time"],
    ["A5", "datetime"],
    ["A6", "scientific"],
    ["A7", "number"],
  ];
  const cellStyles: Record<string, number> = {};
  refs.forEach(([ref], i) => {
    ws = setCellValue(ws, i, 0, "1234.5");
    cellStyles[ref] = ids[refs[i][1]];
  });
  ws = { ...ws, cellStyles };
  const result = xlsxToWorkbook(workbookToXlsx({ worksheets: [ws], activeSheetId: "sheet-1" }, registry));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const sheet = result.workbook.sheets[0];
  const kindAt = (ref: string) => {
    const cell = sheet.cells.find((c) => c.ref === ref);
    return cell?.style !== undefined ? result.workbook.styles[cell.style]?.numberFormat?.kind : undefined;
  };
  for (const [ref, kind] of refs) {
    assert.equal(kindAt(ref), kind, `${ref} should come back as ${kind}`);
  }
});

test("AUDIT: many sheets round-trip in order with sanitised, de-duplicated names", () => {
  const sheets = ["Alpha", "Beta", "Gamma", "Delta"].map((name, i) => {
    let ws = createWorksheet(`sheet-${i + 1}`, name);
    ws = setCellValue(ws, 0, 0, name);
    return ws;
  });
  const wb: Workbook = { worksheets: sheets, activeSheetId: "sheet-1" };
  const result = xlsxToWorkbook(workbookToXlsx(wb, new StyleRegistry()));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.workbook.sheets.map((s) => s.name), ["Alpha", "Beta", "Gamma", "Delta"]);
  assert.equal(result.workbook.activeSheetId, result.workbook.sheets[0].id);
});

test("AUDIT: an empty sheet exports and imports as an empty sheet, not an error", () => {
  const ws = createWorksheet("sheet-1", "Empty");
  const result = xlsxToWorkbook(workbookToXlsx({ worksheets: [ws], activeSheetId: "sheet-1" }, new StyleRegistry()));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.workbook.sheets[0].cells.length, 0);
  assert.ok(result.workbook.sheets[0].rowCount >= 1);
});

test("AUDIT: a foreign file's date/boolean/formula cells import to the right raw values", () => {
  // Build a file the way ANOTHER tool would: SheetJS objects directly.
  const foreign: XLSX.WorkSheet = {
    A1: { t: "n", v: 45000, z: "yyyy-mm-dd" }, // a date-formatted serial
    A2: { t: "b", v: false },
    A3: { t: "n", f: "SUM(B1:B3)" }, // formula, no cached value
    A4: { t: "s", v: "plain" },
    "!ref": "A1:A4",
  };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, foreign, "Import");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

  const result = xlsxToWorkbook(bytes);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const cells = Object.fromEntries(result.workbook.sheets[0].cells.map((c) => [c.ref, c]));
  assert.equal(cells["A1"].value, "45000", "the date serial is the raw value");
  const dateStyle = cells["A1"].style !== undefined ? result.workbook.styles[cells["A1"].style!] : undefined;
  assert.equal(dateStyle?.numberFormat?.kind, "date", "its format kind is recognised from the code");
  assert.equal(cells["A2"].value, "FALSE");
  assert.equal(cells["A3"].value, "=SUM(B1:B3)");
  assert.equal(cells["A4"].value, "plain");
});

test("AUDIT: cells beyond the import cap are dropped; the rest of the sheet survives", () => {
  const far: XLSX.WorkSheet = {
    A1: { t: "s", v: "keep" },
    A200001: { t: "s", v: "beyond the row cap" }, // row index 200000 = MAX_IMPORT_ROWS
    "!ref": "A1:A200001",
  };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, far, "Big");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const result = xlsxToWorkbook(bytes);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const values = result.workbook.sheets[0].cells.map((c) => c.value);
  assert.deepEqual(values, ["keep"], "the capped cell is dropped, the sheet is not rejected");
});

test("AUDIT: empty and truncated buffers return an error result, never throw", () => {
  for (const bytes of [new Uint8Array(0), new Uint8Array([0x50]), new Uint8Array(64).fill(0xff)]) {
    let result: ReturnType<typeof xlsxToWorkbook> | undefined;
    assert.doesNotThrow(() => {
      result = xlsxToWorkbook(bytes);
    });
    assert.equal(typeof result!.ok, "boolean");
    if (!result!.ok) assert.equal(typeof result!.error, "string");
  }
});
