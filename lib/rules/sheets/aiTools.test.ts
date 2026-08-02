import assert from "node:assert/strict";
import { test } from "node:test";
import { sheetsActionRequiresConfirmation, validateSheetsToolCall } from "./aiTools.ts";
import type { SheetData } from "./grid.ts";

function sheet(overrides: Partial<SheetData> = {}): SheetData {
  return { cells: {}, styles: {}, rows: 50, cols: 20, ...overrides };
}

test("set_cells rejects a reference outside the sheet", () => {
  const r = validateSheetsToolCall("set_cells", { cells: [{ ref: "ZZ9999", value: "1" }] }, sheet());
  assert.equal(r.ok, false);
});

test("set_cells accepts formulas and literals alike", () => {
  const r = validateSheetsToolCall(
    "set_cells",
    { cells: [{ ref: "b2", value: "=SUM(A1:A9)" }] },
    sheet(),
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.action, { tool: "set_cells", cells: [{ ref: "B2", value: "=SUM(A1:A9)" }] });
});

test("insert_rows converts 1-based beforeRow to a 0-based atRow", () => {
  const r = validateSheetsToolCall("insert_rows", { beforeRow: 1, count: 2 }, sheet());
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.action, { tool: "insert_rows", atRow: 0, count: 2 });
});

test("delete_rows past the end of the sheet is rejected", () => {
  const r = validateSheetsToolCall("delete_rows", { startRow: 45, count: 20 }, sheet({ rows: 50 }));
  assert.equal(r.ok, false);
});

test("delete_columns with an unparseable column letter is rejected", () => {
  const r = validateSheetsToolCall("delete_columns", { startColumn: "1", count: 1 }, sheet());
  assert.equal(r.ok, false);
});

test("set_formula requires a leading = and balanced parentheses", () => {
  assert.equal(validateSheetsToolCall("set_formula", { ref: "A1", formula: "SUM(A1:A2)", explanation: "x" }, sheet()).ok, false);
  assert.equal(validateSheetsToolCall("set_formula", { ref: "A1", formula: "=SUM(A1:A2", explanation: "x" }, sheet()).ok, false);
  assert.equal(validateSheetsToolCall("set_formula", { ref: "A1", formula: "=SUM(A1:A2)", explanation: "x" }, sheet()).ok, true);
});

test("format_range rejects a range outside the sheet's own dimensions", () => {
  const r = validateSheetsToolCall(
    "format_range",
    { range: "A1:ZZ9999", style: { bold: true } },
    sheet({ rows: 50, cols: 20 }),
  );
  assert.equal(r.ok, false);
});

test("format_range drops unknown style keys rather than passing them through", () => {
  const r = validateSheetsToolCall(
    "format_range",
    { range: "A1:B2", style: { bold: true, evilKey: "ignored" } },
    sheet(),
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual((r.action as { style: unknown }).style, { bold: true });
});

test("sort_range rejects a sort column outside the range being sorted", () => {
  const r = validateSheetsToolCall(
    "sort_range",
    { range: "A1:B10", byColumn: "D", direction: "asc" },
    sheet(),
  );
  assert.equal(r.ok, false);
});

test("filter_range requires a value for equals/contains but not for notEmpty", () => {
  assert.equal(
    validateSheetsToolCall("filter_range", { range: "A1:A10", byColumn: "A", condition: "equals", hasHeaderRow: true }, sheet()).ok,
    false,
  );
  assert.equal(
    validateSheetsToolCall(
      "filter_range",
      { range: "A1:A10", byColumn: "A", condition: "notEmpty", hasHeaderRow: true },
      sheet(),
    ).ok,
    true,
  );
});

test("apply_conditional_format requires the arguments its kind needs", () => {
  assert.equal(
    validateSheetsToolCall("apply_conditional_format", { range: "A1:A10", kind: "greater" }, sheet()).ok,
    false,
    "greater needs a numeric value",
  );
  assert.equal(
    validateSheetsToolCall("apply_conditional_format", { range: "A1:A10", kind: "greater", value: 10 }, sheet()).ok,
    true,
  );
  assert.equal(
    validateSheetsToolCall("apply_conditional_format", { range: "A1:A10", kind: "duplicate" }, sheet()).ok,
    true,
    "duplicate needs nothing extra",
  );
});

test("create_chart rejects a single-cell range", () => {
  const r = validateSheetsToolCall(
    "create_chart",
    { range: "A1:A1", chartType: "column", title: "Chart" },
    sheet(),
  );
  assert.equal(r.ok, false);
});

test("create_chart rejects an unknown chart type", () => {
  const r = validateSheetsToolCall(
    "create_chart",
    { range: "A1:B10", chartType: "sankey", title: "Chart" },
    sheet(),
  );
  assert.equal(r.ok, false);
});

test("create_table rejects a table that would not fit on the sheet", () => {
  const r = validateSheetsToolCall(
    "create_table",
    { anchor: "A48", headers: ["A", "B"], rows: [["1", "2"], ["3", "4"], ["5", "6"], ["7", "8"]] },
    sheet({ rows: 50 }),
  );
  assert.equal(r.ok, false);
});

test("delete_rows always requires confirmation, regardless of size", () => {
  const r = validateSheetsToolCall("delete_rows", { startRow: 1, count: 1 }, sheet());
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(sheetsActionRequiresConfirmation(r.action, sheet()), true);
});

test("format_range on a small range needs no confirmation; a broad one does", () => {
  const small = validateSheetsToolCall("format_range", { range: "A1:B2", style: { bold: true } }, sheet());
  const broad = validateSheetsToolCall("format_range", { range: "A1:J20", style: { bold: true } }, sheet());
  assert.equal(small.ok && sheetsActionRequiresConfirmation(small.action, sheet()), false);
  assert.equal(broad.ok && sheetsActionRequiresConfirmation(broad.action, sheet()), true);
});

test("set_cells overwriting existing data in bulk requires confirmation; a couple of blanks doesn't", () => {
  const existing = sheet({ cells: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`A${i + 1}`, "x"])) });
  const r = validateSheetsToolCall(
    "set_cells",
    { cells: Array.from({ length: 15 }, (_, i) => ({ ref: `A${i + 1}`, value: "new" })) },
    existing,
  );
  assert.equal(r.ok && sheetsActionRequiresConfirmation(r.action, existing), true);

  const small = validateSheetsToolCall("set_cells", { cells: [{ ref: "A1", value: "new" }] }, existing);
  assert.equal(small.ok && sheetsActionRequiresConfirmation(small.action, existing), false);
});

test("an unknown tool is refused", () => {
  assert.equal(validateSheetsToolCall("drop_table", {}, sheet()).ok, false);
});
