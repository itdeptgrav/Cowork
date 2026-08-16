import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCellRef, type Rect } from "@/lib/spreadsheet/coordinates";
import { FormulaEngine } from "@/lib/spreadsheet/formula";
import { columnValues, computeFilterHidden, type SheetFilter } from "@/lib/spreadsheet/filter";

function engineOf(cells: Record<string, string>): FormulaEngine {
  const engine = new FormulaEngine();
  for (const [ref, value] of Object.entries(cells)) {
    const p = parseCellRef(ref)!;
    engine.setCell("s", p.row, p.col, value);
  }
  return engine;
}
const rect = (t: number, l: number, b: number, r: number): Rect => ({ top: t, left: l, bottom: b, right: r });

/* A little table: header in row 0, data rows 1..4.
   Col A (fruit) / Col B (qty). */
const TABLE = {
  A1: "Fruit", B1: "Qty",
  A2: "apple", B2: "5",
  A3: "banana", B3: "15",
  A4: "apple", B4: "25",
  A5: "cherry", B5: "3",
};

function providers(engine: FormulaEngine) {
  const displayAt = (r: number, c: number) => engine.display("s", r, c).text;
  const numberAt = (r: number, c: number) => {
    const v = engine.getValue("s", r, c);
    return typeof v === "number" ? v : null;
  };
  return { displayAt, numberAt };
}

test("filter by value hides rows whose value is not selected", () => {
  const engine = engineOf(TABLE);
  const { displayAt, numberAt } = providers(engine);
  const filter: SheetFilter = { range: rect(0, 0, 4, 1), columns: { 0: { values: ["apple"] } } };
  const hidden = computeFilterHidden(filter, displayAt, numberAt);
  // Only the two "apple" rows (2 and 4) stay; banana(3) and cherry(5=row4) hide.
  assert.deepEqual(Object.keys(hidden).map(Number).sort(), [2, 4]); // rows 3 and 5 (0-based 2,4)... check indices
});

test("filter by number condition (greater than)", () => {
  const engine = engineOf(TABLE);
  const { displayAt, numberAt } = providers(engine);
  const filter: SheetFilter = {
    range: rect(0, 0, 4, 1),
    columns: { 1: { condition: { type: "number", op: ">", a: 10 } } },
  };
  const hidden = computeFilterHidden(filter, displayAt, numberAt);
  // Qty > 10 keeps rows with 15 and 25 (0-based rows 2 and 3); hides 5 and 3.
  assert.deepEqual(Object.keys(hidden).map(Number).sort(), [1, 4]);
});

test("filter by text condition (contains)", () => {
  const engine = engineOf(TABLE);
  const { displayAt, numberAt } = providers(engine);
  const filter: SheetFilter = {
    range: rect(0, 0, 4, 1),
    columns: { 0: { condition: { type: "text", op: "contains", value: "err" } } },
  };
  const hidden = computeFilterHidden(filter, displayAt, numberAt);
  // Only "cherry" contains "err" → keep row 4 (0-based); hide the rest (1,2,3).
  assert.deepEqual(Object.keys(hidden).map(Number).sort(), [1, 2, 3]);
});

test("multiple column filters combine (a row must pass all)", () => {
  const engine = engineOf(TABLE);
  const { displayAt, numberAt } = providers(engine);
  const filter: SheetFilter = {
    range: rect(0, 0, 4, 1),
    columns: {
      0: { values: ["apple"] },
      1: { condition: { type: "number", op: ">", a: 10 } },
    },
  };
  const hidden = computeFilterHidden(filter, displayAt, numberAt);
  // apple AND qty>10 → only row with apple/25 (0-based row 3). Hide 1,2,4.
  assert.deepEqual(Object.keys(hidden).map(Number).sort(), [1, 2, 4]);
});

test("clearing the filter (no columns) hides nothing — data intact", () => {
  const engine = engineOf(TABLE);
  const { displayAt, numberAt } = providers(engine);
  const filter: SheetFilter = { range: rect(0, 0, 4, 1), columns: {} };
  assert.deepEqual(computeFilterHidden(filter, displayAt, numberAt), {});
});

test("columnValues lists the distinct displayed values (for the value picker)", () => {
  const engine = engineOf(TABLE);
  const { displayAt } = providers(engine);
  assert.deepEqual(columnValues(rect(0, 0, 4, 1), 0, displayAt), ["apple", "banana", "cherry"]);
});
