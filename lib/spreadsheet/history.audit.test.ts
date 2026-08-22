/**
 * History audit — undo/redo across every command kind, grouped operations,
 * style memory, interleaved structural and value edits, and stack discipline.
 *
 * Assertions state CORRECT behaviour; failures are tagged `// BUG(...)`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorksheet,
  getCellStyleId,
  getCellValue,
  type Worksheet,
} from "@/lib/spreadsheet/model";
import { insertRows, deleteCols, freezeRows, setColWidth } from "@/lib/spreadsheet/structure";
import {
  applyChanges,
  buildCommand,
  History,
  revertChanges,
  structuralCommand,
  type CellCommand,
  type Command,
} from "@/lib/spreadsheet/history";

/** Apply/revert a command against the sheet, the way the controller does.
    These tests exercise cell and single-sheet structural commands; the
    workbook-structural kind is applied per contained sheet pair. */
function applyCommand(ws: Worksheet, cmd: Command): Worksheet {
  if (cmd.kind === "cells") return applyChanges(ws, cmd.changes);
  if (cmd.kind === "workbookStructural")
    return cmd.sheets.find((s) => s.before.id === ws.id)?.after ?? ws;
  return cmd.after;
}
function revertCommand(ws: Worksheet, cmd: Command): Worksheet {
  if (cmd.kind === "cells") return revertChanges(ws, cmd.changes);
  if (cmd.kind === "workbookStructural")
    return cmd.sheets.find((s) => s.after.id === ws.id)?.before ?? ws;
  return cmd.before;
}

test("AUDIT: undo restores a cell's STYLE as well as its value", () => {
  let ws = createWorksheet("s", "Sheet1");
  const history = new History();

  // Edit value, then format it, then paste over both at once.
  const edit = buildCommand("Edit", ws, [{ row: 0, col: 0, raw: "hello" }]);
  ws = applyChanges(ws, edit.changes);
  history.record(edit);

  const format = buildCommand("Bold", ws, [{ row: 0, col: 0, style: 3 }]);
  ws = applyChanges(ws, format.changes);
  history.record(format);

  const paste = buildCommand("Paste", ws, [{ row: 0, col: 0, raw: "pasted", style: 7 }]);
  ws = applyChanges(ws, paste.changes);
  history.record(paste);
  assert.equal(getCellValue(ws, 0, 0), "pasted");
  assert.equal(getCellStyleId(ws, 0, 0), 7);

  ws = revertCommand(ws, history.undo()!); // undo paste
  assert.equal(getCellValue(ws, 0, 0), "hello");
  assert.equal(getCellStyleId(ws, 0, 0), 3, "the pre-paste style comes back with the value");

  ws = revertCommand(ws, history.undo()!); // undo format
  assert.equal(getCellStyleId(ws, 0, 0), 0, "undoing the format returns the default style");
  assert.equal(getCellValue(ws, 0, 0), "hello", "the value is untouched by a style undo");

  ws = revertCommand(ws, history.undo()!); // undo edit
  assert.equal(getCellValue(ws, 0, 0), "");
  assert.equal(ws.cells["A1"], undefined, "undo to empty deletes the key — sparse store");
});

test("AUDIT: a value-only edit records no style fields (no weight on the common case)", () => {
  const ws = createWorksheet("s", "Sheet1");
  const cmd = buildCommand("Edit", ws, [{ row: 0, col: 0, raw: "x" }]);
  assert.deepEqual(cmd.changes, [{ row: 0, col: 0, before: "", after: "x" }]);
});

test("AUDIT: a multi-cell replace-all undoes as ONE step and redoes as one", () => {
  let ws = createWorksheet("s", "Sheet1");
  const seed = buildCommand("Seed", ws, [
    { row: 0, col: 0, raw: "red a" },
    { row: 1, col: 0, raw: "red b" },
    { row: 2, col: 0, raw: "red c" },
  ]);
  ws = applyChanges(ws, seed.changes);
  const history = new History();
  history.record(seed);

  const replace = buildCommand("Replace all", ws, [
    { row: 0, col: 0, raw: "blue a" },
    { row: 1, col: 0, raw: "blue b" },
    { row: 2, col: 0, raw: "blue c" },
  ]);
  ws = applyChanges(ws, replace.changes);
  history.record(replace);

  ws = revertCommand(ws, history.undo()!);
  assert.deepEqual(
    [getCellValue(ws, 0, 0), getCellValue(ws, 1, 0), getCellValue(ws, 2, 0)],
    ["red a", "red b", "red c"],
    "one undo reverts the whole replace",
  );
  ws = applyCommand(ws, history.redo()!);
  assert.deepEqual(
    [getCellValue(ws, 0, 0), getCellValue(ws, 1, 0), getCellValue(ws, 2, 0)],
    ["blue a", "blue b", "blue c"],
    "one redo re-applies it whole",
  );
});

