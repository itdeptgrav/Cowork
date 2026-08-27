/**
 * Clipboard audit — copy, cut and paste at their edges.
 *
 * Reference semantics: a COPY re-bases relative references by the paste delta
 * and holds `$`-anchors still; a CUT moves content verbatim; a cut's source is
 * cleared (value and style) even when the paste lands on top of it; a paste is
 * clipped at the grid edge; TSV round-trips shape. Two known simplifications —
 * no tiling of a small block over a larger selection, and no rewriting of
 * OTHER cells' references onto a cut block's new home — are recorded as
 * judgement calls in the audit report, not asserted here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { cellRef, type Rect } from "@/lib/spreadsheet/coordinates";
import {
  createWorksheet,
  getCellStyleId,
  getCellValue,
  setCellStyleId,
  setCellValue,
  type Worksheet,
} from "@/lib/spreadsheet/model";
import { FormulaEngine } from "@/lib/spreadsheet/formula";
import { applyChanges, buildCommand, revertChanges } from "@/lib/spreadsheet/history";
import {
  clearSourceEdits,
  clearSourceStyles,
  copyRange,
  fromTSV,
  parseTSV,
  pasteEdits,
  pasteRect,
  pasteStyles,
  toTSV,
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

const rect = (top: number, left: number, bottom: number, right: number): Rect =>
  ({ top, left, bottom, right });

/* ── Copy: reference re-basing ────────────────────────────────────────────── */

test("AUDIT: copy-paste shifts relative refs by the full (row,col) delta, down-right and up-left", () => {
  const ws = sheet({ C3: "=B2+D4" });
  const clip = copyRange(ws, rect(2, 2, 2, 2));
  assert.deepEqual(pasteEdits(clip, { row: 4, col: 5 }, BOUNDS, true),
    [{ row: 4, col: 5, raw: "=E4+G6" }], "down-right delta (+2,+3)");
  assert.deepEqual(pasteEdits(clip, { row: 1, col: 1 }, BOUNDS, true),
    [{ row: 1, col: 1, raw: "=A1+C3" }], "up-left delta (-1,-1)");
});

test("AUDIT: all four anchor shapes behave under one paste delta", () => {
  const ws = sheet({ B2: "=A1+$A1+A$1+$A$1" });
  const clip = copyRange(ws, rect(1, 1, 1, 1));
  assert.deepEqual(
    pasteEdits(clip, { row: 3, col: 3 }, BOUNDS, true),
    [{ row: 3, col: 3, raw: "=C3+$A3+C$1+$A$1" }],
    "relative shifts both, $col holds column, row$ holds row, $both holds all",
  );
});

test("AUDIT: range references shift as a unit; strings and numbers do not shift", () => {
  const ws = sheet({ D1: '=SUM(A1:B2)+LEN("A1")+5' });
  const clip = copyRange(ws, rect(0, 3, 0, 3));
  assert.deepEqual(
    pasteEdits(clip, { row: 2, col: 3 }, BOUNDS, true),
    [{ row: 2, col: 3, raw: '=SUM(A3:B4)+LEN("A1")+5' }],
    "the quoted 'A1' is text, not a reference",
  );
});

test("AUDIT: references walk through a & concatenation on paste", () => {
  // "&" is part of the formula grammar, so a copied concatenation re-bases its
  // references like any other operator's.
  const ws = sheet({ D1: '=A1&"x"' });
  const clip = copyRange(ws, rect(0, 3, 0, 3));
  assert.deepEqual(pasteEdits(clip, { row: 2, col: 3 }, BOUNDS, true),
    [{ row: 2, col: 3, raw: '=A3&"x"' }]);
});

test("AUDIT: a formula outside the engine's grammar is pasted untouched, never mangled", () => {
  // adjustFormula's documented fallback: what will not tokenize is returned
  // exactly as written rather than being half-rewritten.
  const ws = sheet({ D1: "=A1@" });
  const clip = copyRange(ws, rect(0, 3, 0, 3));
  assert.deepEqual(pasteEdits(clip, { row: 2, col: 3 }, BOUNDS, true),
    [{ row: 2, col: 3, raw: "=A1@" }]);
});

