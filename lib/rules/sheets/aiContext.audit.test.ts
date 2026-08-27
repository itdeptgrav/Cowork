/**
 * Adversarial audit of `aiContext.ts` — what the model is actually sent for
 * edge grids: empty, sparse, and larger than the budget. The sparse-grid
 * cases pinned a real budget bug (visited positions counted instead of
 * non-empty cells) when first written; fixed, and kept to keep it so.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSheetsContext, requestsWholeSheet } from "./aiContext.ts";
import type { SheetData } from "./grid.ts";

function sheet(cells: Record<string, string>, rows = 50, cols = 20): SheetData {
  return { cells, styles: {}, rows, cols };
}

test("whole-sheet context includes data at the bottom of a DEFAULT-sized sheet", () => {
  /* A default sheet is 200×26 = 5,200 grid positions but only two values.
     The budget counts NON-EMPTY cells against MAX_FULL_SHEET_CELLS (4,000) —
     empty positions cost nothing — so a context announcing itself as "Full
     sheet contents" really does carry the cell at the very bottom. */
  const ctx = buildSheetsContext({
    sheet: sheet({ A1: "top", Z200: "bottom" }, 200, 26),
    selection: null,
    wholeSheet: true,
  });
  assert.match(ctx, /A1=top/);
  assert.match(ctx, /Z200=bottom/);
});

test("a sparse selection's values are not eaten by its empty cells", () => {
  /* 600-cell selection, all 100 values in the last five rows — well under the
     400 non-empty-cell budget, so every value is sent and no truncation note
     (or "the selected cells are empty" fallback) may appear. */
  const cells: Record<string, string> = {};
  for (let r = 25; r < 30; r++)
    for (let c = 0; c < 20; c++) cells[`${String.fromCharCode(65 + c)}${r + 1}`] = "v";
  const ctx = buildSheetsContext({
    sheet: sheet(cells),
    selection: { top: 0, left: 0, bottom: 29, right: 19 },
  });
  assert.match(ctx, /A26=v/, "the first actual value in the selection should be in the context");
});

test("an empty whole-sheet request still states the sheet size and stays small", () => {
  const ctx = buildSheetsContext({ sheet: sheet({}, 200, 26), selection: null, wholeSheet: true });
  assert.match(ctx, /Sheet size: 200 rows × 26 columns/);
  assert.ok(ctx.length < 500, "an empty sheet must not produce a bloated context");
});

test("a dense selection under the cap is sent whole, with no truncation note", () => {
  const cells: Record<string, string> = {};
  for (let r = 0; r < 10; r++) for (let c = 0; c < 3; c++) cells[`${String.fromCharCode(65 + c)}${r + 1}`] = `${r}-${c}`;
  const ctx = buildSheetsContext({
    sheet: sheet(cells),
    selection: { top: 0, left: 0, bottom: 9, right: 2 },
  });
  assert.match(ctx, /A1=0-0/);
  assert.match(ctx, /C10=9-2/);
  assert.doesNotMatch(ctx, /only the first/);
});

test("headers come from row 1 and are only claimed when the selection sits below it", () => {
  const s = sheet({ A1: "Month", B1: "Revenue", A5: "Jan" });
  const below = buildSheetsContext({ sheet: s, selection: { top: 4, left: 0, bottom: 4, right: 1 } });
  assert.match(below, /Column headers \(row 1\).*A=Month, B=Revenue/);
  const atTop = buildSheetsContext({ sheet: s, selection: { top: 0, left: 0, bottom: 4, right: 1 } });
  assert.doesNotMatch(atTop, /Column headers/);
});

test("requestsWholeSheet is a phrase match, not a keyword grep", () => {
  assert.equal(requestsWholeSheet("clean up the ENTIRE SHEET please"), true);
  assert.equal(requestsWholeSheet("make the full sheet consistent"), true);
  assert.equal(requestsWholeSheet("this column is full, sheet needs more"), false, "punctuation splits the phrase — no \\b match across ', '");
  assert.equal(requestsWholeSheet("summarise my selection"), false);
});
