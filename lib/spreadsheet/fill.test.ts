import assert from "node:assert/strict";
import { test } from "node:test";
import { type Rect } from "@/lib/spreadsheet/coordinates";
import { createWorksheet, setCellValue, type Worksheet } from "@/lib/spreadsheet/model";
import { computeFill, fillDestRect, fillSeries } from "@/lib/spreadsheet/fill";

const BOUNDS = { rows: 100, cols: 26 };

function sheet(cells: Record<string, string>): Worksheet {
  let ws = createWorksheet("s", "Sheet1");
  for (const [ref, value] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    const col = m[1].charCodeAt(0) - 65;
    const row = Number(m[2]) - 1;
    ws = setCellValue(ws, row, col, value);
  }
  return ws;
}

function rect(top: number, left: number, bottom: number, right: number): Rect {
  return { top, left, bottom, right };
}

test("fillSeries: two numbers set the step and continue it (1,2 → 3,4,5,6)", () => {
  assert.deepEqual(fillSeries(["1", "2"], 4, "row", 1), ["3", "4", "5", "6"]);
});

test("fillSeries: a lone number has step zero and simply repeats", () => {
  assert.deepEqual(fillSeries(["5"], 3, "row", 1), ["5", "5", "5"]);
});

test("fillSeries: a decreasing step is continued (10,8 → 6,4,2)", () => {
  assert.deepEqual(fillSeries(["10", "8"], 3, "row", 1), ["6", "4", "2"]);
});

test("fillSeries: a formula's relative references walk with the fill", () => {
  assert.deepEqual(fillSeries(["=A1*2"], 3, "row", 1), ["=A2*2", "=A3*2", "=A4*2"]);
});

test("fillSeries: text repeats cell for cell", () => {
  assert.deepEqual(fillSeries(["x", "y"], 4, "row", 1), ["x", "y", "x", "y"]);
});

test("fillSeries: a reverse drag negates the reference shift (fill up)", () => {
  // Source reversed for an upward drag; the last source cell sits next to the
  // first generated one, and references move the other way.
  assert.deepEqual(fillSeries(["=A5"], 2, "row", -1), ["=A4", "=A3"]);
});

test("computeFill: dragging a numeric pair down continues the sequence", () => {
  const ws = sheet({ A1: "1", A2: "2" });
  const { dest, edits } = computeFill(ws, rect(0, 0, 1, 0), { row: 5, col: 0 }, BOUNDS);
  assert.deepEqual(dest, rect(0, 0, 5, 0));
  assert.deepEqual(edits, [
    { row: 2, col: 0, raw: "3" },
    { row: 3, col: 0, raw: "4" },
    { row: 4, col: 0, raw: "5" },
    { row: 5, col: 0, raw: "6" },
  ]);
});

test("computeFill: dragging a formula down adjusts each copy", () => {
  const ws = sheet({ B1: "=A1*2" });
  const { edits } = computeFill(ws, rect(0, 1, 0, 1), { row: 2, col: 1 }, BOUNDS);
  assert.deepEqual(edits, [
    { row: 1, col: 1, raw: "=A2*2" },
    { row: 2, col: 1, raw: "=A3*2" },
  ]);
});

test("computeFill: dragging right continues along columns", () => {
  const ws = sheet({ A1: "1", B1: "2" });
  const { dest, edits } = computeFill(ws, rect(0, 0, 0, 1), { row: 0, col: 4 }, BOUNDS);
  assert.deepEqual(dest, rect(0, 0, 0, 4));
  assert.deepEqual(edits, [
    { row: 0, col: 2, raw: "3" },
    { row: 0, col: 3, raw: "4" },
    { row: 0, col: 4, raw: "5" },
  ]);
});

test("computeFill: each column of a multi-column source fills independently", () => {
  const ws = sheet({ A1: "1", B1: "10", A2: "2", B2: "20" });
  const { edits } = computeFill(ws, rect(0, 0, 1, 1), { row: 3, col: 1 }, BOUNDS);
  assert.deepEqual(edits, [
    { row: 2, col: 0, raw: "3" },
    { row: 3, col: 0, raw: "4" },
    { row: 2, col: 1, raw: "30" },
    { row: 3, col: 1, raw: "40" },
  ]);
});

test("computeFill: the dominant axis wins, and a no-move drag does nothing", () => {
  const ws = sheet({ A1: "1", A2: "2" });
  // Dragged mostly downward → vertical fill, horizontal drift ignored.
  const down = computeFill(ws, rect(0, 0, 1, 0), { row: 4, col: 1 }, BOUNDS);
  assert.equal(down.dest.bottom, 4);
  assert.equal(down.dest.right, 0);
  // Dragged back inside the source → nothing to fill.
  const none = computeFill(ws, rect(0, 0, 1, 0), { row: 1, col: 0 }, BOUNDS);
  assert.deepEqual(none.edits, []);
});

test("fillDestRect previews the destination without touching the sheet", () => {
  assert.deepEqual(fillDestRect(rect(0, 0, 1, 0), { row: 6, col: 0 }, BOUNDS), rect(0, 0, 6, 0));
  assert.deepEqual(fillDestRect(rect(2, 2, 2, 2), { row: 0, col: 2 }, BOUNDS), rect(0, 2, 2, 2));
});