test("AUDIT: paste of a relative ref clamps at the sheet edge (documented divergence)", () => {
  /* Excel turns an off-sheet relative ref into #REF!; references.ts documents
     clamping to the first row/column instead. Asserted as documented so a
     change of policy is visible. */
  const ws = sheet({ B2: "=A1" });
  const clip = copyRange(ws, rect(1, 1, 1, 1));
  assert.deepEqual(pasteEdits(clip, { row: 0, col: 0 }, BOUNDS, true),
    [{ row: 0, col: 0, raw: "=A1" }]);
});

/* ── Cut ──────────────────────────────────────────────────────────────────── */

test("AUDIT: a cut pastes formulas verbatim — the moved formula keeps its refs", () => {
  const ws = sheet({ B1: "=A1*2" });
  const clip = copyRange(ws, rect(0, 1, 0, 1), true);
  assert.equal(clip.cut, true);
  assert.deepEqual(pasteEdits(clip, { row: 5, col: 5 }, BOUNDS, false),
    [{ row: 5, col: 5, raw: "=A1*2" }]);
});

test("AUDIT: cut-paste onto an overlapping target clears what it left and keeps what it moved", () => {
  // Cut A1:B1 and paste at B1 — B1 is both source and destination.
  let ws = sheet({ A1: "a", B1: "b" });
  ws = setCellStyleId(ws, 0, 0, 5);
  const clip = copyRange(ws, rect(0, 0, 0, 1), true);
  const edits = [
    ...clearSourceEdits(clip),
    ...clearSourceStyles(clip),
    ...pasteEdits(clip, { row: 0, col: 1 }, BOUNDS, false),
    ...pasteStyles(clip, { row: 0, col: 1 }, BOUNDS),
  ];
  const cmd = buildCommand("Cut", ws, edits);
  const after = applyChanges(ws, cmd.changes);
  assert.equal(getCellValue(after, 0, 0), "", "vacated source is empty");
  assert.equal(getCellValue(after, 0, 1), "a", "overlap: the paste wins over the clear");
  assert.equal(getCellValue(after, 0, 2), "b");
  assert.equal(getCellStyleId(after, 0, 0), 0, "source style cleared");
  assert.equal(getCellStyleId(after, 0, 1), 5, "style travelled with the value");

  const undone = revertChanges(after, cmd.changes);
  assert.equal(getCellValue(undone, 0, 0), "a", "undo restores the original in one step");
  assert.equal(getCellValue(undone, 0, 1), "b");
  assert.equal(getCellValue(undone, 0, 2), "");
  assert.equal(getCellStyleId(undone, 0, 0), 5);
});

test("AUDIT: clearSource covers every source cell, including blanks inside the rect", () => {
  const ws = sheet({ A1: "x", C1: "y" }); // B1 blank but inside the cut rect
  const clip = copyRange(ws, rect(0, 0, 0, 2), true);
  assert.equal(clearSourceEdits(clip).length, 3);
  assert.equal(clearSourceStyles(clip).length, 3);
});

/* ── Grid edges ───────────────────────────────────────────────────────────── */

test("AUDIT: a paste is clipped at the right and bottom edges, not wrapped or clamped", () => {
  const clip = fromTSV("1\t2\n3\t4");
  const atRight = pasteEdits(clip, { row: 0, col: 25 }, BOUNDS, false);
  assert.deepEqual(atRight, [
    { row: 0, col: 25, raw: "1" },
    { row: 1, col: 25, raw: "3" },
  ]);
  const atBottom = pasteEdits(clip, { row: 99, col: 0 }, BOUNDS, false);
  assert.deepEqual(atBottom, [
    { row: 99, col: 0, raw: "1" },
    { row: 99, col: 1, raw: "2" },
  ]);
  const styles = pasteStyles(clip, { row: 99, col: 25 }, BOUNDS);
  assert.equal(styles.length, 1, "styles are clipped identically");
});

test("AUDIT: pasteRect matches exactly the cells the edits covered", () => {
  const clip = fromTSV("1\t2\t3\n4\t5\t6");
  assert.deepEqual(pasteRect(clip, { row: 4, col: 1 }, BOUNDS), rect(4, 1, 5, 3));
  assert.deepEqual(pasteRect(clip, { row: 99, col: 24 }, BOUNDS), rect(99, 24, 99, 25),
    "clipped to the grid like the edits");
});

