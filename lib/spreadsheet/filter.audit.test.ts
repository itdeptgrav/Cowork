/**
 * Filter audit — reference semantics are Google Sheets / Excel.
 *
 * A filter HIDES non-matching data rows; it never edits data. The header row
 * (range.top) is never hidden, rows outside the range are never hidden, all
 * column criteria AND together, text criteria are case-insensitive, and
 * ordinary aggregates (SUM) still see filtered-out rows.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCellRef, type Rect } from "@/lib/spreadsheet/coordinates";
import { FormulaEngine } from "@/lib/spreadsheet/formula";
import {
  columnValues,
  computeFilterHidden,
  type SheetFilter,
} from "@/lib/spreadsheet/filter";
import {
  createWorksheet,
  setCellValue,
  type Worksheet,
} from "@/lib/spreadsheet/model";
import { applyChanges, buildCommand } from "@/lib/spreadsheet/history";
import { sortRangeEdits } from "@/lib/spreadsheet/sort";

function engineOf(cells: Record<string, string>): FormulaEngine {
  const engine = new FormulaEngine();
  for (const [ref, value] of Object.entries(cells)) {
    const p = parseCellRef(ref)!;
    engine.setCell("s", p.row, p.col, value);
  }
  return engine;
}
const rect = (t: number, l: number, b: number, r: number): Rect => ({ top: t, left: l, bottom: b, right: r });

function providers(engine: FormulaEngine) {
  const displayAt = (r: number, c: number) => engine.display("s", r, c).text;
  const numberAt = (r: number, c: number) => {
    const v = engine.getValue("s", r, c);
    return typeof v === "number" ? v : null;
  };
  return { displayAt, numberAt };
}

const hiddenRows = (f: SheetFilter, engine: FormulaEngine) => {
  const { displayAt, numberAt } = providers(engine);
  return Object.keys(computeFilterHidden(f, displayAt, numberAt))
    .map(Number)
    .sort((a, b) => a - b);
};

/* Header row 0; data rows 1..3. */
const NUMS = { A1: "Item", B1: "Qty", A2: "apple", B2: "5", A3: "banana", B3: "15", A4: "cherry", B4: "25" };

test("AUDIT: number operators at their boundaries", () => {
  const engine = engineOf(NUMS);
  const cond = (op: ">" | "<" | ">=" | "<=" | "=" | "<>", a: number): SheetFilter => ({
    range: rect(0, 0, 3, 1),
    columns: { 1: { condition: { type: "number", op, a } } },
  });
  assert.deepEqual(hiddenRows(cond(">", 15), engine), [1, 2], "> 15 keeps only 25");
  assert.deepEqual(hiddenRows(cond(">=", 15), engine), [1], ">= 15 keeps 15 and 25");
  assert.deepEqual(hiddenRows(cond("<", 15), engine), [2, 3], "< 15 keeps only 5");
  assert.deepEqual(hiddenRows(cond("<=", 15), engine), [3], "<= 15 keeps 5 and 15");
  assert.deepEqual(hiddenRows(cond("=", 15), engine), [1, 3], "= 15 keeps only 15");
  assert.deepEqual(hiddenRows(cond("<>", 15), engine), [2], "<> 15 hides only 15");
});

test("AUDIT: between is inclusive at both ends, and falls back to a single bound", () => {
  const engine = engineOf(NUMS);
  const between: SheetFilter = {
    range: rect(0, 0, 3, 1),
    columns: { 1: { condition: { type: "number", op: "between", a: 5, b: 15 } } },
  };
  assert.deepEqual(hiddenRows(between, engine), [3], "5 and 15 both pass; 25 hides");
  const degenerate: SheetFilter = {
    range: rect(0, 0, 3, 1),
    columns: { 1: { condition: { type: "number", op: "between", a: 15 } } },
  };
  assert.deepEqual(hiddenRows(degenerate, engine), [1, 3], "missing b means between a and a");
});

test("AUDIT: a number condition hides rows whose cell is blank or text", () => {
  // Excel: a number criterion is failed by anything that is not a number.
  const engine = engineOf({ A1: "Qty", A2: "5", A3: "", A4: "n/a" });
  const f: SheetFilter = {
    range: rect(0, 0, 3, 0),
    columns: { 0: { condition: { type: "number", op: ">", a: 0 } } },
  };
  assert.deepEqual(hiddenRows(f, engine), [2, 3], "blank and text rows hide under > 0");
});

test("AUDIT: text conditions are case-insensitive across every operator", () => {
  const engine = engineOf({ A1: "Item", A2: "Banana", A3: "cherry", A4: "APPLE" });
  const f = (op: "contains" | "equals" | "startsWith" | "endsWith" | "notEquals" | "notContains", value: string): SheetFilter => ({
    range: rect(0, 0, 3, 0),
    columns: { 0: { condition: { type: "text", op, value } } },
  });
  assert.deepEqual(hiddenRows(f("equals", "banana"), engine), [2, 3]);
  assert.deepEqual(hiddenRows(f("contains", "ERR"), engine), [1, 3], "cherry contains err");
  assert.deepEqual(hiddenRows(f("startsWith", "app"), engine), [1, 2]);
  assert.deepEqual(hiddenRows(f("endsWith", "RRY"), engine), [1, 3]);
  assert.deepEqual(hiddenRows(f("notEquals", "Apple"), engine), [3], "hides only APPLE");
  assert.deepEqual(hiddenRows(f("notContains", "an"), engine), [1], "hides only Banana");
});

