import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCellRef, type Rect } from "@/lib/spreadsheet/coordinates";
import {
  createWorksheet,
  getCellStyleId,
  getCellValue,
  setCellStyleId,
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

function applySort(ws: Worksheet, engine: FormulaEngine, range: Rect, col: number, dir: "asc" | "desc"): Worksheet {
  const edits = sortRangeEdits(ws, range, col, dir, (r, c) => engine.getValue("s", r, c));
  return applyChanges(ws, buildCommand("Sort", ws, edits).changes);
}

test("numeric ascending sort moves whole rows, preserving relationships", () => {
  const { ws, engine } = build({ A1: "3", A2: "1", A3: "2", B1: "c", B2: "a", B3: "b" });
  const next = applySort(ws, engine, rect(0, 0, 2, 1), 0, "asc");
  assert.deepEqual([getCellValue(next, 0, 0), getCellValue(next, 1, 0), getCellValue(next, 2, 0)], ["1", "2", "3"]);
  // B moved WITH its row: 1↔a, 2↔b, 3↔c.
  assert.deepEqual([getCellValue(next, 0, 1), getCellValue(next, 1, 1), getCellValue(next, 2, 1)], ["a", "b", "c"]);
});

test("descending sort reverses the order", () => {
  const { ws, engine } = build({ A1: "1", A2: "3", A3: "2" });
  const next = applySort(ws, engine, rect(0, 0, 2, 0), 0, "desc");
  assert.deepEqual([getCellValue(next, 0, 0), getCellValue(next, 1, 0), getCellValue(next, 2, 0)], ["3", "2", "1"]);
});

test("alphabetical sort orders text case-insensitively", () => {
  const { ws, engine } = build({ A1: "banana", A2: "Apple", A3: "cherry" });
  const next = applySort(ws, engine, rect(0, 0, 2, 0), 0, "asc");
  assert.deepEqual([getCellValue(next, 0, 0), getCellValue(next, 1, 0), getCellValue(next, 2, 0)], ["Apple", "banana", "cherry"]);
});

test("date sort orders by serial magnitude (numbers), not text", () => {
  // Serials: DATE-like numbers. 100 (earlier) < 40000 < 45000.
  const { ws, engine } = build({ A1: "45000", A2: "100", A3: "40000" });
  const next = applySort(ws, engine, rect(0, 0, 2, 0), 0, "asc");
  assert.deepEqual([getCellValue(next, 0, 0), getCellValue(next, 1, 0), getCellValue(next, 2, 0)], ["100", "40000", "45000"]);
});

test("sort carries each row's styles along with its values", () => {
  let { ws } = build({ A1: "2", A2: "1" });
  const engine = new FormulaEngine();
  engine.setCell("s", 0, 0, "2");
  engine.setCell("s", 1, 0, "1");
  ws = setCellStyleId(ws, 0, 0, 7); // style on the "2" row
  const next = applySort(ws, engine, rect(0, 0, 1, 0), 0, "asc");
  // After sorting, "1" is on top (row 0, unstyled) and "2" with its style is row 1.
  assert.equal(getCellValue(next, 0, 0), "1");
  assert.equal(getCellStyleId(next, 0, 0), 0);
  assert.equal(getCellValue(next, 1, 0), "2");
  assert.equal(getCellStyleId(next, 1, 0), 7);
});
