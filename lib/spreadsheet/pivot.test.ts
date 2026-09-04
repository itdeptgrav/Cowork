import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPivot, pivotFields, pivotFootprint, pivotWrites, readPivots, type SourceCell } from "./pivot";

const cell = (t: string | number): SourceCell => (typeof t === "number" ? { text: String(t), number: t } : { text: t, number: t.trim() !== "" && Number.isFinite(Number(t)) ? Number(t) : null });
const rows = (...lines: (string | number)[][]) => lines.map((l) => l.map(cell));

const sales = rows(
  ["Region", "Product", "Units", "Rep"],
  ["East", "Pens", 10, "Ada"],
  ["West", "Pens", 5, "Bo"],
  ["East", "Paper", 7, "Ada"],
  ["East", "Pens", 3, "Cy"],
  ["West", "Paper", "", "Bo"],
);

test("fields come from the header row, blanks named by position", () => {
  assert.deepEqual(pivotFields(sales), ["Region", "Product", "Units", "Rep"]);
  assert.deepEqual(pivotFields(rows(["A", "", "C"])), ["A", "Column 2", "C"]);
});

test("one field down the side: sums per group and a total", () => {
  const t = buildPivot(sales, { rowField: 0, valueField: 2, agg: "sum" });
  assert.deepEqual(t, [
    ["Region", "Sum of Units"],
    ["East", 20],
    ["West", 5],
    ["Total", 25],
  ]);
});

test("a second field across the top: a grid with row and column totals", () => {
  const t = buildPivot(sales, { rowField: 0, colField: 1, valueField: 2, agg: "sum" });
  assert.deepEqual(t, [
    ["Region", "Paper", "Pens", "Total"],
    ["East", 7, 13, 20],
    ["West", "", 5, 5],
    ["Total", 7, 18, 25],
  ]);
});

test("count counts filled values; average, min and max read the numbers", () => {
  assert.deepEqual(buildPivot(sales, { rowField: 0, valueField: 2, agg: "count" }).slice(1), [["East", 3], ["West", 1], ["Total", 4]]);
  assert.deepEqual(buildPivot(sales, { rowField: 0, valueField: 2, agg: "average" })[1], ["East", 20 / 3]);
  assert.deepEqual(buildPivot(sales, { rowField: 0, valueField: 2, agg: "min" })[1], ["East", 3]);
  assert.deepEqual(buildPivot(sales, { rowField: 0, valueField: 2, agg: "max" })[2], ["West", 5]);
  const empty = buildPivot(sales, { rowField: 0, valueField: 3, agg: "sum" });
  assert.deepEqual(empty[1], ["East", ""], "no numbers to sum reads as empty, not 0");
});

test("numeric keys sort numerically; empty records are skipped", () => {
  const years = rows(["Year", "Amount"], [2024, 1], [2026, 2], [2025, 3], ["", ""]);
  const t = buildPivot(years, { rowField: 0, valueField: 1, agg: "sum" });
  assert.deepEqual(t.map((l) => l[0]), ["Year", "2024", "2025", "2026", "Total"]);
});

test("writes place the table from an anchor with numbers as plain text", () => {
  const t = buildPivot(sales, { rowField: 0, valueField: 2, agg: "average" });
  const writes = pivotWrites(t, { row: 2, col: 1 });
  assert.deepEqual(writes[0], { row: 2, col: 1, value: "Region" });
  assert.deepEqual(writes[3], { row: 3, col: 2, value: "6.66666666666667" });
  assert.deepEqual(pivotFootprint(t, { row: 2, col: 1 }), { top: 2, left: 1, bottom: 5, right: 2 });
});

test("stored definitions are read defensively", () => {
  const good = { id: "p1", source: { sheetId: "s1", rect: { top: 0, left: 0, bottom: 5, right: 3 } }, spec: { rowField: 0, colField: 1, valueField: 2, agg: "sum" }, target: { sheetId: "s2", row: 0, col: 0 } };
  const list = readPivots([good, { id: "bad", spec: { agg: "median" } }, null]);
  assert.deepEqual(list, [good]);
  assert.equal(readPivots([]), undefined);
});
