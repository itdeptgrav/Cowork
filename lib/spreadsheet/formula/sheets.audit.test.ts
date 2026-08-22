/**
 * Sheet-name audit — quoting, rename rewriting, and the workbook-level
 * protections around sheet names. Expected behaviour is Google Sheets'.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  renameSheetInFormula,
  renderSheetPrefix,
  sheetNeedsQuote,
} from "@/lib/spreadsheet/formula/sheets";
import { tokenize } from "@/lib/spreadsheet/formula/tokenizer";
import { createWorkbook } from "@/lib/spreadsheet/model";
import { createSheet, deleteSheet, renameSheet } from "@/lib/spreadsheet/workbook";

/* ── Quoting round trips ──────────────────────────────────────────────────── */

test("AUDIT: names that need quoting round-trip through render + tokenize", () => {
  for (const name of ["Sales Data", "Bob's", "2024", "Q4 – Final", "a b c"]) {
    const prefix = renderSheetPrefix(name);
    const tokens = tokenize(`${prefix}A1`);
    assert.deepEqual(
      tokens,
      [
        { type: "sheet", value: name },
        { type: "ref", value: "A1" },
      ],
      `round trip failed for "${name}" via ${prefix}`,
    );
  }
});

test("AUDIT: identifier-shaped names stay unquoted; digit-leading names get quotes", () => {
  assert.equal(sheetNeedsQuote("Sheet2"), false);
  assert.equal(sheetNeedsQuote("Q1.Data"), false);
  assert.equal(sheetNeedsQuote("_hidden"), false);
  assert.equal(sheetNeedsQuote("2024"), true, "cannot start with a digit unquoted");
  assert.equal(sheetNeedsQuote("Bob's"), true);
  assert.equal(renderSheetPrefix("Bob's"), "'Bob''s'!", "an apostrophe doubles inside quotes");
});

/* ── Rename rewriting ─────────────────────────────────────────────────────── */

test("AUDIT: renaming rewrites quoted and unquoted mentions alike", () => {
  assert.equal(renameSheetInFormula("='Old Name'!A1+B1", "Old Name", "New"), "=New!A1+B1");
  assert.equal(
    renameSheetInFormula("=SUM('Sales Data'!A1:A9)", "sales data", "Revenue"),
    "=SUM(Revenue!A1:A9)",
    "matching is case-insensitive",
  );
});

test("AUDIT: renaming to a name with an apostrophe survives a round trip", () => {
  const once = renameSheetInFormula("=Sheet2!A1", "Sheet2", "Bob's");
  assert.equal(once, "='Bob''s'!A1");
  assert.equal(renameSheetInFormula(once, "Bob's", "Sheet2"), "=Sheet2!A1");
});

test("AUDIT: renaming never touches string literals or unrelated sheets", () => {
  assert.equal(
    renameSheetInFormula('=CONCATENATE("Sheet2!A1",Sheet2!A1)', "Sheet2", "Rev"),
    '=CONCATENATE("Sheet2!A1",Rev!A1)',
  );
  assert.equal(renameSheetInFormula("=Sheet3!A1", "Sheet2", "Rev"), "=Sheet3!A1");
  assert.equal(renameSheetInFormula("=A1+1", "Sheet2", "Rev"), "=A1+1");
});

/* ── Workbook-level protections ───────────────────────────────────────────── */

test("AUDIT: renameSheet rewrites formulas on every sheet of the workbook", () => {
  const base = createWorkbook();
  const { workbook: wb } = createSheet(base); // adds "Sheet2"
  wb.worksheets[0].cells["B1"] = { value: "=Sheet2!A1+1" };
  wb.worksheets[1].cells["B1"] = { value: "=SUM(Sheet2!A1:A3)" };

  const renamed = renameSheet(wb, "sheet-2", "Revenue");
  assert.equal(renamed.worksheets[1].name, "Revenue");
  assert.equal(renamed.worksheets[0].cells["B1"].value, "=Revenue!A1+1");
  assert.equal(
    renamed.worksheets[1].cells["B1"].value,
    "=SUM(Revenue!A1:A3)",
    "the renamed sheet's own self-references are rewritten too",
  );
});

test("AUDIT: duplicate names are rejected case-insensitively; blanks rejected", () => {
  const base = createWorkbook();
  const { workbook: wb } = createSheet(base); // Sheet1 + Sheet2
  assert.equal(renameSheet(wb, "sheet-2", "sheet1"), wb, "case-insensitive collision");
  assert.equal(renameSheet(wb, "sheet-2", "  "), wb, "blank name");
  const ok = renameSheet(wb, "sheet-2", "Data");
  assert.notEqual(ok, wb);
  assert.equal(ok.worksheets[1].name, "Data");
});

test("AUDIT: the default naming skips taken names", () => {
  const base = createWorkbook(); // Sheet1
  const one = createSheet(base).workbook; // Sheet2
  const renamed = renameSheet(one, "sheet-2", "Sheet3");
  const two = createSheet(renamed).workbook; // must skip "Sheet3", not collide
  const names = two.worksheets.map((s) => s.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, `duplicate sheet name in ${names.join(", ")}`);
});

test("AUDIT: the last sheet cannot be deleted", () => {
  const wb = createWorkbook();
  assert.equal(deleteSheet(wb, "sheet-1"), wb);
  const two = createSheet(wb).workbook;
  const one = deleteSheet(two, "sheet-1");
  assert.equal(one.worksheets.length, 1);
  assert.equal(one.activeSheetId, one.worksheets[0].id, "the survivor becomes active");
});
