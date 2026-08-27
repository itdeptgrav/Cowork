/**
 * Sort audit — reference semantics are Google Sheets / Excel.
 *
 * Sorting reorders WHOLE ROWS by a key column. The cross-type order ascending
 * is numbers → text → booleans, with blanks LAST; descending reverses the
 * types but blanks stay LAST (both Sheets and Excel pin this). Equal keys keep
 * their original relative order (stable), text compares case-insensitively,
 * and cells outside the sorted range must not move.
 *
 * Failing assertions are kept deliberately, tagged BUG(<id>).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCellRef, type Rect } from "@/lib/spreadsheet/coordinates";
import {
  createWorksheet,
  getCellValue,
  setCellValue,
  type Worksheet,
} from "@/lib/spreadsheet/model";
import { FormulaEngine } from "@/lib/spreadsheet/formula";
import { applyChanges, buildCommand } from "@/lib/spreadsheet/history";
import { sortRangeEdits } from "@/lib/spreadsheet/sort";

function build(cells: Record<string, string>): { ws: Worksheet; engine: FormulaEngine } {
  let ws = createWorksheet("s", "Sheet1");
  const engine = new FormulaEngine();
  for (const [ref, value] of Object.entries(cells)) {
    const p = parseCellRef(ref)!;
    ws = setCellValue(ws, p.row, p.col, value);
    engine.setCell("s", p.row, p.col, value);
  }
  return { ws, engine };
}

const rect = (t: number, l: number, b: number, r: number): Rect => ({ top: t, left: l, bottom: b, right: r });

function applySort(
  ws: Worksheet,
  engine: FormulaEngine,
  range: Rect,
  col: number,
  dir: "asc" | "desc",
): Worksheet {
  const edits = sortRangeEdits(ws, range, col, dir, (r, c) => engine.getValue("s", r, c));
  return applyChanges(ws, buildCommand("Sort", ws, edits).changes);
}

const colA = (ws: Worksheet, rows: number) =>
  Array.from({ length: rows }, (_, r) => getCellValue(ws, r, 0));

test("AUDIT: ascending cross-type order is numbers, text, booleans, blanks last", () => {
  // A4 is left unset — a blank row inside the sorted range.
  const { ws, engine } = build({ A1: "hello", A2: "10", A3: "TRUE", A5: "2" });
  const next = applySort(ws, engine, rect(0, 0, 4, 0), 0, "asc");
  assert.deepEqual(colA(next, 5), ["2", "10", "hello", "TRUE", ""]);
});

test("AUDIT: descending reverses the type order (booleans, text, numbers)", () => {
  const { ws, engine } = build({ A1: "hello", A2: "10", A3: "TRUE", A4: "2" });
  const next = applySort(ws, engine, rect(0, 0, 3, 0), 0, "desc");
  assert.deepEqual(colA(next, 4), ["TRUE", "hello", "10", "2"]);
});

test("AUDIT: descending sort keeps blank rows LAST (Sheets/Excel: blanks always sink)", () => {
  // A2 is blank. Sheets and Excel keep blanks at the bottom in BOTH directions.
  const { ws, engine } = build({ A1: "b", A3: "a", B1: "1", B3: "2" });
  const next = applySort(ws, engine, rect(0, 0, 2, 1), 0, "desc");
  assert.deepEqual(colA(next, 3), ["b", "a", ""]);
  assert.deepEqual(
    [getCellValue(next, 0, 1), getCellValue(next, 1, 1)],
    ["1", "2"],
    "the companion column must follow its rows",
  );
});

test("AUDIT: equal keys keep their original order (stable), ascending and descending", () => {
  const cells = { A1: "1", A2: "1", A3: "1", B1: "first", B2: "second", B3: "third" };
  const asc = (() => {
    const { ws, engine } = build(cells);
    return applySort(ws, engine, rect(0, 0, 2, 1), 0, "asc");
  })();
  const desc = (() => {
    const { ws, engine } = build(cells);
    return applySort(ws, engine, rect(0, 0, 2, 1), 0, "desc");
  })();
  for (const next of [asc, desc]) {
    assert.deepEqual(
      [getCellValue(next, 0, 1), getCellValue(next, 1, 1), getCellValue(next, 2, 1)],
      ["first", "second", "third"],
    );
  }
});

test("AUDIT: text sorts case-insensitively, and case-equal keys are a stable tie", () => {
  const { ws, engine } = build({ A1: "apple", A2: "APPLE", A3: "Banana" });
  const next = applySort(ws, engine, rect(0, 0, 2, 0), 0, "asc");
  // "apple"/"APPLE" tie and keep their original order; "Banana" follows.
  assert.deepEqual(colA(next, 3), ["apple", "APPLE", "Banana"]);
});

test("AUDIT: numeric cells sort by magnitude, not by their text ('9' before '10')", () => {
  const { ws, engine } = build({ A1: "100", A2: "9", A3: "10" });
  const next = applySort(ws, engine, rect(0, 0, 2, 0), 0, "asc");
  assert.deepEqual(colA(next, 3), ["9", "10", "100"]);
});

test("AUDIT: cells outside the sorted range do not move", () => {
  const { ws, engine } = build({ A1: "2", A2: "1", A3: "0", B1: "x", B2: "y", C1: "stay" });
  // Sort ONLY A1:B2 — row 3 and column C are outside.
  const edits = sortRangeEdits(ws, rect(0, 0, 1, 1), 0, "asc", (r, c) =>
    engine.getValue("s", r, c),
  );
  for (const e of edits) {
    assert.ok(e.row <= 1 && e.col <= 1, `edit outside the range: r${e.row} c${e.col}`);
  }
  const next = applyChanges(ws, buildCommand("Sort", ws, edits).changes);
  assert.deepEqual([getCellValue(next, 0, 0), getCellValue(next, 1, 0)], ["1", "2"]);
  assert.deepEqual([getCellValue(next, 0, 1), getCellValue(next, 1, 1)], ["y", "x"]);
  assert.equal(getCellValue(next, 2, 0), "0", "row below the range is untouched");
  assert.equal(getCellValue(next, 0, 2), "stay", "column beside the range is untouched");
});

test("AUDIT: formulas move verbatim — references are NOT rewritten (documented divergence)", () => {
  // sort.ts documents this: "Formula references move verbatim — a sort does not
  // re-base them — which is a deliberate simplification." Excel would rewrite
  // the relative references so each formula still points at its own row. This
  // test pins the documented behaviour; it is NOT flagged as a bug.
  const { ws, engine } = build({ A1: "2", A2: "1", B1: "=A1*10", B2: "=A2*10" });
  const next = applySort(ws, engine, rect(0, 0, 1, 1), 0, "asc");
  assert.equal(getCellValue(next, 0, 0), "1");
  assert.equal(getCellValue(next, 0, 1), "=A2*10", "the raw formula text moved unchanged");
  assert.equal(getCellValue(next, 1, 1), "=A1*10");
});
