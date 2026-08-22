/**
 * Undo/redo — a command history built on cell-level diffs, not snapshots.
 *
 * Requirement 11 is explicit: do NOT clone the whole workbook for every edit. So
 * a command records only the cells it touched, each as a `{ before, after }`
 * pair. Undo writes the `before`s back; redo writes the `after`s. Memory is
 * proportional to what CHANGED, so typing a character into one cell of a
 * thousand-row sheet costs one entry, and a paste costs one entry per pasted
 * cell — never the sheet.
 *
 * The command list is the single description of a mutation: every editing
 * action (an edit, a paste, a cut, a fill, a clear) turns its intent into a set
 * of changes, applies them, and records one command. Undo and redo are then the
 * same machinery for all of them, which is why they each get undo/redo for free
 * (requirement 12).
 *
 * Pure and DOM-free: this module owns the change algebra and the two stacks; the
 * React hook mirrors each change into the formula engine as it applies it.
 */

import { cellRef } from "./coordinates";
import { applyCellWrites, type CellWrite, type Workbook, type Worksheet } from "./model";

/**
 * One cell's transition inside a command. Value and style are recorded
 * independently: a plain edit changes only the value, a format changes only the
 * style, and a paste changes both. The style fields are present ONLY when the
 * style actually changed, so a value-only edit records exactly `{ row, col,
 * before, after }` and formatting adds no weight to the common case.
 */
export interface CellChange {
  row: number;
  col: number;
  /** The raw content before the command — what undo restores. */
  before: string;
  /** The raw content after the command — what redo restores. */
  after: string;
  /** The style id before the command, present only when the style changed. */
  styleBefore?: number;
  /** The style id after the command, present only when the style changed. */
  styleAfter?: number;
}

/** An intended edit: a new value, a new style, or both. An omitted field leaves
    that aspect of the cell untouched. */
export interface CellEdit {
  row: number;
  col: number;
  raw?: string;
  style?: number;
}

/** A named, reversible mutation described by the cells it changed — the common
    case (edit, format, paste, fill, clear). `sheetId` is the sheet it happened
    on, so undo/redo target the right sheet in a multi-sheet workbook. */
export interface CellCommand {
  kind: "cells";
  label: string;
  sheetId: string;
  changes: CellChange[];
}

/**
 * A structural mutation (insert/delete row or column, resize, hide, freeze).
 *
 * These reshape the whole worksheet — shifting many cells, rewriting formulas,
 * moving dimension and hidden maps — so they are not naturally a list of cell
 * diffs. They are infrequent (never per-keystroke), so undoing them by keeping
 * the before/after worksheet snapshot is both correct and simple. This is the
 * ONE place a snapshot is taken, and deliberately so.
 */
export interface StructuralCommand {
  kind: "structural";
  label: string;
  sheetId: string;
  before: Worksheet;
  after: Worksheet;
}

/**
 * A structural mutation whose formula rewrites reach BEYOND the edited sheet —
 * inserting or deleting rows/columns also rewrites references to that sheet
 * from every other sheet. Only the worksheets that actually changed are
 * recorded (the workbook ops return untouched sheets as the same object, so
 * they are identity-diffed away): an untouched sheet costs nothing, keeping
 * requirement 11's spirit even though each changed sheet is a snapshot.
 */
export interface WorkbookStructuralCommand {
  kind: "workbookStructural";
  label: string;
  /** The sheet the reshape happened on — where the selection lives. */
  sheetId: string;
  sheets: { before: Worksheet; after: Worksheet }[];
}

export type Command = CellCommand | StructuralCommand | WorkbookStructuralCommand;

/* Applying and reverting go through ONE batched write (`applyCellWrites`) rather
   than a per-cell `setCellValue`. The per-cell form copies the whole sparse map
   each time, which is quadratic for a large paste or undo; batching copies once.
   The result is identical — a new worksheet, the input untouched. */

/** Apply a command's changes to a worksheet (write every `after` — value, and
    style where the command changed it). */
export function applyChanges(ws: Worksheet, changes: readonly CellChange[]): Worksheet {
  const writes: CellWrite[] = changes.map((c) => ({
    row: c.row,
    col: c.col,
    value: c.after,
    ...(c.styleAfter !== undefined ? { styleId: c.styleAfter } : {}),
  }));
  return applyCellWrites(ws, writes);
}

