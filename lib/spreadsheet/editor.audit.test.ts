/**
 * Editor audit — the edit session's contract.
 *
 * The properties a cell editor must never lose: F2 edits in place with the
 * current raw, typing over replaces, Escape leaves the sheet untouched because
 * nothing was ever written, committing an empty draft clears (sparse store),
 * and the cell and the formula bar can never disagree because both read the
 * one draft.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commitEditor,
  editDraft,
  formulaBarContent,
  startEdit,
} from "@/lib/spreadsheet/editor";
import { createWorksheet, getCellValue, setCellValue } from "@/lib/spreadsheet/model";

test("AUDIT: F2-style start edits in place; typed-over start replaces", () => {
  const inPlace = startEdit({ row: 0, col: 0 }, "old");
  assert.equal(inPlace.draft, "old");
  const typedOver = startEdit({ row: 0, col: 0 }, "old", { initial: "x" });
  assert.equal(typedOver.draft, "x");
  // An explicit empty initial is a replacement with nothing, not "keep current".
  const cleared = startEdit({ row: 0, col: 0 }, "old", { initial: "" });
  assert.equal(cleared.draft, "", "'' initial must not fall back to the current raw");
});

test("AUDIT: commit writes the draft; cancel (never committing) writes nothing", () => {
  const ws = setCellValue(createWorksheet("s", "S"), 2, 3, "before");
  const editor = editDraft(startEdit({ row: 2, col: 3 }, "before"), "after");
  const committed = commitEditor(editor, ws);
  assert.equal(getCellValue(committed, 2, 3), "after");
  // Escape = simply dropping the editor state. The worksheet was never touched.
  assert.equal(getCellValue(ws, 2, 3), "before");
});

test("AUDIT: committing an empty draft clears the cell back to never-touched", () => {
  let ws = setCellValue(createWorksheet("s", "S"), 1, 1, "x");
  const editor = editDraft(startEdit({ row: 1, col: 1 }, "x"), "");
  ws = commitEditor(editor, ws);
  assert.equal(getCellValue(ws, 1, 1), "");
  assert.equal("B2" in ws.cells, false, "cleared and never-touched are one state");
});

test("AUDIT: committing an unchanged draft is an identity — no false dirty state", () => {
  const ws = setCellValue(createWorksheet("s", "S"), 0, 0, "same");
  const editor = startEdit({ row: 0, col: 0 }, "same");
  assert.equal(commitEditor(editor, ws), ws, "no-op commit returns the same worksheet");
});

test("AUDIT: a whitespace-only draft is stored verbatim, not treated as empty", () => {
  let ws = createWorksheet("s", "S");
  ws = commitEditor(editDraft(startEdit({ row: 0, col: 0 }, ""), "  "), ws);
  assert.equal(getCellValue(ws, 0, 0), "  ", "raw content is exact — trimming is display's job");
});

test("AUDIT: the formula bar shows the live draft during an edit, the cell raw otherwise", () => {
  assert.equal(formulaBarContent(null, "=A1*2"), "=A1*2");
  let editor = startEdit({ row: 0, col: 0 }, "=A1*2", { source: "bar" });
  editor = editDraft(editor, "=A1*3");
  assert.equal(formulaBarContent(editor, "=A1*2"), "=A1*3", "both surfaces read one draft");
  // Draft may be edited from either surface; the source only records which.
  assert.equal(editor.source, "bar");
});

test("AUDIT: commit lands on the editor's own position, not the current selection", () => {
  // The selection may have moved (Enter commits then moves) — the write must go
  // where the edit began.
  let ws = createWorksheet("s", "S");
  const editor = editDraft(startEdit({ row: 5, col: 2 }, ""), "here");
  ws = commitEditor(editor, ws);
  assert.equal(getCellValue(ws, 5, 2), "here");
  assert.equal(getCellValue(ws, 0, 0), "");
});