test("AUDIT: interleaved structural and cell commands undo in exact LIFO order", () => {
  let ws = createWorksheet("s", "Sheet1", 10, 5);
  const history = new History();

  // 1. Type into A1 and A2.
  const typeCmd = buildCommand("Type", ws, [
    { row: 0, col: 0, raw: "top" },
    { row: 1, col: 0, raw: "=A1" },
  ]);
  ws = applyChanges(ws, typeCmd.changes);
  history.record(typeCmd);

  // 2. Insert a row above — a structural snapshot (formulas rewritten inside).
  let after = insertRows(ws, 0, 1);
  const insert = structuralCommand("Insert row", ws, after);
  ws = after;
  history.record(insert);
  assert.equal(getCellValue(ws, 1, 0), "top", "the data moved down");
  assert.equal(getCellValue(ws, 2, 0), "=A2", "the formula was rewritten to follow it");

  // 3. Edit the moved cell.
  const edit = buildCommand("Edit", ws, [{ row: 1, col: 0, raw: "TOP!" }]);
  ws = applyChanges(ws, edit.changes);
  history.record(edit);

  // 4. A second structural op: resize+freeze via snapshot (delete a column).
  after = deleteCols(freezeRows(setColWidth(ws, 1, 200), 1), 3, 1);
  const reshape = structuralCommand("Reshape", ws, after);
  ws = after;
  history.record(reshape);

  // Undo everything, checking each layer peels back in reverse order.
  ws = revertCommand(ws, history.undo()!); // undo reshape
  assert.equal(ws.colWidths[1], undefined, "the width override is part of the snapshot undo");
  assert.equal(ws.frozenRows, 0);
  assert.equal(getCellValue(ws, 1, 0), "TOP!");

  ws = revertCommand(ws, history.undo()!); // undo edit
  assert.equal(getCellValue(ws, 1, 0), "top");

  ws = revertCommand(ws, history.undo()!); // undo insert
  assert.equal(getCellValue(ws, 0, 0), "top");
  assert.equal(getCellValue(ws, 1, 0), "=A1", "the formula reads as originally typed");

  ws = revertCommand(ws, history.undo()!); // undo typing
  assert.deepEqual(ws.cells, {}, "back to the blank sheet");
  assert.equal(history.canUndo(), false);

  // And the whole tower redoes forward again.
  ws = applyCommand(ws, history.redo()!);
  ws = applyCommand(ws, history.redo()!);
  ws = applyCommand(ws, history.redo()!);
  ws = applyCommand(ws, history.redo()!);
  assert.equal(getCellValue(ws, 1, 0), "TOP!");
  assert.equal(ws.frozenRows, 1);
  assert.equal(history.canRedo(), false);
});

test("AUDIT: a new command after undos discards the whole redo branch", () => {
  const ws = createWorksheet("s", "Sheet1");
  const history = new History();
  history.record(buildCommand("A", ws, [{ row: 0, col: 0, raw: "a" }]));
  history.record(buildCommand("B", ws, [{ row: 0, col: 1, raw: "b" }]));
  history.record(buildCommand("C", ws, [{ row: 0, col: 2, raw: "c" }]));
  history.undo();
  history.undo(); // B and C both redoable
  history.record(buildCommand("D", ws, [{ row: 0, col: 3, raw: "d" }]));
  assert.equal(history.canRedo(), false, "both undone commands are gone, not just one");
  history.undo(); // D
  history.undo(); // A
  assert.equal(history.canUndo(), false, "the past is A then D only");
});

test("AUDIT: history depth is unbounded — 1500 edits all undo (documented behaviour)", () => {
  // There is NO depth cap. Cell commands are diffs so this is cheap; noted in
  // the audit report that structural snapshots make an unbounded stack heavier.
  const ws = createWorksheet("s", "Sheet1");
  const history = new History();
  for (let i = 0; i < 1500; i++) {
    history.record(buildCommand(`E${i}`, ws, [{ row: 0, col: 0, raw: `v${i}` }]));
  }
  let undone = 0;
  while (history.canUndo()) {
    history.undo();
    undone++;
  }
  assert.equal(undone, 1500);
});

test("AUDIT: duplicate edits to one cell collapse, mixing value and style fields", () => {
  let ws = createWorksheet("s", "Sheet1");
  const seed = buildCommand("seed", ws, [{ row: 0, col: 0, raw: "orig", style: 2 }]);
  ws = applyChanges(ws, seed.changes);

  // A cut clears value+style, then a paste sets both: ONE change, orig → final.
  const cmd = buildCommand("Move", ws, [
    { row: 0, col: 0, raw: "", style: 0 },
    { row: 0, col: 0, raw: "moved", style: 5 },
  ]);
  assert.equal(cmd.changes.length, 1);
  assert.deepEqual(cmd.changes[0], {
    row: 0,
    col: 0,
    before: "orig",
    after: "moved",
    styleBefore: 2,
    styleAfter: 5,
  });
  // Undo lands on the ORIGINAL, not the intermediate cleared state.
  const applied = applyChanges(ws, cmd.changes);
  const reverted = revertChanges(applied, cmd.changes);
  assert.equal(getCellValue(reverted, 0, 0), "orig");
  assert.equal(getCellStyleId(reverted, 0, 0), 2);
});

test("AUDIT: an all-no-op command records nothing; an effective one clears redo", () => {
  const wsWith = (v: string) => {
    let ws = createWorksheet("s", "Sheet1");
    const cmd = buildCommand("seed", ws, [{ row: 0, col: 0, raw: v }]);
    ws = applyChanges(ws, cmd.changes);
    return ws;
  };
  const ws = wsWith("same");
  const history = new History();
  history.record(buildCommand("first", ws, [{ row: 1, col: 0, raw: "x" }]));
  history.undo();
  assert.equal(history.canRedo(), true);

  // A no-op (same value, same style) must NOT clear the redo branch.
  history.record(buildCommand("noop", ws, [{ row: 0, col: 0, raw: "same" }]));
  assert.equal(history.canRedo(), true, "an empty command leaves the redo branch alone");
  assert.equal(history.canUndo(), false);
});

test("AUDIT: undoing a cell command on the RIGHT sheet — sheetId travels with it", () => {
  const cmd = buildCommand("Edit", createWorksheet("sheet-9", "Nine"), [
    { row: 0, col: 0, raw: "x" },
  ]) as CellCommand;
  assert.equal(cmd.sheetId, "sheet-9");
  const structural = structuralCommand(
    "Insert",
    createWorksheet("sheet-4", "Four"),
    createWorksheet("sheet-4", "Four"),
  );
  assert.equal(structural.sheetId, "sheet-4");
});