/** Revert a command's changes on a worksheet (write every `before`). */
export function revertChanges(ws: Worksheet, changes: readonly CellChange[]): Worksheet {
  const writes: CellWrite[] = changes.map((c) => ({
    row: c.row,
    col: c.col,
    value: c.before,
    ...(c.styleBefore !== undefined ? { styleId: c.styleBefore } : {}),
  }));
  return applyCellWrites(ws, writes);
}

/**
 * Build a command from a set of intended edits over a worksheet.
 *
 * `edits` may name the same cell more than once (a cut clears a cell the paste
 * then fills); the LAST write wins, and each cell's `before` is captured from
 * the worksheet as it stands, so undo restores the original in one step. A cell
 * whose value would not actually change is dropped, so a no-op records nothing
 * and does not pollute the undo stack.
 */
export function buildCommand(
  label: string,
  ws: Worksheet,
  edits: readonly CellEdit[],
): CellCommand {
  /* Collapse edits to one per cell, merging PER FIELD so a value edit and a
     style edit for the same cell combine (a cut clears then a paste fills). Last
     write wins within each field; first-seen order is preserved. */
  const merged = new Map<string, { row: number; col: number; raw?: string; style?: number }>();
  const order: string[] = [];
  for (const e of edits) {
    const key = `${e.row}:${e.col}`;
    let cur = merged.get(key);
    if (!cur) {
      cur = { row: e.row, col: e.col };
      merged.set(key, cur);
      order.push(key);
    }
    if (e.raw !== undefined) cur.raw = e.raw;
    if (e.style !== undefined) cur.style = e.style;
  }

  const changes: CellChange[] = [];
  for (const key of order) {
    const { row, col, raw, style } = merged.get(key)!;
    const beforeValue = ws.cells[cellRef(row, col)]?.value ?? "";
    const afterValue = raw ?? beforeValue;
    const beforeStyle = ws.cellStyles[cellRef(row, col)] ?? 0;
    const afterStyle = style ?? beforeStyle;

    const valueChanged = beforeValue !== afterValue;
    const styleChanged = beforeStyle !== afterStyle;
    if (!valueChanged && !styleChanged) continue;

    const change: CellChange = { row, col, before: beforeValue, after: afterValue };
    if (styleChanged) {
      change.styleBefore = beforeStyle;
      change.styleAfter = afterStyle;
    }
    changes.push(change);
  }
  return { kind: "cells", label, sheetId: ws.id, changes };
}

/** A structural command from the worksheet before and after the reshape. */
export function structuralCommand(
  label: string,
  before: Worksheet,
  after: Worksheet,
): StructuralCommand {
  return { kind: "structural", label, sheetId: before.id, before, after };
}

/** A workbook-structural command from the workbook before and after the
    reshape, recording only the worksheets that changed (identity-diffed —
    the workbook-level ops return untouched sheets as the same object). */
export function workbookStructuralCommand(
  label: string,
  sheetId: string,
  before: Workbook,
  after: Workbook,
): WorkbookStructuralCommand {
  const sheets: { before: Worksheet; after: Worksheet }[] = [];
  for (const b of before.worksheets) {
    const a = after.worksheets.find((s) => s.id === b.id);
    if (a && a !== b) sheets.push({ before: b, after: a });
  }
  return { kind: "workbookStructural", label, sheetId, sheets };
}

/**
 * The two-stack undo history. `past` holds applied commands newest-last; `undo`
 * moves the newest to `future`; `redo` moves it back. Recording a fresh command
 * discards the redo branch, the standard linear-history behaviour.
 */
export class History {
  private past: Command[] = [];
  private future: Command[] = [];

  /** Record a just-applied command. A command that changed nothing — no cell
      changes, no reshaped sheets — is ignored, and recording clears any redo
      branch. */
  record(command: Command): void {
    if (command.kind === "cells" && command.changes.length === 0) return;
    if (command.kind === "workbookStructural" && command.sheets.length === 0) return;
    this.past.push(command);
    this.future.length = 0;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Pop the newest command to undo, moving it onto the redo branch. */
  undo(): Command | null {
    const command = this.past.pop();
    if (!command) return null;
    this.future.push(command);
    return command;
  }

  /** Pop the newest undone command to redo, moving it back onto the past. */
  redo(): Command | null {
    const command = this.future.pop();
    if (!command) return null;
    this.past.push(command);
    return command;
  }
}
