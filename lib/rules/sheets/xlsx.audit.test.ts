/**
 * Adversarial audit of `xlsx.ts` — round trips under hostile cell content,
 * sheet-name sanitisation, foreign-workbook bounds, and format bucketing.
 * The leading-space formula case pinned a real strip bug when first written;
 * fixed, and kept to keep it so.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { workbookToXlsx, xlsxToWorkbook } from "./xlsx.ts";
import { MAX_COLS, type Workbook } from "./grid.ts";

function workbook(cells: Record<string, string>, styles: Workbook["sheets"][0]["styles"] = {}): Workbook {
  return {
    sheets: [{ id: "a", name: "Sheet1", cells, styles, rows: 30, cols: 12 }],
    activeId: "a",
  };
}

const roundTrip = (wb: Workbook) => xlsxToWorkbook(workbookToXlsx(wb));

test("a formula typed with a leading space survives the round trip once, not twice", () => {
  /* grid.ts deliberately treats " =A1+1" as a formula (isFormula trims), and
     the sheet stores what was typed — so cellFor() must strip THROUGH the "="
     (trimStart first), because SheetJS's .f field holds formula text WITHOUT
     the equals sign, and a blind slice(1) would remove the space instead and
     re-import as a broken "==SUM(B1:B2)". */
  const back = roundTrip(workbook({ A1: " =SUM(B1:B2)", B1: "1", B2: "2" }));
  assert.equal(back.sheets[0].cells.A1, "=SUM(B1:B2)");
});

test("negative, decimal and zero values survive as numbers", () => {
  const back = roundTrip(workbook({ A1: "-5", A2: "3.25", A3: "0" }));
  assert.equal(back.sheets[0].cells.A1, "-5");
  assert.equal(back.sheets[0].cells.A2, "3.25");
  assert.equal(back.sheets[0].cells.A3, "0");
});

test("number-lookalike text is kept as text, true numbers normalise like Excel", () => {
  const back = roundTrip(workbook({ A1: "1e5", A2: "+7", A3: ".5", A4: "007" }));
  const cells = back.sheets[0].cells;
  assert.equal(cells.A1, "1e5", "scientific notation is not matched by the numeric regex — stays text");
  assert.equal(cells.A2, "+7");
  assert.equal(cells.A3, ".5");
  /* "007" IS matched as numeric, so like Excel it comes back as 7. */
  assert.equal(cells.A4, "7");
});

test("text that starts with = only after other characters is not a formula", () => {
  const back = roundTrip(workbook({ A1: "a=b", A2: "==" }));
  assert.equal(back.sheets[0].cells.A1, "a=b");
});

test("forbidden characters in a tab name are sanitised, not written", () => {
  const wb: Workbook = {
    sheets: [
      { id: "a", name: "P&L: 2026/Q1?", cells: { A1: "x" }, styles: {}, rows: 10, cols: 5 },
    ],
    activeId: "a",
  };
  const back = roundTrip(wb);
  const name = back.sheets[0].name;
  assert.equal(/[:\\/?*[\]]/.test(name), false, `"${name}" still carries a forbidden character`);
  assert.ok(name.includes("P&L"), "legal characters survive");
});

test("duplicate tab names are disambiguated instead of colliding", () => {
  const wb: Workbook = {
    sheets: [
      { id: "a", name: "Data", cells: { A1: "1" }, styles: {}, rows: 10, cols: 5 },
      { id: "b", name: "Data", cells: { A1: "2" }, styles: {}, rows: 10, cols: 5 },
    ],
    activeId: "a",
  };
  const back = roundTrip(wb);
  assert.equal(back.sheets.length, 2);
  assert.notEqual(back.sheets[0].name, back.sheets[1].name);
  assert.equal(back.sheets[0].cells.A1, "1");
  assert.equal(back.sheets[1].cells.A1, "2");
});

test("a workbook with NO sheets still exports a readable one-tab file", () => {
  const back = xlsxToWorkbook(workbookToXlsx({ sheets: [] }));
  assert.equal(back.sheets.length, 1);
  assert.deepEqual(back.sheets[0].cells, {});
});

test("a foreign workbook's out-of-bounds columns are skipped, not relabelled", () => {
  /* Build a sheet via SheetJS directly with a value beyond our MAX_COLS (52):
     column BZ is index 77. Import must drop it rather than wrap or clamp it. */
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  ws["A1"] = { t: "s", v: "keep" };
  ws["BZ1"] = { t: "s", v: "too far right" };
  ws["!ref"] = "A1:BZ1";
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, "Wide");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

  const back = xlsxToWorkbook(bytes);
  const cells = back.sheets[0].cells;
  assert.equal(cells.A1, "keep");
  assert.equal(Object.values(cells).includes("too far right"), false);
  assert.ok(back.sheets[0].cols <= MAX_COLS);
});

test("foreign number formats bucket by what they are FOR", () => {
  /* Percent beats currency beats comma in the bucketing order; a date-ish or
     General code maps to no format at all. */
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  ws["A1"] = { t: "n", v: 0.5, z: "0%" };
  ws["A2"] = { t: "n", v: 9.99, z: '"$"#,##0.00' };
  ws["A3"] = { t: "n", v: 1234, z: "#,##0" };
  ws["A4"] = { t: "n", v: 45000, z: "m/d/yy" };
  ws["!ref"] = "A1:A4";
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, "Formats");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx", cellStyles: true }) as ArrayBuffer;

  const back = xlsxToWorkbook(bytes);
  const styles = back.sheets[0].styles;
  assert.equal(styles.A1?.format, "percent");
  assert.equal(styles.A2?.format, "currency");
  assert.equal(styles.A3?.format, "comma");
  assert.equal(styles.A4?.format, undefined, "a date code maps to none of our four formats");
});

test("all four of our named formats survive a round trip", () => {
  const back = roundTrip(
    workbook(
      { A1: "1", A2: "2", A3: "3", A4: "4" },
      {
        A1: { format: "currency" },
        A2: { format: "percent" },
        A3: { format: "comma" },
        A4: { format: "plain" },
      },
    ),
  );
  const styles = back.sheets[0].styles;
  assert.equal(styles.A1?.format, "currency");
  assert.equal(styles.A2?.format, "percent");
  assert.equal(styles.A3?.format, "comma");
  assert.equal(styles.A4?.format ?? undefined, undefined, "plain writes General, which reads back as no format");
});