test("AUDIT: 'does not contain' keeps blank rows visible", () => {
  const engine = engineOf({ A1: "Item", A2: "alpha", A3: "" });
  const f: SheetFilter = {
    range: rect(0, 0, 2, 0),
    columns: { 0: { condition: { type: "text", op: "notContains", value: "alpha" } } },
  };
  assert.deepEqual(hiddenRows(f, engine), [1], "the blank row passes 'does not contain'");
});

test("AUDIT: a value list and a condition on the SAME column must both pass", () => {
  const engine = engineOf(NUMS);
  const f: SheetFilter = {
    range: rect(0, 0, 3, 1),
    columns: {
      0: { values: ["apple", "banana"], condition: { type: "text", op: "contains", value: "an" } },
    },
  };
  // apple passes the list but not the condition; cherry passes neither.
  assert.deepEqual(hiddenRows(f, engine), [1, 3]);
});

test("AUDIT: conditions on different columns AND together", () => {
  const engine = engineOf(NUMS);
  const f: SheetFilter = {
    range: rect(0, 0, 3, 1),
    columns: {
      0: { condition: { type: "text", op: "contains", value: "a" } }, // apple, banana
      1: { condition: { type: "number", op: ">", a: 10 } }, // 15, 25
    },
  };
  assert.deepEqual(hiddenRows(f, engine), [1, 3], "only banana (15) passes both");
});

test("AUDIT: the header row is never hidden, even when it fails every criterion", () => {
  const engine = engineOf(NUMS);
  const f: SheetFilter = { range: rect(0, 0, 3, 0), columns: { 0: { values: ["apple"] } } };
  const hidden = computeFilterHidden(f, providers(engine).displayAt, providers(engine).numberAt);
  assert.equal(hidden[0], undefined, "row 0 is the header; 'Item' fails the list but stays");
});

test("AUDIT: rows outside the filter range are never hidden", () => {
  const engine = engineOf({ ...NUMS, A6: "zzz" }); // row index 5, outside the range
  const f: SheetFilter = { range: rect(0, 0, 3, 0), columns: { 0: { values: ["apple"] } } };
  const hidden = computeFilterHidden(f, providers(engine).displayAt, providers(engine).numberAt);
  assert.equal(hidden[5], undefined);
  assert.equal(hidden[4], undefined, "even the row just past the bottom stays");
});

test("AUDIT: filtering computes hiding only — the data is untouched and SUM still sees hidden rows", () => {
  const engine = engineOf({ ...NUMS, B6: "=SUM(B2:B4)" });
  assert.equal(engine.getValue("s", 5, 1), 45);
  const f: SheetFilter = {
    range: rect(0, 0, 3, 1),
    columns: { 1: { condition: { type: "number", op: ">", a: 10 } } },
  };
  const hidden = hiddenRows(f, engine);
  assert.deepEqual(hidden, [1], "apple (5) is filtered out");
  // The aggregate is unchanged: filtering hides rows, it does not remove them.
  assert.equal(engine.getValue("s", 5, 1), 45, "SUM includes the hidden row (Sheets/Excel)");
  assert.equal(engine.display("s", 1, 1).text, "5", "the hidden cell still holds its value");
});

test("AUDIT: after a sort, recomputing the filter follows the moved values", () => {
  // banana 15 / apple 5 / cherry 25 under a header; filter Qty > 10.
  let ws: Worksheet = createWorksheet("s", "Sheet1");
  const engine = new FormulaEngine();
  const cells: Record<string, string> = {
    A1: "Fruit", B1: "Qty", A2: "banana", B2: "15", A3: "apple", B3: "5", A4: "cherry", B4: "25",
  };
  for (const [ref, value] of Object.entries(cells)) {
    const p = parseCellRef(ref)!;
    ws = setCellValue(ws, p.row, p.col, value);
    engine.setCell("s", p.row, p.col, value);
  }
  const f: SheetFilter = {
    range: rect(0, 0, 3, 1),
    columns: { 1: { condition: { type: "number", op: ">", a: 10 } } },
  };
  assert.deepEqual(hiddenRows(f, engine), [2], "before the sort, apple sits in row 2");

  // Sort the data rows by Qty ascending, mirroring each edit into the engine.
  const edits = sortRangeEdits(ws, rect(1, 0, 3, 1), 1, "asc", (r, c) => engine.getValue("s", r, c));
  ws = applyChanges(ws, buildCommand("Sort", ws, edits).changes);
  for (const e of edits) if (e.raw !== undefined) engine.setCell("s", e.row, e.col, e.raw);

  assert.deepEqual(hiddenRows(f, engine), [1], "after the sort, apple (5) is row 1 and hides there");
});

test("AUDIT: columnValues lists distinct displayed values, excludes the header, includes blank once", () => {
  const engine = engineOf({ A1: "Fruit", A2: "b", A3: "", A4: "a", A5: "b" });
  const { displayAt } = providers(engine);
  const values = columnValues(rect(0, 0, 4, 0), 0, displayAt);
  assert.deepEqual(values, ["", "a", "b"], "deduped, sorted, no 'Fruit', one blank entry");
});
