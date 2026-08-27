/**
 * The spreadsheet data model — Workbook → Worksheet → cells.
 *
 * The store is SPARSE: a worksheet holds only the cells someone has actually
 * put a value in, keyed by A1 reference. A 1000×100 sheet with three values in
 * it is three entries, not 100,000 — the shape the Phase 1 spec requires, and
 * the only shape that scales.
 *
 * Values are RAW strings. Phase 1 stores exactly what was typed and does not
 * interpret it — no formulas, no number parsing, no formatting. Those layers
 * come later and read this model; they do not change its shape.
 *
 * Pure and immutable: every mutation returns a new worksheet, so React can tell
 * what changed by identity and the model can be tested without a DOM.
 */

import { cellRef, parseCellRef, type CellPos, type Rect } from "./coordinates";
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, type GridMetrics } from "./metrics";
import type { SheetFilter } from "./filter";
import type { Validation } from "./validation";
import type { ConditionalFormat } from "./conditional";
import type { CommentMap } from "./comments";
import type { RowGroup } from "./datatools";

/** How large a fresh sheet is. Large enough that rendering it whole is out of
    the question — which is the point of virtualizing it. */
export const DEFAULT_ROW_COUNT = 1000;
export const DEFAULT_COL_COUNT = 100;

/** The largest sheet an IMPORT may materialise — well past any real hand-built
    sheet, but a hard ceiling against a crafted file claiming millions of cells.
    Shared by every importer (xlsx, json), so a file rejected by one cannot
    smuggle the same dimensions in through another. */
export const MAX_IMPORT_ROWS = 200_000;
export const MAX_IMPORT_COLS = 4_096;

/** One cell. Only a value for now; formatting and typing extend this later. */
export interface Cell {
  value: string;
}

export interface Worksheet {
  id: string;
  name: string;
  /** Whether the sheet is hidden from the tab bar. It still exists and its cells
      can be referenced from other sheets; it is just not shown. */
  hidden?: boolean;
  /** Sparse — only non-empty cells, keyed by A1 ref ("A1", "C500"). */
  cells: Record<string, Cell>;
  /**
   * Formatting, kept SEPARATE from the cell values (Phase 5 spec). Sparse: only
   * cells with a non-default style appear, each mapping its A1 ref to a style id
   * in the workbook's `StyleRegistry`. An absent entry means the default style.
   * Because a style is referenced by id, thousands of identically-formatted
   * cells share one style record rather than each carrying a copy.
   */
  cellStyles: Record<string, number>;
  rowCount: number;
  colCount: number;
  /** Per-index dimension overrides. Sparse — only resized rows/columns appear. */
  rowHeights: Record<number, number>;
  colWidths: Record<number, number>;
  /** Hidden rows/columns, sparse sets keyed by index. A hidden line renders at
      zero size, so the geometry skips it and scrolling passes over it. */
  hiddenRows: Record<number, true>;
  hiddenCols: Record<number, true>;
  /** How many leading rows/columns are frozen — they stay put while the rest
      scrolls. 0 means nothing frozen. */
  frozenRows: number;
  frozenCols: number;
  defaultRowHeight: number;
  defaultColWidth: number;
  /** An optional filter over a range — hides non-matching rows without touching
      their data. */
  filter?: SheetFilter;
  /** Data-validation rules — what cells in a range may hold. */
  validations?: Validation[];
  /** Conditional-format rules — a style shown when a cell meets a condition,
      layered on top of its own style, never replacing it. */
  conditionalFormats?: ConditionalFormat[];
  /** Merged regions — each rectangle is shown as one cell, anchored top-left.
      Stored as plain rectangles so the geometry, not the model, decides spans. */
  merges?: Rect[];
  /** Hyperlinks, sparse and keyed by A1 ref — a cell's URL, kept apart from its
      value so text and link are independent. */
  links?: Record<string, string>;
  /** Comment threads, sparse and keyed by A1 ref — a cell's discussion, kept
      apart from its value. */
  comments?: CommentMap;
  /** Outline bands over rows. A collapsed band hides its rows through the same
      mechanism manual hiding uses, so the geometry needs no new concept. */
  rowGroups?: RowGroup[];
}

export interface Workbook {
  worksheets: Worksheet[];
  activeSheetId: string;
}

export function createWorksheet(
  id: string,
  name: string,
  rowCount = DEFAULT_ROW_COUNT,
  colCount = DEFAULT_COL_COUNT,
): Worksheet {
  return {
    id,
    name,
    cells: {},
    cellStyles: {},
    rowCount,
    colCount,
    rowHeights: {},
    colWidths: {},
    hiddenRows: {},
    hiddenCols: {},
    frozenRows: 0,
    frozenCols: 0,
    defaultRowHeight: DEFAULT_ROW_HEIGHT,
    defaultColWidth: DEFAULT_COL_WIDTH,
  };
}

/** A workbook with one blank worksheet. Multiple sheets are a later phase. */
export function createWorkbook(): Workbook {
  const sheet = createWorksheet("sheet-1", "Sheet1");
  return { worksheets: [sheet], activeSheetId: sheet.id };
}

export function activeWorksheet(wb: Workbook): Worksheet {
  return wb.worksheets.find((s) => s.id === wb.activeSheetId) ?? wb.worksheets[0];
}

