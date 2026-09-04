/**
 * Structural operations — inserting and deleting rows and columns, and the
 * resize / hide / freeze that live on the same axes.
 *
 * Inserting or deleting a line is the one edit that moves the whole sheet: every
 * cell at or past the cut shifts, and — because the data moved — every formula
 * ANYWHERE must have its references rewritten to keep pointing at the same
 * values (`transformStructural`). "Anywhere" spans the whole workbook: on the
 * edited sheet both bare and self-qualified (`=Sheet1!A5` written on Sheet1)
 * references move, and on every OTHER sheet the references qualified with the
 * edited sheet's name move — the workbook-level entry points below do both. A
 * deletion drops the cut cells and turns references into them to `#REF!`; an
 * insertion pushes cells off the far edge. The dimension overrides, the hidden
 * sets and the freeze counts all sit on the same axis, so they shift with it.
 *
 * Everything returns a NEW worksheet (or workbook) — pure and immutable, like
 * the rest of the model — so a structural edit is one snapshot the history can
 * undo whole. A worksheet whose cells did not change comes back identical
 * (`===`), so callers can cheaply tell what an edit touched.
 */

import { cellRef, parseCellRef } from "./coordinates";
import { shiftNames } from "./names";
import { shiftCharts } from "./charts";
import { shiftProtection } from "./protection";
import { shiftBanding } from "./banding";
import { shiftBands, shiftRanged, shiftRect, shiftRects, shiftRefMap } from "./structureExtras";
import {
  transformRegionShift,
  transformStructural,
  type RegionShiftOp,
  type RewriteContext,
  type StructuralOp,
} from "./formula/rewrite";
import { isFormula } from "./values";
import type { Cell, Workbook, Worksheet } from "./model";

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
  /* Formulas here live ON the edited sheet, so bare references move and so do
     self-qualified ones — `=Sheet1!A5` written on Sheet1 names the same cell
     as `=A5` and must not go stale while its twin is rewritten. */
  const ctx: RewriteContext = { editedSheet: ws.name };

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
    const value = isFormula(cell.value) ? transformStructural(cell.value, op, ctx) : cell.value;
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
    ...(ws.charts ? { charts: shiftCharts(ws.charts, op) } : {}),
    ...(ws.protection ? { protection: shiftProtection(ws.protection, op) } : {}),
    ...(ws.banding ? { banding: shiftBanding(ws.banding, op) } : {}),
    /* Everything else that names cells or rectangles moves with them. */
    merges: shiftRects(ws.merges, op),
    validations: shiftRanged(ws.validations, op),
    conditionalFormats: shiftRanged(ws.conditionalFormats, op),
    filter: ws.filter ? (() => { const range = shiftRect(ws.filter.range, op); return range ? { ...ws.filter, range } : undefined; })() : undefined,
    links: shiftRefMap(ws.links, op),
    comments: shiftRefMap(ws.comments, op),
    notes: shiftRefMap(ws.notes, op),
    rowGroups: shiftBands(ws.rowGroups, op, "row"),
    colGroups: shiftBands(ws.colGroups, op, "col"),
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

/* ── Workbook-level structural edits ──────────────────────────────────────── */

/**
 * Rewrite one OTHER sheet's formulas for a structural edit on `editedSheet`.
 * Only references qualified with the edited sheet's name move — this sheet's
 * own cells (and its bare references, which point at itself) stay put. Returns
 * the SAME worksheet object when no formula mentions the edited sheet.
 */
function rewriteOtherSheet(
  ws: Worksheet,
  editedSheet: string,
  rewrite: (raw: string, ctx: RewriteContext) => string,
): Worksheet {
  const ctx: RewriteContext = { editedSheet, onEditedSheet: false };
  let changed = false;
  const cells: Record<string, Cell> = {};
  for (const ref of Object.keys(ws.cells)) {
    const cell = ws.cells[ref];
    if (isFormula(cell.value)) {
      const value = rewrite(cell.value, ctx);
      if (value !== cell.value) {
        cells[ref] = { ...cell, value };
        changed = true;
        continue;
      }
    }
    cells[ref] = cell;
  }
  return changed ? { ...ws, cells } : ws;
}

/**
 * Apply a row/column insert or delete on ONE sheet of a workbook, rewriting
 * formulas EVERYWHERE: the edited sheet's bare and self-qualified references,
 * and every other sheet's references into it. This is the operation the
 * product should reach for — a per-sheet `structuralOp` alone leaves other
 * sheets' `=Sheet1!A3` formulas silently pointing at the wrong row.
 */
export function structuralOpWorkbook(wb: Workbook, sheetId: string, op: StructuralOp): Workbook {
  const edited = wb.worksheets.find((s) => s.id === sheetId);
  if (!edited) return wb;
  const worksheets = wb.worksheets.map((ws) =>
    ws.id === sheetId
      ? structuralOp(ws, op)
      : rewriteOtherSheet(ws, edited.name, (raw, ctx) => transformStructural(raw, op, ctx)),
  );
  const names = wb.names ? shiftNames(wb.names, sheetId, op) : undefined;
  return { ...wb, worksheets, ...(names ? { names } : {}) };
}

