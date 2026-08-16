import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCellRef, type Rect } from "@/lib/spreadsheet/coordinates";
import { applyCellWrites, createWorksheet, getCellValue, type Worksheet } from "@/lib/spreadsheet/model";
import { applyChanges, buildCommand } from "@/lib/spreadsheet/history";
import {
  addRowGroup,
  collapsedRows,
  removeRowGroup,
  splitField,
  subtotalPlan,
  textToColumnsEdits,
  textToColumnsWidth,
  toggleRowGroup,
} from "@/lib/spreadsheet/datatools";

const rect = (t: number, l: number, b: number, r: number): Rect => ({ top: t, left: l, bottom: b, right: r });

function build(cells: Record<string, string>): Worksheet {
  const ws = createWorksheet("s", "Sheet1");
  return applyCellWrites(
    ws,
    Object.entries(cells).map(([ref, value]) => {
      const p = parseCellRef(ref)!;
      return { row: p.row, col: p.col, value };
    }),
  );
}

/* ── Text to columns ──────────────────────────────────────────────────────── */

test("splits on each delimiter kind", () => {
  assert.deepEqual(splitField("a,b,c", "comma"), ["a", "b", "c"]);
  assert.deepEqual(splitField("a\tb", "tab"), ["a", "b"]);
  assert.deepEqual(splitField("a;b", "semicolon"), ["a", "b"]);
  assert.deepEqual(splitField("a b", "space"), ["a", "b"]);
});

test("a quoted delimiter stays inside its field", () => {
  assert.deepEqual(splitField('"Smith, John",42', "comma"), ["Smith, John", "42"]);
  assert.deepEqual(splitField('"she said ""hi""",x', "comma"), ['she said "hi"', "x"]);
});

test("a run of whitespace is ONE separator; a run of commas is not", () => {
  assert.deepEqual(splitField("a   b", "space"), ["a", "b"]);
  assert.deepEqual(splitField("a,,b", "comma"), ["a", "", "b"], "an empty field is preserved");
});

test("text with no delimiter comes back as a single field", () => {
  assert.deepEqual(splitField("plain", "comma"), ["plain"]);
  assert.deepEqual(splitField("", "comma"), [""]);
});

test("textToColumns spreads the first column rightwards and leaves blanks alone", () => {
  const ws = build({ A1: "a,b,c", A2: "", A3: "x,y" });
  const edits = textToColumnsEdits(ws, rect(0, 0, 2, 0), "comma", 100);
  const next = applyChanges(ws, buildCommand("Split", ws, edits).changes);
  assert.deepEqual([getCellValue(next, 0, 0), getCellValue(next, 0, 1), getCellValue(next, 0, 2)], ["a", "b", "c"]);
  assert.equal(getCellValue(next, 1, 0), "", "an empty source row is skipped");
  assert.deepEqual([getCellValue(next, 2, 0), getCellValue(next, 2, 1)], ["x", "y"]);
});

test("textToColumns drops parts that fall past the last column", () => {
  const ws = build({ A1: "a,b,c" });
  // A sheet only 2 columns wide: "c" has nowhere to go.
  const edits = textToColumnsEdits(ws, rect(0, 0, 0, 0), "comma", 2);
  assert.deepEqual(edits.map((e) => e.col), [0, 1]);
});

test("textToColumnsWidth reports the widest row, for warning what gets overwritten", () => {
  const ws = build({ A1: "a,b", A2: "a,b,c,d", A3: "a" });
  assert.equal(textToColumnsWidth(ws, rect(0, 0, 2, 0), "comma"), 4);
});

/* ── Subtotal ─────────────────────────────────────────────────────────────── */

test("subtotalPlan breaks where the grouping value changes", () => {
  const values: Record<string, string> = {
    "0:0": "North", "1:0": "North", "2:0": "South", "3:0": "South", "4:0": "East",
  };
  const at = (r: number, c: number) => values[`${r}:${c}`] ?? "";
  const plan = subtotalPlan(rect(0, 0, 4, 1), 0, at);
  assert.deepEqual(
    plan.map((p) => [p.label, p.from, p.to]),
    [["North", 0, 1], ["South", 2, 3], ["East", 4, 4]],
  );
});

test("subtotalPlan on one group yields a single total", () => {
  const at = () => "Same";
  const plan = subtotalPlan(rect(0, 0, 3, 0), 0, at);
  assert.equal(plan.length, 1);
  assert.deepEqual([plan[0].from, plan[0].to], [0, 3]);
});

test("subtotalPlan treats a repeated value AFTER a break as a new group", () => {
  // Excel's rule: groups are runs, not every row sharing a value.
  const values = ["A", "B", "A"];
  const at = (r: number) => values[r] ?? "";
  const plan = subtotalPlan(rect(0, 0, 2, 0), 0, at);
  assert.deepEqual(plan.map((p) => p.label), ["A", "B", "A"]);
});

/* ── Outline ──────────────────────────────────────────────────────────────── */

test("a group needs two or more rows", () => {
  assert.equal(addRowGroup(undefined, 3, 3), undefined, "a single row is not a group");
  assert.deepEqual(addRowGroup(undefined, 1, 4), [{ from: 1, to: 4 }]);
});

test("a new group replaces one it overlaps, and leaves separate ones alone", () => {
  let g = addRowGroup(undefined, 1, 4);
  g = addRowGroup(g, 10, 12);
  g = addRowGroup(g, 2, 6); // overlaps the first only
  assert.deepEqual(g, [{ from: 10, to: 12 }, { from: 2, to: 6 }]);
});

test("ungroup removes only the intersecting bands", () => {
  let g = addRowGroup(undefined, 1, 4);
  g = addRowGroup(g, 10, 12);
  g = removeRowGroup(g, 11, 11);
  assert.deepEqual(g, [{ from: 1, to: 4 }]);
  assert.equal(removeRowGroup(g, 1, 4), undefined, "removing the last clears the field");
});

test("collapsing hides every row but the first — the handle to expand from", () => {
  let g = addRowGroup(undefined, 2, 5);
  assert.deepEqual(collapsedRows(g), {}, "an expanded group hides nothing");
  g = toggleRowGroup(g, 2, 5, true);
  assert.deepEqual(collapsedRows(g), { 3: true, 4: true, 5: true });
  g = toggleRowGroup(g, 2, 5, false);
  assert.deepEqual(collapsedRows(g), {}, "expanding brings them all back");
});

test("collapsed state survives adding an unrelated group", () => {
  let g = toggleRowGroup(addRowGroup(undefined, 2, 4), 2, 4, true);
  g = addRowGroup(g, 10, 12);
  assert.deepEqual(collapsedRows(g), { 3: true, 4: true });
});
