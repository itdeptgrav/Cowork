import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "@/lib/spreadsheet/formula/parser";
import { tokenize } from "@/lib/spreadsheet/formula/tokenizer";
import {
  renameSheetInFormula,
  renderSheetPrefix,
  sheetNeedsQuote,
} from "@/lib/spreadsheet/formula/sheets";

test("tokenizes an unquoted sheet qualifier, keeping the not-equal operator apart", () => {
  assert.deepEqual(tokenize("Sheet2!A1"), [
    { type: "sheet", value: "Sheet2" },
    { type: "ref", value: "A1" },
  ]);
  // `!=` must stay the not-equal operator, not read `A1` as a sheet.
  assert.deepEqual(tokenize("A1<>B1"), [
    { type: "ref", value: "A1" },
    { type: "op", value: "<>" },
    { type: "ref", value: "B1" },
  ]);
});

test("tokenizes a quoted sheet name with spaces", () => {
  assert.deepEqual(tokenize("'Sales Data'!A1"), [
    { type: "sheet", value: "Sales Data" },
    { type: "ref", value: "A1" },
  ]);
});

test("parses a cross-sheet reference onto the ref node", () => {
  const node = parse("Sheet2!A1");
  assert.equal(node.type, "ref");
  if (node.type === "ref") {
    assert.equal(node.sheet, "Sheet2");
    assert.deepEqual({ row: node.row, col: node.col }, { row: 0, col: 0 });
  }
});

test("parses a cross-sheet range; the sheet binds to the whole range", () => {
  const node = parse("SUM(Sheet2!A1:A10)");
  assert.equal(node.type, "call");
  if (node.type === "call") {
    const range = node.args[0];
    assert.equal(range.type, "range");
    if (range.type === "range") {
      assert.equal(range.sheet, "Sheet2");
      assert.equal(range.start.sheet, "Sheet2");
      assert.equal(range.end.sheet, "Sheet2");
    }
  }
});

test("sheetNeedsQuote / renderSheetPrefix quote only when necessary", () => {
  assert.equal(sheetNeedsQuote("Sheet2"), false);
  assert.equal(sheetNeedsQuote("Sales Data"), true);
  assert.equal(renderSheetPrefix("Sheet2"), "Sheet2!");
  assert.equal(renderSheetPrefix("Sales Data"), "'Sales Data'!");
});

test("renameSheetInFormula rewrites references to the renamed sheet (the spec example)", () => {
  assert.equal(renameSheetInFormula("=Sheet2!A1", "Sheet2", "Revenue"), "=Revenue!A1");
  assert.equal(
    renameSheetInFormula("=SUM(Sheet2!A1:A10)+B1", "Sheet2", "Revenue"),
    "=SUM(Revenue!A1:A10)+B1",
  );
});

test("renameSheetInFormula quotes a new name that needs it, and matches case-insensitively", () => {
  assert.equal(renameSheetInFormula("=sheet2!A1", "Sheet2", "Sales Data"), "='Sales Data'!A1");
  // A different sheet is left alone.
  assert.equal(renameSheetInFormula("=Sheet3!A1", "Sheet2", "Revenue"), "=Sheet3!A1");
  // A non-formula, or one without the sheet, is unchanged.
  assert.equal(renameSheetInFormula("hello", "Sheet2", "Revenue"), "hello");
});