/* ── Styles-only and values-only paste ────────────────────────────────────── */

test("AUDIT: pasting an unstyled cell CLEARS the destination's style (replace, not merge)", () => {
  const ws = sheet({ A1: "plain" });
  const clip = copyRange(ws, rect(0, 0, 0, 0)); // style 0
  let dest = sheet({ D4: "styled" });
  dest = setCellStyleId(dest, 3, 3, 9);
  const styleEdits = pasteStyles(clip, { row: 3, col: 3 }, BOUNDS);
  assert.deepEqual(styleEdits, [{ row: 3, col: 3, style: 0 }]);
  const cmd = buildCommand("Paste", dest, styleEdits);
  const after = applyChanges(dest, cmd.changes);
  assert.equal(getCellStyleId(after, 3, 3), 0);
  assert.equal(getCellValue(after, 3, 3), "styled", "styles-only paste leaves the value");
});

/* ── TSV bridge ───────────────────────────────────────────────────────────── */

test("AUDIT: toTSV writes computed display text, and empty fields for empty cells", () => {
  const ws = sheet({ A1: "5", B1: "=A1*2", A2: "x" }); // B2 empty
  const engine = new FormulaEngine();
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 2; c++)
      engine.setCell("s", r, c, ws.cells[cellRef(r, c)]?.value ?? "");
  assert.equal(toTSV(ws, engine, "s", rect(0, 0, 1, 1)), "5\t10\nx\t");
});

test("AUDIT: parseTSV normalises CRLF/CR, drops ONE trailing newline, pads ragged rows", () => {
  assert.deepEqual(parseTSV("a\tb\r\nc\r\n"), [["a", "b"], ["c", ""]]);
  assert.deepEqual(parseTSV("a\rb"), [["a"], ["b"]], "bare CR is a row break");
  assert.deepEqual(parseTSV("a\n"), [["a"]], "one trailing newline is not a blank row");
  assert.deepEqual(parseTSV("a\n\n"), [["a"], [""]], "two newlines DO carry a blank row");
  assert.deepEqual(parseTSV("a\n\nb"), [["a"], [""], ["b"]], "interior blank line survives");
  assert.deepEqual(parseTSV(""), [[""]], "empty text is one empty cell");
  assert.deepEqual(parseTSV("\t"), [["", ""]], "a lone tab is two empty cells");
});

test("AUDIT: fromTSV builds a rectangular block with default styles and no cut", () => {
  const clip = fromTSV("1\t2\t3\n4");
  assert.equal(clip.rows, 2);
  assert.equal(clip.cols, 3);
  assert.deepEqual(clip.cells[1], ["4", "", ""], "short row padded to the width");
  assert.deepEqual(clip.styles, [[0, 0, 0], [0, 0, 0]]);
  assert.equal(clip.cut, false);
});

test("AUDIT: external TSV that LOOKS like a formula pastes as a formula (raw)", () => {
  // What every spreadsheet does with pasted "=A1" text.
  const clip = fromTSV("=A1*2");
  assert.deepEqual(pasteEdits(clip, { row: 4, col: 4 }, BOUNDS, false),
    [{ row: 4, col: 4, raw: "=A1*2" }],
    "external pastes are verbatim — no re-basing against a fake origin");
});

test("AUDIT: copy of a block keeps blanks as empty strings so the paste CLEARS them", () => {
  // Overwriting a populated area with a copy containing holes must punch the
  // holes through, exactly as real spreadsheets do.
  const src = sheet({ A1: "x" }); // B1 blank
  const clip = copyRange(src, rect(0, 0, 0, 1));
  let dest = sheet({ D4: "old1", E4: "old2" });
  const cmd = buildCommand("Paste", dest, pasteEdits(clip, { row: 3, col: 3 }, BOUNDS, true));
  dest = applyChanges(dest, cmd.changes);
  assert.equal(getCellValue(dest, 3, 3), "x");
  assert.equal(getCellValue(dest, 3, 4), "", "the blank overwrote old2");
});