export function insertRowsWorkbook(wb: Workbook, sheetId: string, at: number, count = 1): Workbook {
  return structuralOpWorkbook(wb, sheetId, { axis: "row", at, count, mode: "insert" });
}
export function deleteRowsWorkbook(wb: Workbook, sheetId: string, at: number, count = 1): Workbook {
  return structuralOpWorkbook(wb, sheetId, { axis: "row", at, count, mode: "delete" });
}
export function insertColsWorkbook(wb: Workbook, sheetId: string, at: number, count = 1): Workbook {
  return structuralOpWorkbook(wb, sheetId, { axis: "col", at, count, mode: "insert" });
}
export function deleteColsWorkbook(wb: Workbook, sheetId: string, at: number, count = 1): Workbook {
  return structuralOpWorkbook(wb, sheetId, { axis: "col", at, count, mode: "delete" });
}

/* ── Cell-block shifts ────────────────────────────────────────────────────── */

/** Where a block of cells is inserted, or which way the gap it leaves closes. */
export type ShiftDirection = "down" | "right" | "up" | "left";

const SHIFTS: Record<ShiftDirection, { axis: "row" | "col"; mode: "insert" | "delete" }> = {
  down: { axis: "row", mode: "insert" },
  right: { axis: "col", mode: "insert" },
  up: { axis: "row", mode: "delete" },
  left: { axis: "col", mode: "delete" },
};

/**
 * Insert or delete a BLOCK of cells, moving only the cells in its own band.
 *
 * This is the operation behind Insert ▸ Cells. Unlike a row or column edit it
 * does not move the whole sheet: inserting at `B2:C3` with a downward shift
 * pushes only columns B and C down by two, and column A does not move at all.
 * Every formula on the sheet is still rewritten, because a formula anywhere may
 * point INTO the band — but a reference outside it, or a range straddling its
 * edge, is deliberately left alone (see `transformRegionShift`).
 *
 * The row and column counts are fixed, as they are for a row/column edit: an
 * insert pushes cells off the band's far end, a delete opens blank ones at it.
 *
 * **Merges, validations, conditional formats, comments and links are not
 * reference-tracked through this** (a block shift, unlike a whole-line edit
 * in `structuralOp`, which now moves them all).
 */
export function shiftCells(
  ws: Worksheet,
  rect: { top: number; left: number; bottom: number; right: number },
  direction: ShiftDirection,
): Worksheet {
  const { axis, mode } = SHIFTS[direction];
  const op: RegionShiftOp = { rect, axis, mode };
  const ctx: RewriteContext = { editedSheet: ws.name };
  const vertical = axis === "row";
  const at = vertical ? rect.top : rect.left;
  const count = vertical ? rect.bottom - rect.top + 1 : rect.right - rect.left + 1;
  const maxLine = vertical ? ws.rowCount : ws.colCount;
  const lineOp: StructuralOp = { axis, at, count, mode };

  /** Is this cell in the moving band, across the other axis? */
  const banded = (row: number, col: number) =>
    vertical
      ? col >= rect.left && col <= rect.right
      : row >= rect.top && row <= rect.bottom;

  const cells: Record<string, Cell> = {};
  const cellStyles: Record<string, number> = {};

  for (const ref of Object.keys(ws.cells)) {
    const pos = parseCellRef(ref);
    if (!pos) continue;
    const cell = ws.cells[ref];
    /* Every formula is rewritten wherever it lives — the data it points at may
       have moved even when the formula did not. */
    const value = isFormula(cell.value) ? transformRegionShift(cell.value, op, ctx) : cell.value;
    const next = value === cell.value ? cell : { ...cell, value };

    if (!banded(pos.row, pos.col)) {
      cells[ref] = next;
      continue;
    }
    const line = mapLine(vertical ? pos.row : pos.col, lineOp);
    if (line === null || line >= maxLine) continue;
    cells[cellRef(vertical ? line : pos.row, vertical ? pos.col : line)] = next;
  }

  for (const ref of Object.keys(ws.cellStyles)) {
    const pos = parseCellRef(ref);
    if (!pos) continue;
    if (!banded(pos.row, pos.col)) {
      cellStyles[ref] = ws.cellStyles[ref];
      continue;
    }
    const line = mapLine(vertical ? pos.row : pos.col, lineOp);
    if (line === null || line >= maxLine) continue;
    cellStyles[cellRef(vertical ? line : pos.row, vertical ? pos.col : line)] =
      ws.cellStyles[ref];
  }

  /* Row heights, column widths, hidden sets and freezes belong to a whole line.
     A block shift moves part of a line, so none of them moves with it. */
  return { ...ws, cells, cellStyles };
}

/**
 * A cell-block shift on ONE sheet of a workbook, rewriting other sheets'
 * qualified references into the shifted band too — the block-shift counterpart
 * of `structuralOpWorkbook`.
 */
export function shiftCellsWorkbook(
  wb: Workbook,
  sheetId: string,
  rect: { top: number; left: number; bottom: number; right: number },
  direction: ShiftDirection,
): Workbook {
  const edited = wb.worksheets.find((s) => s.id === sheetId);
  if (!edited) return wb;
  const { axis, mode } = SHIFTS[direction];
  const op: RegionShiftOp = { rect, axis, mode };
  const worksheets = wb.worksheets.map((ws) =>
    ws.id === sheetId
      ? shiftCells(ws, rect, direction)
      : rewriteOtherSheet(ws, edited.name, (raw, ctx) => transformRegionShift(raw, op, ctx)),
  );
  return { ...wb, worksheets };
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
