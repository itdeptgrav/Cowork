import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dragHasFiles,
  sheetFileKind,
  titleFromFileName,
  unsupportedFileMessage,
} from "./openFile.ts";

test("the formats a sheet can open", () => {
  assert.equal(sheetFileKind("Q3 plan.xlsx"), "xlsx");
  /* A macro workbook opens; the macros are simply not carried. Refusing it
     was the bug this names — it is an ordinary workbook to everybody. */
  assert.equal(sheetFileKind("budget.xlsm"), "xlsx");
  assert.equal(sheetFileKind("export.csv"), "csv");
  assert.equal(sheetFileKind("export.tsv"), "csv");
  assert.equal(sheetFileKind("workbook.json"), "json");
});

test("case and stray space do not decide the answer", () => {
  /* Windows hands back `.XLSX` often enough that a lowercase-only check fails
     on real files. */
  assert.equal(sheetFileKind("PLAN.XLSX"), "xlsx");
  assert.equal(sheetFileKind("  data.CSV  "), "csv");
});

test("anything else is refused, by name", () => {
  assert.equal(sheetFileKind("photo.png"), "unsupported");
  assert.equal(sheetFileKind("notes"), "unsupported");
  assert.equal(sheetFileKind(""), "unsupported");
});

test("the refusal says what to do about it", () => {
  const m = unsupportedFileMessage("holiday.png");
  assert.match(m, /holiday\.png/);
  assert.match(m, /\.csv, \.xlsx or \.json/);
});

test("the near misses are told how to convert", () => {
  /* The three people actually try. Each looks enough like a spreadsheet that a
     generic refusal reads as a bug in the product. */
  for (const name of ["Plan.numbers", "sheet.ods", "old.xls"]) {
    assert.match(unsupportedFileMessage(name), /Save it as \.xlsx first\./);
  }
  assert.doesNotMatch(unsupportedFileMessage("photo.png"), /Save it as/);
});

test("a drag is only a file drag when it says so", () => {
  assert.equal(dragHasFiles(["Files"]), true);
  assert.equal(dragHasFiles(["text/plain"]), false);
  /* `dragover` withholds the items themselves, and undefined must not throw. */
  assert.equal(dragHasFiles(undefined), false);
});

test("the sheet takes its name from the file, without the extension", () => {
  assert.equal(titleFromFileName("Q3 plan.xlsx"), "Q3 plan");
  assert.equal(titleFromFileName("C:\\Users\\me\\budget.csv"), "budget");
  assert.equal(titleFromFileName("/home/me/data.json"), "data");
  /* Only the trailing extension goes — a dotted name keeps its dots. */
  assert.equal(titleFromFileName("2026.Q3.forecast.xlsx"), "2026.Q3.forecast");
});

test("a name that is only an extension does not become empty", () => {
  assert.equal(titleFromFileName(".xlsx"), ".xlsx");
  assert.equal(titleFromFileName(""), "Untitled sheet");
});
