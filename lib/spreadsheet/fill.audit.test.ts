/**
 * Fill audit — the fill handle in all four directions.
 *
 * Reference semantics are Google Sheets / Excel where this engine implements
 * the behaviour, and the module's own documented series rules where it
 * deliberately simplifies (single value copies; all-numeric continues the
 * last-two-cell step; formulas walk their relative references; anything else
 * repeats). Documented simplifications are asserted as documented and recorded
 * as judgement calls in the audit report, not as bugs.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { type Rect } from "@/lib/spreadsheet/coordinates";
import {
  createWorksheet,
  setCellStyleId,
  setCellValue,
  type Worksheet,
} from "@/lib/spreadsheet/model";
import {
  computeFill,
  fillDestRect,
  fillSeries,
  fillStyleSeries,
} from "@/lib/spreadsheet/fill";

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

const rect = (top: number, left: number, bottom: number, right: number): Rect =>
  ({ top, left, bottom, right });

/* ── Series maths ─────────────────────────────────────────────────────────── */

test("AUDIT: a lone value copies in place of a series — number, text, boolean", () => {
  assert.deepEqual(fillSeries(["5"], 3, "row", 1), ["5", "5", "5"]);
  assert.deepEqual(fillSeries(["x"], 3, "row", 1), ["x", "x", "x"]);
  assert.deepEqual(fillSeries(["TRUE"], 2, "row", 1), ["TRUE", "TRUE"]);
});

test("AUDIT: two numbers set the step — ascending, gapped, descending, negative", () => {
  assert.deepEqual(fillSeries(["1", "2"], 2, "row", 1), ["3", "4"]);
  assert.deepEqual(fillSeries(["1", "3"], 2, "row", 1), ["5", "7"]);
  assert.deepEqual(fillSeries(["10", "8"], 3, "row", 1), ["6", "4", "2"]);
  assert.deepEqual(fillSeries(["-1", "-3"], 2, "row", 1), ["-5", "-7"]);
  assert.deepEqual(fillSeries(["2", "2"], 2, "row", 1), ["2", "2"], "zero step repeats");
});

test("AUDIT: numeric formats survive the maths — decimals, exponents, signs", () => {
  assert.deepEqual(fillSeries(["0.1", "0.2"], 3, "row", 1), ["0.3", "0.4", "0.5"],
    "float noise (0.2+0.1=0.30000000000000004) must not leak into cells");
  assert.deepEqual(fillSeries(["1e3", "2e3"], 2, "row", 1), ["3000", "4000"]);
  assert.deepEqual(fillSeries(["-0.5", "0"], 2, "row", 1), ["0.5", "1"]);
});

test("AUDIT: tiny magnitudes keep their precision", () => {
  /* 1e-15, 2e-15 → the series continues 3e-15, 4e-15 (what any spreadsheet
     does). numberToRaw rounds RELATIVELY (15 significant digits), so noise is
     shaved without flooring genuine sub-1e-10 values to zero. */
  assert.deepEqual(fillSeries(["1e-15", "2e-15"], 2, "row", 1), ["3e-15", "4e-15"]);
});

test("AUDIT: mixed content falls back to pattern repetition (documented rule)", () => {
  // Excel would continue the number inside the pattern; this engine documents
  // plain repetition for anything not all-numeric — judgement call, not a bug.
  assert.deepEqual(fillSeries(["1", "a"], 4, "row", 1), ["1", "a", "1", "a"]);
  assert.deepEqual(fillSeries(["Item 1"], 2, "row", 1), ["Item 1", "Item 1"],
    "text-with-trailing-number does not increment (documented divergence)");
  assert.deepEqual(fillSeries(["1", ""], 4, "row", 1), ["1", "", "1", ""]);
});

test("AUDIT: three-plus numbers continue from the LAST TWO (documented rule)", () => {
  // Excel fits a least-squares trend; this engine documents "the last two set
  // the step". 1,2,4 therefore steps by 2.
  assert.deepEqual(fillSeries(["1", "2", "4"], 2, "row", 1), ["6", "8"]);
});

test("AUDIT: formula fills walk relative refs and hold $-anchors, on the right axis", () => {
  assert.deepEqual(fillSeries(["=A1*2"], 3, "row", 1), ["=A2*2", "=A3*2", "=A4*2"]);
  assert.deepEqual(fillSeries(["=A1*2"], 2, "col", 1), ["=B1*2", "=C1*2"]);
  assert.deepEqual(fillSeries(["=$A$1"], 2, "row", 1), ["=$A$1", "=$A$1"]);
  assert.deepEqual(fillSeries(["=A$1+$B2"], 2, "row", 1), ["=A$1+$B3", "=A$1+$B4"],
    "mixed anchors: only the relative component walks");
  assert.deepEqual(fillSeries(["=SUM(A1:B2)"], 1, "row", 1), ["=SUM(A2:B3)"],
    "both range endpoints walk together");
});

test("AUDIT: a reverse drag shifts references backwards", () => {
  // Caller reverses the source for up/left; sign flips the shift.
  assert.deepEqual(fillSeries(["=A5"], 2, "row", -1), ["=A4", "=A3"]);
  assert.deepEqual(fillSeries(["=C1"], 2, "col", -1), ["=B1", "=A1"]);
});

test("AUDIT: a two-formula pattern advances by whole-pattern strides", () => {
  assert.deepEqual(
    fillSeries(["a", "=A1"], 4, "row", 1),
    ["a", "=A3", "a", "=A5"],
    "each repetition shifts by the number of rows it has advanced",
  );
});

