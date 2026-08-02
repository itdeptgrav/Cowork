import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSheetsContext, requestsWholeSheet } from "./aiContext.ts";
import type { SheetData } from "./grid.ts";

function sheet(cells: Record<string, string>, rows = 50, cols = 20): SheetData {
  return { cells, styles: {}, rows, cols };
}

test("no selection says so explicitly", () => {
  const ctx = buildSheetsContext({ sheet: sheet({}), selection: null });
  assert.match(ctx, /Nothing is selected/);
});

test("a selection is labelled with its range and its values", () => {
  const ctx = buildSheetsContext({
    sheet: sheet({ B2: "10", B3: "20" }),
    selection: { top: 1, left: 1, bottom: 2, right: 1 },
  });
  assert.match(ctx, /Selected range: B2:B3/);
  assert.match(ctx, /B2=10/);
  assert.match(ctx, /B3=20/);
});

test("column headers are pulled from row 1 even when the selection starts lower", () => {
  const ctx = buildSheetsContext({
    sheet: sheet({ A1: "Month", B1: "Revenue", A5: "Jan", B5: "1000" }),
    selection: { top: 4, left: 0, bottom: 4, right: 1 },
  });
  assert.match(ctx, /Column headers.*A=Month, B=Revenue/);
});

test("headers are not claimed when the selection IS row 1", () => {
  const ctx = buildSheetsContext({
    sheet: sheet({ A1: "Month" }),
    selection: { top: 0, left: 0, bottom: 0, right: 0 },
  });
  assert.doesNotMatch(ctx, /Column headers/);
});

test("the whole sheet is only sent when explicitly requested", () => {
  const withoutIt = buildSheetsContext({
    sheet: sheet({ A1: "x" }),
    selection: { top: 0, left: 0, bottom: 0, right: 0 },
  });
  assert.doesNotMatch(withoutIt, /Full sheet contents/);

  const withIt = buildSheetsContext({ sheet: sheet({ A1: "x" }), selection: null, wholeSheet: true });
  assert.match(withIt, /Full sheet contents \(explicitly requested\)/);
  assert.match(withIt, /A1=x/);
});

test("a huge selection is truncated with a stated count, not silently cut", () => {
  const cells: Record<string, string> = {};
  for (let r = 0; r < 30; r++) for (let c = 0; c < 20; c++) cells[`${String.fromCharCode(65 + c)}${r + 1}`] = "v";
  const ctx = buildSheetsContext({
    sheet: sheet(cells, 50, 20),
    selection: { top: 0, left: 0, bottom: 29, right: 19 },
  });
  assert.match(ctx, /600 cells; only the first 400/);
});

test("requestsWholeSheet recognises the phrase", () => {
  assert.equal(requestsWholeSheet("Summarize the whole sheet"), true);
  assert.equal(requestsWholeSheet("Sort this range"), false);
});
