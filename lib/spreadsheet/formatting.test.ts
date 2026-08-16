/**
 * Formatting survival — that a style rides through the same command, clipboard
 * and history machinery as a value, so it survives copy, paste, undo and redo
 * (Phase 5 spec).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { type Rect } from "@/lib/spreadsheet/coordinates";
import {
  createWorksheet,
  getCellStyleId,
  getCellValue,
  setCellStyleId,
  setCellValue,
} from "@/lib/spreadsheet/model";
import { StyleRegistry } from "@/lib/spreadsheet/style";
import {
  applyChanges,
  buildCommand,
  History,
  revertChanges,
  type CellCommand,
} from "@/lib/spreadsheet/history";
import {
  clearSourceStyles,
  copyRange,
  pasteEdits,
  pasteStyles,
} from "@/lib/spreadsheet/clipboard";
import { computeFill } from "@/lib/spreadsheet/fill";

const BOUNDS = { rows: 100, cols: 26 };
const rect = (top: number, left: number, bottom: number, right: number): Rect => ({
  top,
  left,
  bottom,
  right,
});

test("model stores styles separately and sparsely from values", () => {
  let ws = createWorksheet("s", "Sheet1");
  ws = setCellValue(ws, 0, 0, "hi");
  ws = setCellStyleId(ws, 0, 0, 7);
  assert.equal(getCellValue(ws, 0, 0), "hi");
  assert.equal(getCellStyleId(ws, 0, 0), 7);

  // Clearing the value leaves the style; setting style 0 removes the key.
  ws = setCellValue(ws, 0, 0, "");
  assert.equal(getCellStyleId(ws, 0, 0), 7, "formatting is independent of the value");
  ws = setCellStyleId(ws, 0, 0, 0);
  assert.equal("A1" in ws.cellStyles, false, "the style key is deleted, not left at 0");
});

test("a format is one undoable command, capturing style before/after", () => {
  const reg = new StyleRegistry();
  const bold = reg.intern({ bold: true });
  let ws = createWorksheet("s", "Sheet1");

  const cmd = buildCommand("Format", ws, [{ row: 0, col: 0, style: bold }]);
  assert.deepEqual(cmd.changes, [
    { row: 0, col: 0, before: "", after: "", styleBefore: 0, styleAfter: bold },
  ]);

  ws = applyChanges(ws, cmd.changes);
  assert.equal(getCellStyleId(ws, 0, 0), bold);
  ws = revertChanges(ws, cmd.changes);
  assert.equal(getCellStyleId(ws, 0, 0), 0, "undo restores the prior (default) style");
});

test("undo/redo round-trips formatting through the history", () => {
  const reg = new StyleRegistry();
  const italic = reg.intern({ italic: true });
  const history = new History();
  let ws = createWorksheet("s", "Sheet1");

  const cmd = buildCommand("Format", ws, [{ row: 1, col: 1, style: italic }]);
  ws = applyChanges(ws, cmd.changes);
  history.record(cmd);
  assert.equal(getCellStyleId(ws, 1, 1), italic);

  ws = revertChanges(ws, (history.undo() as CellCommand).changes);
  assert.equal(getCellStyleId(ws, 1, 1), 0);
  ws = applyChanges(ws, (history.redo() as CellCommand).changes);
  assert.equal(getCellStyleId(ws, 1, 1), italic, "redo re-applies the format");
});

test("copy carries a cell's style to the paste destination", () => {
  const reg = new StyleRegistry();
  const bold = reg.intern({ bold: true });
  let ws = createWorksheet("s", "Sheet1");
  ws = setCellValue(ws, 0, 0, "x");
  ws = setCellStyleId(ws, 0, 0, bold);

  const clip = copyRange(ws, rect(0, 0, 0, 0));
  assert.deepEqual(clip.styles, [[bold]]);

  // Paste into C1: both the value and the style land there.
  const edits = [
    ...pasteEdits(clip, { row: 0, col: 2 }, BOUNDS, true),
    ...pasteStyles(clip, { row: 0, col: 2 }, BOUNDS),
  ];
  ws = applyChanges(ws, buildCommand("Paste", ws, edits).changes);
  assert.equal(getCellValue(ws, 0, 2), "x");
  assert.equal(getCellStyleId(ws, 0, 2), bold, "the paste brought the formatting with it");
});

test("paste replaces the destination's formatting (unstyled source clears it)", () => {
  const reg = new StyleRegistry();
  const bold = reg.intern({ bold: true });
  let ws = createWorksheet("s", "Sheet1");
  ws = setCellValue(ws, 0, 0, "plain"); // unstyled source
  ws = setCellStyleId(ws, 0, 2, bold); // styled destination

  const clip = copyRange(ws, rect(0, 0, 0, 0));
  const edits = [
    ...pasteEdits(clip, { row: 0, col: 2 }, BOUNDS, true),
    ...pasteStyles(clip, { row: 0, col: 2 }, BOUNDS),
  ];
  ws = applyChanges(ws, buildCommand("Paste", ws, edits).changes);
  assert.equal(getCellStyleId(ws, 0, 2), 0, "pasting an unstyled cell removes the old bold");
});

test("cut clears the source's style along with its value", () => {
  const reg = new StyleRegistry();
  const bold = reg.intern({ bold: true });
  let ws = createWorksheet("s", "Sheet1");
  ws = setCellValue(ws, 0, 0, "x");
  ws = setCellStyleId(ws, 0, 0, bold);

  const clip = copyRange(ws, rect(0, 0, 0, 0), true);
  ws = applyChanges(ws, buildCommand("Cut", ws, clearSourceStyles(clip)).changes);
  assert.equal(getCellStyleId(ws, 0, 0), 0, "the cut source keeps no formatting");
});

test("fill carries the source cell's style onto the filled cells", () => {
  const reg = new StyleRegistry();
  const bold = reg.intern({ bold: true });
  let ws = createWorksheet("s", "Sheet1");
  ws = setCellValue(ws, 0, 0, "1");
  ws = setCellStyleId(ws, 0, 0, bold);

  const { styleEdits } = computeFill(ws, rect(0, 0, 0, 0), { row: 2, col: 0 }, BOUNDS);
  assert.deepEqual(styleEdits, [
    { row: 1, col: 0, style: bold },
    { row: 2, col: 0, style: bold },
  ]);
});
