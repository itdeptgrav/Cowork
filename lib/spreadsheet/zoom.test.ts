import assert from "node:assert/strict";
import { test } from "node:test";
import { clampZoom, colWidth, rowHeight, scaleMetrics, totalWidth, type GridMetrics } from "./metrics";

const base: GridMetrics = {
  rows: 10,
  cols: 4,
  defaultRowHeight: 24,
  defaultColWidth: 100,
  rowHeights: { 2: 40 },
  colWidths: { 1: 150 },
  hiddenRows: { 5: true },
  hiddenCols: {},
};

test("zoom scales every height and width and keeps hidden lines hidden", () => {
  const z = scaleMetrics(base, 1.5);
  assert.equal(rowHeight(z, 0), 36);
  assert.equal(rowHeight(z, 2), 60);
  assert.equal(colWidth(z, 1), 225);
  assert.equal(colWidth(z, 0), 150);
  assert.equal(rowHeight(z, 5), 0, "a hidden row stays hidden");
  assert.equal(totalWidth(z), 150 * 3 + 225);
  assert.equal(scaleMetrics(base, 1), base, "no zoom is the same object");
});

test("zoom is clamped to a sensible range", () => {
  assert.equal(clampZoom(0.1), 0.5);
  assert.equal(clampZoom(9), 2);
  assert.equal(clampZoom(1.2345), 1.23);
});