/** The dimensions a worksheet presents to the geometry layer. */
export function metricsOf(ws: Worksheet): GridMetrics {
  return {
    rows: ws.rowCount,
    cols: ws.colCount,
    defaultRowHeight: ws.defaultRowHeight,
    defaultColWidth: ws.defaultColWidth,
    rowHeights: ws.rowHeights,
    colWidths: ws.colWidths,
    hiddenRows: ws.hiddenRows,
    hiddenCols: ws.hiddenCols,
  };
}

export function getCell(ws: Worksheet, row: number, col: number): Cell | undefined {
  return ws.cells[cellRef(row, col)];
}

export function getCellValue(ws: Worksheet, row: number, col: number): string {
  return ws.cells[cellRef(row, col)]?.value ?? "";
}

/** Whether a cell carries anything — the predicate the region/edge maths runs on. */
export function isFilled(ws: Worksheet, row: number, col: number): boolean {
  const cell = ws.cells[cellRef(row, col)];
  return cell !== undefined && cell.value.trim() !== "";
}

/**
 * Set a cell's raw value, returning a NEW worksheet. An empty value deletes the
 * key rather than storing a blank, so the store stays sparse and "cleared" and
 * "never touched" are the same state on disk.
 */
export function setCellValue(
  ws: Worksheet,
  row: number,
  col: number,
  value: string,
): Worksheet {
  const key = cellRef(row, col);
  const cells = { ...ws.cells };
  if (value === "") {
    if (!(key in cells)) return ws;
    delete cells[key];
  } else {
    if (cells[key]?.value === value) return ws;
    cells[key] = { value };
  }
  return { ...ws, cells };
}

/**
 * One cell write in a BATCH — a new value, a new style id, or both. An omitted
 * field leaves that aspect of the cell alone.
 */
export interface CellWrite {
  row: number;
  col: number;
  value?: string;
  styleId?: number;
}

/**
 * Apply many cell writes in ONE pass, returning a new worksheet.
 *
 * This exists for a measured reason. `setCellValue` copies the whole sparse map
 * on every call, which is right for a single edit but quadratic for a bulk one:
 * a 20,000-cell paste built by looping `setCellValue` copies the map 20,000
 * times and takes over a minute. Copying ONCE and then mutating the private
 * copy makes the same paste linear, while keeping the public contract identical
 * — the input worksheet is never touched and a new one is returned.
 *
 * Writes are applied in order, so a later write to a cell wins over an earlier
 * one (a cut that clears a cell the paste then fills). An empty value or a zero
 * style id deletes its key, so the store stays sparse and never stores blanks.
 */
export function applyCellWrites(ws: Worksheet, writes: readonly CellWrite[]): Worksheet {
  if (writes.length === 0) return ws;
  let cells: Record<string, Cell> | null = null;
  let cellStyles: Record<string, number> | null = null;

  for (const w of writes) {
    const key = cellRef(w.row, w.col);
    if (w.value !== undefined) {
      const current = ws.cells[key]?.value ?? "";
      if (w.value !== current || cells !== null) {
        if (cells === null) cells = { ...ws.cells };
        if (w.value === "") delete cells[key];
        else cells[key] = { value: w.value };
      }
    }
    if (w.styleId !== undefined) {
      const current = ws.cellStyles[key] ?? 0;
      if (w.styleId !== current || cellStyles !== null) {
        if (cellStyles === null) cellStyles = { ...ws.cellStyles };
        if (w.styleId === 0) delete cellStyles[key];
        else cellStyles[key] = w.styleId;
      }
    }
  }

  if (cells === null && cellStyles === null) return ws;
  return {
    ...ws,
    ...(cells !== null ? { cells } : {}),
    ...(cellStyles !== null ? { cellStyles } : {}),
  };
}

/** Clear every cell inside a rectangle, returning a new worksheet. */
export function clearRect(ws: Worksheet, rect: Rect): Worksheet {
  const cells = { ...ws.cells };
  let changed = false;
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let c = rect.left; c <= rect.right; c++) {
      const key = cellRef(r, c);
      if (key in cells) {
        delete cells[key];
        changed = true;
      }
    }
  }
  return changed ? { ...ws, cells } : ws;
}

/** A cell's style id — 0 (the default style) when it has never been formatted. */
export function getCellStyleId(ws: Worksheet, row: number, col: number): number {
  return ws.cellStyles[cellRef(row, col)] ?? 0;
}

/**
 * Set a cell's style id, returning a NEW worksheet. Style id 0 deletes the key
 * rather than storing it, so the style map stays sparse and "reset to default"
 * and "never formatted" are the same state — mirroring how values are stored.
 */
export function setCellStyleId(
  ws: Worksheet,
  row: number,
  col: number,
  styleId: number,
): Worksheet {
  const key = cellRef(row, col);
  const cellStyles = { ...ws.cellStyles };
  if (styleId === 0) {
    if (!(key in cellStyles)) return ws;
    delete cellStyles[key];
  } else {
    if (cellStyles[key] === styleId) return ws;
    cellStyles[key] = styleId;
  }
  return { ...ws, cellStyles };
}

/** Every populated position, for the region and edge calculations. */
export function filledPositions(ws: Worksheet): CellPos[] {
  const out: CellPos[] = [];
  for (const key of Object.keys(ws.cells)) {
    const pos = parseCellRef(key);
    if (pos && ws.cells[key].value.trim() !== "") out.push(pos);
  }
  return out;
}

/** Replace the active worksheet inside a workbook, returning a new workbook. */
export function withActiveWorksheet(wb: Workbook, next: Worksheet): Workbook {
  return {
    ...wb,
    worksheets: wb.worksheets.map((s) => (s.id === next.id ? next : s)),
  };
}
