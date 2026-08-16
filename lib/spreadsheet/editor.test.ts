import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorksheet,
  getCellValue,
  isFilled,
} from "@/lib/spreadsheet/model";
import {
  startEdit,
  editDraft,
  commitEditor,
  formulaBarContent,
} from "@/lib/spreadsheet/editor";
import {
  cellSelection,
  moveActive,
  type Bounds,
} from "@/lib/spreadsheet/selection";

const B: Bounds = { rows: 100, cols: 26 };

function sheetWith(cells: Record<string, string>) {
  let ws = createWorksheet("s", "Sheet1");
  for (const [key, value] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(key)!;
    const col = m[1].charCodeAt(0) - 65;
    const row = Number(m[2]) - 1;
    ws = { ...ws, cells: { ...ws.cells, [key]: { value } } };
    void col;
    void row;
  }
  return ws;
}

test("startEdit: F2 / Enter edit in place, typing replaces", () => {
  // No initial → the cell's current content (edit in place).
  const inPlace = startEdit({ row: 0, col: 0 }, "hello");
  assert.equal(inPlace.draft, "hello");
  assert.equal(inPlace.source, "cell");

  // An initial character → replace.
  const replace = startEdit({ row: 0, col: 0 }, "hello", { initial: "x" });
  assert.equal(replace.draft, "x");

  // The formula bar starts an edit too, tagged so.
  const bar = startEdit({ row: 0, col: 0 }, "hello", { source: "bar" });
  assert.equal(bar.source, "bar");
});

test("editDraft updates the working value", () => {
  const e = startEdit({ row: 0, col: 0 }, "");
  assert.equal(editDraft(e, "=A1+B1").draft, "=A1+B1");
});

test("committing writes the draft into the worksheet", () => {
  const ws = createWorksheet("s", "Sheet1");
  const e = editDraft(startEdit({ row: 0, col: 0 }, ""), "42");
  const next = commitEditor(e, ws);
  assert.equal(getCellValue(next, 0, 0), "42");
});

test("committing an empty draft clears the cell (stays sparse)", () => {
  const ws = sheetWith({ A1: "old" });
  const e = editDraft(startEdit({ row: 0, col: 0 }, "old"), "");
  const next = commitEditor(e, ws);
  assert.equal(getCellValue(next, 0, 0), "");
  assert.equal(isFilled(next, 0, 0), false);
  assert.equal("A1" in next.cells, false, "the key is deleted, not blanked");
});

test("cancelling writes nothing — the previous value stands", () => {
  const ws = sheetWith({ A1: "old" });
  // A cancel simply drops the editor without committing; the worksheet is
  // untouched, so the cell keeps "old".
  editDraft(startEdit({ row: 0, col: 0 }, "old"), "new-but-abandoned");
  assert.equal(getCellValue(ws, 0, 0), "old");
});

test("Enter behaviour: commit, then move down", () => {
  const ws = createWorksheet("s", "Sheet1");
  const sel = cellSelection({ row: 0, col: 0 });
  const e = editDraft(startEdit(sel.active, ""), "5");

  const committed = commitEditor(e, ws);
  const moved = moveActive(sel, "down", B);

  assert.equal(getCellValue(committed, 0, 0), "5");
  assert.deepEqual(moved.active, { row: 1, col: 0 });
});

test("Tab behaviour: commit, then move right", () => {
  const ws = createWorksheet("s", "Sheet1");
  const sel = cellSelection({ row: 2, col: 2 });
  const e = editDraft(startEdit(sel.active, ""), "hi");

  const committed = commitEditor(e, ws);
  const moved = moveActive(sel, "right", B);

  assert.equal(getCellValue(committed, 2, 2), "hi");
  assert.deepEqual(moved.active, { row: 2, col: 3 });
});

test("formula bar synchronisation: draft while editing, raw otherwise", () => {
  // Not editing → the active cell's raw content.
  assert.equal(formulaBarContent(null, "=A1+B1"), "=A1+B1");

  // Editing → the live draft (so cell edits show in the bar and vice versa).
  const e = editDraft(startEdit({ row: 0, col: 0 }, "=A1+B1"), "=A1+B2");
  assert.equal(formulaBarContent(e, "=A1+B1"), "=A1+B2");
});
