import assert from "node:assert/strict";
import { test } from "node:test";
import { cellRef, type Rect } from "@/lib/spreadsheet/coordinates";
import { createWorksheet, setCellValue, type Worksheet } from "@/lib/spreadsheet/model";
import { FormulaEngine } from "@/lib/spreadsheet/formula";
import {
  clearSourceEdits,
  copyRange,
  fromTSV,
  parseTSV,
  pasteEdits,
  pasteRect,
  toTSV,
  transposeClipboard,
} from "@/lib/spreadsheet/clipboard";

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

test("copy reads a range's raw content, keeping formulas", () => {
  const ws = sheet({ A1: "1", B1: "=A1*2", A2: "3", B2: "=A2*2" });
  const clip = copyRange(ws, rect(0, 0, 1, 1));
  assert.equal(clip.rows, 2);
  assert.equal(clip.cols, 2);
  assert.deepEqual(clip.cells, [
    ["1", "=A1*2"],
    ["3", "=A2*2"],
  ]);
  assert.equal(clip.cut, false);
});

test("copied formulas re-base when pasted to a new origin (requirement 7)", () => {
  const ws = sheet({ A1: "10", B1: "=A1*2" });
  const clip = copyRange(ws, rect(0, 1, 0, 1)); // just B1
  // Paste into B2 — one row down.
  const edits = pasteEdits(clip, { row: 1, col: 1 }, BOUNDS, true);
  assert.deepEqual(edits, [{ row: 1, col: 1, raw: "=A2*2" }]);
});

test("a cut pastes formulas verbatim — no re-basing", () => {
  const ws = sheet({ B1: "=A1*2" });
  const clip = copyRange(ws, rect(0, 1, 0, 1), true);
  const edits = pasteEdits(clip, { row: 1, col: 1 }, BOUNDS, false);
  assert.deepEqual(edits, [{ row: 1, col: 1, raw: "=A1*2" }]);
});

test("cut clears its whole source region", () => {
  const ws = sheet({ A1: "x", B1: "y" });
  const clip = copyRange(ws, rect(0, 0, 0, 1), true);
  assert.deepEqual(clearSourceEdits(clip), [
    { row: 0, col: 0, raw: "" },
    { row: 0, col: 1, raw: "" },
  ]);
});

test("toTSV serialises the DISPLAYED values, tab- and newline-separated", () => {
  const ws = sheet({ A1: "10", B1: "20", C1: "30", A2: "40", B2: "50", C2: "60" });
  const engine = new FormulaEngine();
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) engine.setCell("s", r, c, ws.cells[cellRef(r, c)]?.value ?? "");
  }
  assert.equal(toTSV(ws, engine, "s", rect(0, 0, 1, 2)), "10\t20\t30\n40\t50\t60");
});

test("toTSV shows a formula's computed value, not its source", () => {
  const ws = sheet({ A1: "5", B1: "=A1*2" });
  const engine = new FormulaEngine();
  engine.setCell("s", 0, 0, "5");
  engine.setCell("s", 0, 1, "=A1*2");
  assert.equal(toTSV(ws, engine, "s", rect(0, 0, 0, 1)), "5\t10");
});

test("parseTSV turns tab-separated text into a rectangular grid (the spec example)", () => {
  // "10 20 30 / 40 50 60" pastes into a 2×3 range.
  const grid = parseTSV("10\t20\t30\n40\t50\t60");
  assert.deepEqual(grid, [
    ["10", "20", "30"],
    ["40", "50", "60"],
  ]);
});

test("parseTSV handles CRLF, a trailing newline, and ragged rows", () => {
  const grid = parseTSV("a\tb\r\nc\r\n");
  assert.deepEqual(grid, [
    ["a", "b"],
    ["c", ""],
  ]);
});

test("an external TSV paste lands as a 2×3 block of raw values", () => {
  const clip = fromTSV("10\t20\t30\n40\t50\t60");
  assert.equal(clip.rows, 2);
  assert.equal(clip.cols, 3);
  const edits = pasteEdits(clip, { row: 2, col: 1 }, BOUNDS, false);
  // Row 0 of the block lands on row 2 (C… actually B) — check a couple of anchors.
  assert.deepEqual(edits[0], { row: 2, col: 1, raw: "10" });
  assert.deepEqual(edits[5], { row: 3, col: 3, raw: "60" });
  assert.equal(edits.length, 6);
});

test("a paste is clipped to the grid rather than clamped onto the last cell", () => {
  const clip = fromTSV("1\t2\n3\t4");
  const edits = pasteEdits(clip, { row: 0, col: 25 }, BOUNDS, false); // col 26 is off-sheet
  // Only the left column of the block fits; the right column is dropped.
  assert.deepEqual(edits, [
    { row: 0, col: 25, raw: "1" },
    { row: 1, col: 25, raw: "3" },
  ]);
});

test("pasteRect is the block anchored at the target, clipped to the grid", () => {
  const clip = fromTSV("1\t2\t3");
  assert.deepEqual(pasteRect(clip, { row: 4, col: 0 }, BOUNDS), rect(4, 0, 4, 2));
});

test("a transposed clipboard turns rows into columns and keeps styles with their cells", () => {
  const clip = {
    rows: 2,
    cols: 3,
    cells: [["a", "b", "c"], ["d", "e", "f"]],
    styles: [[1, 0, 0], [0, 0, 2]],
    source: { top: 5, left: 1, bottom: 6, right: 3 },
    cut: true,
  } as unknown as Parameters<typeof transposeClipboard>[0];
  const t = transposeClipboard(clip);
  assert.equal(t.rows, 3);
  assert.equal(t.cols, 2);
  assert.deepEqual(t.cells, [["a", "d"], ["b", "e"], ["c", "f"]]);
  assert.deepEqual(t.styles, [[1, 0], [0, 0], [0, 2]]);
  assert.deepEqual(t.source, { top: 5, left: 1, bottom: 7, right: 2 });
  assert.equal(t.cut, false, "a transpose never clears the source");
});