test("AUDIT: fillStyleSeries repeats styles on the same p-mod-n mapping as values", () => {
  assert.deepEqual(fillStyleSeries([7], 3), [7, 7, 7]);
  assert.deepEqual(fillStyleSeries([1, 2], 5), [1, 2, 1, 2, 1]);
  assert.deepEqual(fillStyleSeries([], 2), [0, 0], "no source styles → default");
  assert.deepEqual(fillStyleSeries([1, 2], 0), []);
});

/* ── computeFill in all four directions ───────────────────────────────────── */

test("AUDIT: fill up continues the series backwards from the top", () => {
  const ws = sheet({ A5: "1", A6: "2" });
  const { dest, edits } = computeFill(ws, rect(4, 0, 5, 0), { row: 2, col: 0 }, BOUNDS);
  assert.deepEqual(dest, rect(2, 0, 5, 0));
  // Above 1,2 the series runs 0,-1 — exactly what Excel produces.
  assert.deepEqual(edits, [
    { row: 3, col: 0, raw: "0" },
    { row: 2, col: 0, raw: "-1" },
  ]);
});

test("AUDIT: fill left mirrors fill right, formulas and values per row", () => {
  const ws = sheet({ D1: "=D9", D2: "5" });
  const { dest, edits } = computeFill(ws, rect(0, 3, 1, 3), { row: 0, col: 1 }, BOUNDS);
  assert.deepEqual(dest, rect(0, 1, 1, 3));
  assert.deepEqual(edits, [
    { row: 0, col: 2, raw: "=C9" },
    { row: 0, col: 1, raw: "=B9" },
    { row: 1, col: 2, raw: "5" },
    { row: 1, col: 1, raw: "5" },
  ]);
});

test("AUDIT: each column fills independently on a vertical drag", () => {
  const ws = sheet({ A1: "1", B1: "x", C1: "=C9", A2: "3", B2: "y", C2: "=C10" });
  const { edits } = computeFill(ws, rect(0, 0, 1, 2), { row: 3, col: 0 }, BOUNDS);
  assert.deepEqual(edits, [
    { row: 2, col: 0, raw: "5" },
    { row: 3, col: 0, raw: "7" },
    { row: 2, col: 1, raw: "x" },
    { row: 3, col: 1, raw: "y" },
    { row: 2, col: 2, raw: "=C11" },
    { row: 3, col: 2, raw: "=C12" },
  ]);
});

test("AUDIT: styles travel with the fill and repeat in step", () => {
  let ws = sheet({ A1: "1", A2: "2" });
  ws = setCellStyleId(ws, 0, 0, 3);
  ws = setCellStyleId(ws, 1, 0, 4);
  const { styleEdits } = computeFill(ws, rect(0, 0, 1, 0), { row: 3, col: 0 }, BOUNDS);
  assert.deepEqual(styleEdits, [
    { row: 2, col: 0, style: 3 },
    { row: 3, col: 0, style: 4 },
  ]);
});

test("AUDIT: a blank source column fills blanks, not stale values", () => {
  const ws = sheet({ A1: "1" }); // B column of the source is empty
  const { edits } = computeFill(ws, rect(0, 0, 0, 1), { row: 1, col: 0 }, BOUNDS);
  assert.deepEqual(edits, [
    { row: 1, col: 0, raw: "1" },
    { row: 1, col: 1, raw: "" },
  ]);
});

/* ── Destination geometry ─────────────────────────────────────────────────── */

test("AUDIT: fillDestRect grows along the dominant axis only, ties to vertical", () => {
  const src = rect(2, 2, 3, 3);
  assert.deepEqual(fillDestRect(src, { row: 8, col: 4 }, BOUNDS), rect(2, 2, 8, 3), "down wins");
  assert.deepEqual(fillDestRect(src, { row: 4, col: 9 }, BOUNDS), rect(2, 2, 3, 9), "right wins");
  // Equal distances: the vertical drag is the documented tie-break.
  assert.deepEqual(fillDestRect(src, { row: 6, col: 6 }, BOUNDS), rect(2, 2, 6, 3));
  assert.deepEqual(fillDestRect(src, { row: 0, col: 2 }, BOUNDS), rect(0, 2, 3, 3), "up");
  assert.deepEqual(fillDestRect(src, { row: 2, col: 0 }, BOUNDS), rect(2, 0, 3, 3), "left");
});

test("AUDIT: a drag inside the source is a no-op (no shrink support, documented)", () => {
  const src = rect(2, 2, 4, 4);
  assert.deepEqual(fillDestRect(src, { row: 3, col: 3 }, BOUNDS), src);
  const ws = sheet({ C3: "1" });
  const { edits, styleEdits } = computeFill(ws, src, { row: 3, col: 3 }, BOUNDS);
  assert.deepEqual(edits, []);
  assert.deepEqual(styleEdits, []);
});

test("AUDIT: a drag past the sheet edge clamps to the boundary", () => {
  const src = rect(97, 0, 97, 0);
  assert.deepEqual(fillDestRect(src, { row: 500, col: 0 }, BOUNDS), rect(97, 0, 99, 0));
  const ws = sheet({ A98: "1" });
  const { edits } = computeFill(ws, src, { row: 500, col: 0 }, BOUNDS);
  assert.deepEqual(edits, [
    { row: 98, col: 0, raw: "1" },
    { row: 99, col: 0, raw: "1" },
  ], "edits stop at the last row");
});

test("AUDIT: filling at the top edge clamps and generates only what fits", () => {
  const ws = sheet({ A2: "5", A3: "6" });
  const { dest, edits } = computeFill(ws, rect(1, 0, 2, 0), { row: -10, col: 0 }, BOUNDS);
  assert.deepEqual(dest, rect(0, 0, 2, 0));
  assert.deepEqual(edits, [{ row: 0, col: 0, raw: "4" }]);
});
