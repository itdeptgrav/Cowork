/**
 * Structural operations — inserting and deleting rows and columns, and the
 * resize / hide / freeze that live on the same axes.
 *
 * Inserting or deleting a line is the one edit that moves the whole sheet: every
 * cell at or past the cut shifts, and — because the data moved — every formula
 * ANYWHERE must have its references rewritten to keep pointing at the same
 * values (`transformStructural`). A deletion drops the cut cells and turns
 * references into them to `#REF!`; an insertion pushes cells off the far edge.
 * The dimension overrides, the hidden sets and the freeze counts all sit on the
 * same axis, so they shift with it.
 *
 * Everything returns a NEW worksheet — pure and immutable, like the rest of the
 * model — so a structural edit is one snapshot the history can undo whole.
 */

import { cellRef, parseCellRef } from "./coordinates";
import { transformStructural, type StructuralOp } from "./formula/rewrite";
import { isFormula } from "./values";
import type { Cell, Worksheet } from "./model";

/** The index a line maps to under an op, or null when the op deletes it. */
function mapLine(index: number, op: StructuralOp): number | null {
  if (op.mode === "insert") return index >= op.at ? index + op.count : index;
  if (index < op.at) return index;
  if (index < op.at + op.count) return null;
  return index - op.count;
}

/** Shift the keys of an index-keyed map by an op, dropping deleted or
    off-the-sheet entries. */
function shiftIndexMap<T>(
  map: Record<number, T>,
  op: StructuralOp,
  maxLine: number,
): Record<number, T> {
  const out: Record<number, T> = {};
  for (const key of Object.keys(map)) {
    const index = Number(key);
    const next = mapLine(index, op);
    if (next === null || next >= maxLine) continue;
    out[next] = map[index];
  }
  return out;
}

/** How a freeze count moves when its own axis is edited within the frozen band. */
function adjustFrozen(frozen: number, op: StructuralOp): number {
  if (frozen === 0) return 0;
  if (op.mode === "insert") return op.at < frozen ? frozen + op.count : frozen;
  if (op.at >= frozen) return frozen;
  const deletedWithinFrozen = Math.min(op.at + op.count, frozen) - op.at;
  return Math.max(0, frozen - deletedWithinFrozen);
}

/**
 * Apply an insert/delete on one axis, returning a new worksheet: cells shifted
 * and their formulas rewritten, styles shifted, and the axis's overrides, hidden
 * set and freeze count moved to match. Row and column counts stay fixed — an
 * insert pushes data off the end, a delete opens blank lines at it.
 */
export function structuralOp(ws: Worksheet, op: StructuralOp): Worksheet {
  const rowAxis = op.axis === "row";
  const maxLine = rowAxis ? ws.rowCount : ws.colCount;

  const cells: Record<string, Cell> = {};
  for (const ref of Object.keys(ws.cells)) {
    const pos = parseCellRef(ref);
    if (!pos) continue;
    const line = rowAxis ? pos.row : pos.col;
    const next = mapLine(line, op);
    if (next === null || next >= maxLine) continue;
    const nr = rowAxis ? next : pos.row;
    const nc = rowAxis ? pos.col : next;
    const cell = ws.cells[ref];
    /* Every formula is rewritten, even one that did not move — its references
       may point at data that did. */
    const value = isFormula(cell.value) ? transformStructural(cell.value, op) : cell.value;
    cells[cellRef(nr, nc)] = value === cell.value ? cell : { ...cell, value };
  }

  const cellStyles: Record<string, number> = {};
  for (const ref of Object.keys(ws.cellStyles)) {
    const pos = parseCellRef(ref);
    if (!pos) continue;
    const line = rowAxis ? pos.row : pos.col;
    const next = mapLine(line, op);
    if (next === null || next >= maxLine) continue;
    const nr = rowAxis ? next : pos.row;
    const nc = rowAxis ? pos.col : next;
    cellStyles[cellRef(nr, nc)] = ws.cellStyles[ref];
  }

  return {
    ...ws,
    cells,
    cellStyles,
    rowHeights: rowAxis ? shiftIndexMap(ws.rowHeights, op, ws.rowCount) : ws.rowHeights,
    colWidths: rowAxis ? ws.colWidths : shiftIndexMap(ws.colWidths, op, ws.colCount),
    hiddenRows: rowAxis ? shiftIndexMap(ws.hiddenRows, op, ws.rowCount) : ws.hiddenRows,
    hiddenCols: rowAxis ? ws.hiddenCols : shiftIndexMap(ws.hiddenCols, op, ws.colCount),
    frozenRows: rowAxis ? adjustFrozen(ws.frozenRows, op) : ws.frozenRows,
    frozenCols: rowAxis ? ws.frozenCols : adjustFrozen(ws.frozenCols, op),
  };
}

export function insertRows(ws: Worksheet, at: number, count = 1): Worksheet {
  return structuralOp(ws, { axis: "row", at, count, mode: "insert" });
}
export function deleteRows(ws: Worksheet, at: number, count = 1): Worksheet {
  return structuralOp(ws, { axis: "row", at, count, mode: "delete" });
}
export function insertCols(ws: Worksheet, at: number, count = 1): Worksheet {
  return structuralOp(ws, { axis: "col", at, count, mode: "insert" });
}
export function deleteCols(ws: Worksheet, at: number, count = 1): Worksheet {
  return structuralOp(ws, { axis: "col", at, count, mode: "delete" });
}

/** Resize a row; setting it back to the default height drops the override. */
export function setRowHeight(ws: Worksheet, row: number, height: number): Worksheet {
  const rowHeights = { ...ws.rowHeights };
  if (height === ws.defaultRowHeight) delete rowHeights[row];
  else rowHeights[row] = Math.max(0, height);
  return { ...ws, rowHeights };
}

/** Resize a column; setting it back to the default width drops the override. */
export function setColWidth(ws: Worksheet, col: number, width: number): Worksheet {
  const colWidths = { ...ws.colWidths };
  if (width === ws.defaultColWidth) delete colWidths[col];
  else colWidths[col] = Math.max(0, width);
  return { ...ws, colWidths };
}

/** Hide or show an inclusive range of rows. */
export function setRowsHidden(
  ws: Worksheet,
  from: number,
  to: number,
  hidden: boolean,
): Worksheet {
  const hiddenRows = { ...ws.hiddenRows };
  for (let r = Math.min(from, to); r <= Math.max(from, to); r++) {
    if (hidden) hiddenRows[r] = true;
    else delete hiddenRows[r];
  }
  return { ...ws, hiddenRows };
}

/** Hide or show an inclusive range of columns. */
export function setColsHidden(
  ws: Worksheet,
  from: number,
  to: number,
  hidden: boolean,
): Worksheet {
  const hiddenCols = { ...ws.hiddenCols };
  for (let c = Math.min(from, to); c <= Math.max(from, to); c++) {
    if (hidden) hiddenCols[c] = true;
    else delete hiddenCols[c];
  }
  return { ...ws, hiddenCols };
}

/** Freeze the first `n` rows (0 unfreezes), clamped to the sheet. */
export function freezeRows(ws: Worksheet, n: number): Worksheet {
  return { ...ws, frozenRows: Math.max(0, Math.min(n, ws.rowCount)) };
}

/** Freeze the first `n` columns (0 unfreezes), clamped to the sheet. */
export function freezeCols(ws: Worksheet, n: number): Worksheet {
  return { ...ws, frozenCols: Math.max(0, Math.min(n, ws.colCount)) };
}
