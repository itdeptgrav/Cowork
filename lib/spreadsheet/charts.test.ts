import assert from "node:assert/strict";
import { test } from "node:test";
import { addChart, chartModel, newChart, raiseChart, readCharts, removeChart, shiftCharts, updateChart, type ChartSpec } from "./charts";

/** A tiny sheet: labels down A, two headed series in B and C. */
const grid: Record<string, string> = {
  "0,0": "", "0,1": "Sales", "0,2": "Costs",
  "1,0": "Jan", "1,1": "10", "1,2": "4",
  "2,0": "Feb", "2,1": "20", "2,2": "x",
  "3,0": "Mar", "3,1": "30", "3,2": "6",
};
const cell = (r: number, c: number) => {
  const t = grid[`${r},${c}`] ?? "";
  const n = t !== "" && Number.isFinite(Number(t)) ? Number(t) : null;
  return { text: t, number: n };
};

test("a headed block charts labels from the first column and a series per further column", () => {
  const m = chartModel({ top: 0, left: 0, bottom: 3, right: 2 }, cell);
  assert.deepEqual(m.labels, ["Jan", "Feb", "Mar"]);
  assert.deepEqual(m.series.map((s) => s.name), ["Sales", "Costs"]);
  assert.deepEqual(m.series[1].values, [4, 0, 6], "text is a gap");
});

test("rows orientation transposes; a single column charts against 1..n", () => {
  const m = chartModel({ top: 0, left: 0, bottom: 3, right: 2 }, cell, "rows");
  assert.deepEqual(m.labels, ["Sales", "Costs"]);
  assert.deepEqual(m.series.map((s) => s.name), ["Jan", "Feb", "Mar"]);
  const one = chartModel({ top: 0, left: 1, bottom: 3, right: 1 }, cell);
  assert.deepEqual(one.labels, ["1", "2", "3"]);
  assert.deepEqual(one.series, [{ name: "Sales", values: [10, 20, 30] }]);
});

test("charts are added, changed, raised and removed by id", () => {
  const rect = { top: 0, left: 0, bottom: 3, right: 2 };
  let charts = addChart(undefined, newChart("c1", "column", rect, []));
  charts = addChart(charts, newChart("c2", "line", rect, charts));
  assert.equal(charts.length, 2);
  assert.notDeepEqual([charts[0].x, charts[0].y], [charts[1].x, charts[1].y], "staggered");
  assert.equal(charts[1].z, 2);
  charts = updateChart(charts, "c1", { title: "Revenue", id: "hacked" });
  assert.equal(charts[0].title, "Revenue");
  assert.equal(charts[0].id, "c1", "the id cannot be changed through a patch");
  charts = raiseChart(charts, "c1");
  assert.equal(charts[0].z, 3);
  charts = removeChart(charts, "c2");
  assert.deepEqual(charts.map((c) => c.id), ["c1"]);
});

test("inserted and deleted rows move a chart's data range", () => {
  const c: ChartSpec = { id: "c", type: "bar", rect: { top: 2, left: 0, bottom: 5, right: 1 }, title: "t" };
  assert.deepEqual(shiftCharts([c], { axis: "row", at: 0, count: 2, mode: "insert" })![0].rect, { top: 4, left: 0, bottom: 7, right: 1 });
  assert.deepEqual(shiftCharts([c], { axis: "row", at: 3, count: 1, mode: "delete" })![0].rect, { top: 2, left: 0, bottom: 4, right: 1 });
  assert.deepEqual(shiftCharts([c], { axis: "row", at: 2, count: 4, mode: "delete" })![0].rect, { top: 2, left: 0, bottom: 2, right: 1 }, "gone data keeps the chart");
  assert.equal(shiftCharts(undefined, { axis: "row", at: 0, count: 1, mode: "insert" }), undefined);
});

test("stored charts are read defensively", () => {
  const charts = readCharts([
    { id: "a", type: "pie", rect: { top: 0, left: 0, bottom: 2, right: 1 }, title: "Pie", x: 10, legend: false },
    { id: "b", type: "radar", rect: { top: 0, left: 0, bottom: 2, right: 1 } },
    { id: "c", type: "line", rect: { top: "0" } },
    null,
  ]);
  assert.deepEqual(charts?.map((c) => c.id), ["a"]);
  assert.equal(charts?.[0].legend, false);
  assert.equal(readCharts("nope"), undefined);
  assert.equal(readCharts([]), undefined);
});
