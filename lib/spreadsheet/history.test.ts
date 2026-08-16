import assert from "node:assert/strict";
import { test } from "node:test";
import { getCellValue, createWorksheet, setCellValue, type Worksheet } from "@/lib/spreadsheet/model";
import {
  applyChanges,
  buildCommand,
  History,
  revertChanges,
  type CellCommand,
} from "@/lib/spreadsheet/history";

/** Narrow a popped command to its cell changes — every command in these tests is
    a cell command. */
const changesOf = (cmd: ReturnType<History["undo"]>) => (cmd as CellCommand).changes;

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

test("buildCommand captures before/after and drops no-ops", () => {
  const ws = sheet({ A1: "old" });
  const cmd = buildCommand("Edit", ws, [
    { row: 0, col: 0, raw: "new" }, // a real change
    { row: 1, col: 0, raw: "" }, // blank → blank, a no-op
  ]);
  assert.deepEqual(cmd.changes, [{ row: 0, col: 0, before: "old", after: "new" }]);
});

test("buildCommand collapses duplicate targets — before is the ORIGINAL", () => {
  // A cut clears A1, then a paste writes it: one change, original → final.
  const ws = sheet({ A1: "orig" });
  const cmd = buildCommand("Cut", ws, [
    { row: 0, col: 0, raw: "" },
    { row: 0, col: 0, raw: "moved" },
  ]);
  assert.deepEqual(cmd.changes, [{ row: 0, col: 0, before: "orig", after: "moved" }]);
});

test("applyChanges and revertChanges are inverses", () => {
  const ws = sheet({ A1: "old" });
  const cmd = buildCommand("Edit", ws, [{ row: 0, col: 0, raw: "new" }]);
  const applied = applyChanges(ws, cmd.changes);
  assert.equal(getCellValue(applied, 0, 0), "new");
  const reverted = revertChanges(applied, cmd.changes);
  assert.equal(getCellValue(reverted, 0, 0), "old");
});

test("undo then redo round-trips a cell edit", () => {
  const history = new History();
  let ws = createWorksheet("s", "Sheet1");

  const cmd = buildCommand("Edit", ws, [{ row: 0, col: 0, raw: "42" }]);
  ws = applyChanges(ws, cmd.changes);
  history.record(cmd);
  assert.equal(getCellValue(ws, 0, 0), "42");

  const undo = history.undo()!;
  ws = revertChanges(ws, changesOf(undo));
  assert.equal(getCellValue(ws, 0, 0), "", "undo restores the empty cell");

  const redo = history.redo()!;
  ws = applyChanges(ws, changesOf(redo));
  assert.equal(getCellValue(ws, 0, 0), "42", "redo re-applies the edit");
});

test("a paste (many cells) undoes as ONE step", () => {
  const history = new History();
  let ws = createWorksheet("s", "Sheet1");
  const cmd = buildCommand("Paste", ws, [
    { row: 0, col: 0, raw: "1" },
    { row: 0, col: 1, raw: "2" },
    { row: 1, col: 0, raw: "3" },
    { row: 1, col: 1, raw: "4" },
  ]);
  ws = applyChanges(ws, cmd.changes);
  history.record(cmd);
  assert.equal(getCellValue(ws, 1, 1), "4");

  // A single undo pops the whole paste and reverts every cell it wrote.
  const undo = history.undo()!;
  ws = revertChanges(ws, changesOf(undo));
  assert.equal(getCellValue(ws, 0, 0), "");
  assert.equal(getCellValue(ws, 1, 1), "", "the whole 2×2 paste is gone in one undo");
  assert.equal(history.canUndo(), false);
});

test("undo/redo availability and the redo-branch discard", () => {
  const history = new History();
  const ws = createWorksheet("s", "Sheet1");
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);

  history.record(buildCommand("A", ws, [{ row: 0, col: 0, raw: "a" }]));
  history.record(buildCommand("B", ws, [{ row: 0, col: 1, raw: "b" }]));
  assert.equal(history.canUndo(), true);

  history.undo(); // undo B → it is now redoable
  assert.equal(history.canRedo(), true);

  // A fresh command discards the redo branch.
  history.record(buildCommand("C", ws, [{ row: 0, col: 2, raw: "c" }]));
  assert.equal(history.canRedo(), false);
});

test("undo on an empty history is a safe no-op", () => {
  const history = new History();
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), null);
});

test("a command that changes nothing is not recorded", () => {
  const history = new History();
  const ws = sheet({ A1: "x" });
  history.record(buildCommand("noop", ws, [{ row: 0, col: 0, raw: "x" }]));
  assert.equal(history.canUndo(), false);
});
