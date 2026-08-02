import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  rowsNotMatching,
  sortRange,
  type SheetData,
} from "./grid.ts";

/**
 * Structural edits — insert/delete rows and columns, sort, filter — added
 * for the AI assistant's tools. Each test states, in its name, the one
 * property that matters: what moves, what doesn't, and where the documented
 * formula-reference limitation actually bites.
 */

function sheet(cells: Record<string, string>, rows = 20, cols = 10): SheetData {
  return { cells, styles: {}, rows, cols };
}

test("inserting a row shifts cells at or below it down, and leaves earlier rows alone", () => {
  const before = sheet({ A1: "keep", A2: "shift-down", B2: "shift-down-too" });
  const after = insertRows(before, 1, 1);
  assert.equal(after.cells.A1, "keep");
  assert.equal(after.cells.A2, undefined);
  assert.equal(after.cells.A3, "shift-down");
  assert.equal(after.cells.B3, "shift-down-too");
  assert.equal(after.rows, before.rows + 1);
});

test("inserting several rows shifts by the full count in one step", () => {
  const after = insertRows(sheet({ A5: "x" }), 2, 3);
  assert.equal(after.cells.A8, "x");
});

test("deleting a row drops what was in it and closes the gap", () => {
  const before = sheet({ A1: "keep", A2: "dropped", A3: "moves-up" });
  const after = deleteRows(before, 1, 1);
  assert.equal(after.cells.A1, "keep");
  assert.equal(after.cells.A2, "moves-up");
  assert.equal(Object.values(after.cells).includes("dropped"), false);
  assert.equal(after.rows, before.rows - 1);
});

test("deleting a block of rows drops everything inside the block", () => {
  /* A2, A3, A4 are 0-based rows 1, 2, 3 — deleteRows(before, 1, 3) removes
     exactly that block and closes the gap, leaving A5 ("keeps") at A2. */
  const before = sheet({ A2: "gone", A3: "gone", A4: "gone", A5: "keeps" });
  const after = deleteRows(before, 1, 3);
  assert.equal(after.cells.A2, "keeps");
  assert.equal(Object.keys(after.cells).length, 1);
});

test("column formula TEXT moves with the cell — the documented reference limitation", () => {
  /* `=A1` does not become `=A2` even though the cell holding it moved to
     row 2 — this is the known limitation the module comment states, pinned
     here so a future "fix" is a deliberate decision, not an accident. */
  const before = sheet({ A1: "=B1" });
  const after = insertRows(before, 0, 1);
  assert.equal(after.cells.A2, "=B1");
});

test("insert/delete columns shift by column, not by row", () => {
  const before = sheet({ A1: "keep", B1: "shift-right" });
  const after = insertColumns(before, 1, 1);
  assert.equal(after.cells.A1, "keep");
  assert.equal(after.cells.C1, "shift-right");

  const back = deleteColumns(after, 1, 1);
  assert.equal(back.cells.B1, "shift-right");
});

test("sortRange reorders a whole row together, not one column in isolation", () => {
  const before = sheet({
    A1: "Name",
    B1: "Score",
    A2: "Charlie",
    B2: "10",
    A3: "Alice",
    B3: "30",
    A4: "Bob",
    B4: "20",
  });
  const after = sortRange(before, { top: 0, left: 0, bottom: 3, right: 1 }, 0, "asc", true);
  /* Row 2 (first data row) should now hold Alice — and her score, 30, must
     have travelled with her name rather than staying behind. */
  assert.equal(after.cells.A2, "Alice");
  assert.equal(after.cells.B2, "30");
  assert.equal(after.cells.A3, "Bob");
  assert.equal(after.cells.B3, "20");
  assert.equal(after.cells.A4, "Charlie");
  assert.equal(after.cells.B4, "10");
  /* The header row is untouched. */
  assert.equal(after.cells.A1, "Name");
});

test("sortRange numeric column sorts numerically, not lexicographically", () => {
  const before = sheet({ A1: "9", A2: "10", A3: "2" });
  const after = sortRange(before, { top: 0, left: 0, bottom: 2, right: 0 }, 0, "asc", false);
  assert.deepEqual([after.cells.A1, after.cells.A2, after.cells.A3], ["2", "9", "10"]);
});

test("rowsNotMatching keeps the header row regardless of whether it matches", () => {
  const data = sheet({ A1: "Status", A2: "done", A3: "pending", A4: "done" });
  const hidden = rowsNotMatching(data, { top: 0, left: 0, bottom: 3, right: 0 }, 0, "equals", "done", true);
  assert.deepEqual(hidden, [2]);
});

test("rowsNotMatching with notEmpty hides genuinely blank rows only", () => {
  const data = sheet({ A1: "x", A3: "y" });
  const hidden = rowsNotMatching(data, { top: 0, left: 0, bottom: 3, right: 0 }, 0, "notEmpty", "", false);
  assert.deepEqual(hidden, [1, 3]);
});
