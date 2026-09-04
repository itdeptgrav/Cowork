"use client";

/**
 * The spreadsheet's DATA state, kept apart from the grid's UI state.
 *
 * This hook owns the workbook, the selection and the in-progress edit, and
 * exposes intent-named actions over them. Every action is a thin call into the
 * pure engine (`lib/spreadsheet`) — the selection maths, and now the editor
 * state machine — so what a keystroke MEANS lives in tested engine code and this
 * hook only routes to it.
 */

import { colorScaleColor, dataBarFraction, rangeNumbers, type CellPaint } from "@/lib/spreadsheet/conditionalVisual";
import { bandColorAt, rectsOverlap, type Banding, type BandPreset } from "@/lib/spreadsheet/banding";
import { useEffect, useMemo, useRef, useState } from "react";
import { cellRef, columnLabel as columnLabelFor, parseCellRef, type CellPos, type Rect } from "@/lib/spreadsheet/coordinates";
import {
  editDraft,
  startEdit,
  type CellEditorState,
  type EditSource,
} from "@/lib/spreadsheet/editor";
import { FormulaEngine } from "@/lib/spreadsheet/formula";
import { formatValue } from "@/lib/spreadsheet/format";
import { defineName, nameProblem, removeName, type NamedRange } from "@/lib/spreadsheet/names";
import { buildPivot, pivotFields, pivotFootprint, pivotWrites, type PivotDefinition, type PivotSpec, type SourceCell } from "@/lib/spreadsheet/pivot";
import { DEFAULT_PAGE_SETUP, printHtml, usedRange, type PageSetup } from "@/lib/spreadsheet/printHtml";
import { clampZoom, colWidth as colWidthOf, rowHeight as rowHeightOf } from "@/lib/spreadsheet/metrics";
import {
  mayEdit,
  protectRange as protectRangeOp,
  protectSheet as protectSheetOp,
  protectionAt,
  protectionInRect,
  refusalMessage,
  unprotectRange as unprotectRangeOp,
  type SheetProtection,
  type WorkbookAccess,
} from "@/lib/spreadsheet/protection";
import {
  addChart as addChartOp,
  chartModel,
  newChart,
  raiseChart,
  removeChart as removeChartOp,
  updateChart as updateChartOp,
  type ChartModel,
  type ChartSpec,
  type ChartType,
} from "@/lib/spreadsheet/charts";
import {
  activeWorksheet,
  createWorkbook,
  getCellStyleId,
  getCellValue,
  isFilled,
  setCellValue,
  withActiveWorksheet,
  type Workbook,
  type Worksheet,
  metricsOf,
  applyCellWrites,
  createWorksheet,
  type CellWrite,
} from "@/lib/spreadsheet/model";
import {
  borderEdgesForPreset,
  mergeStyle,
  StyleRegistry,
  type Border,
  type BorderPreset,
  type Borders,
  type CellStyle,
  type Mark,
} from "@/lib/spreadsheet/style";
import { adjustFormula } from "@/lib/spreadsheet/formula/references";
import { BLANK, type ScalarValue } from "@/lib/spreadsheet/formula/value";
import { sortRangeEdits, type SortDirection } from "@/lib/spreadsheet/sort";
import { computeFilterHidden, type ColumnFilter, type SheetFilter } from "@/lib/spreadsheet/filter";
import {
  rejectsInvalid,
  validateValue,
  validationAt,
  type Validation,
  type ValidationRule,
} from "@/lib/spreadsheet/validation";

/** The behaviour half of a validation — everything but the rule itself. */
export type ValidationSettings = Omit<Validation, "range" | "rule">;
import {
  conditionMatches,
  duplicateValueSet,
  rangeContains,
  type CondCondition,
  type ConditionalFormat, isVisualCondition } from "@/lib/spreadsheet/conditional";
import {
  applyMerge,
  hasMergeIn,
  mergeAt,
  removeMerge,
  type MergeKind,
} from "@/lib/spreadsheet/merge";
import {
  findMatches,
  replaceAllEdits,
  replaceCellRaw,
  type CellMatch,
  type SearchOptions,
} from "@/lib/spreadsheet/search";
import { detectUrl, linkAt, normalizeUrl, setLink } from "@/lib/spreadsheet/hyperlink";
import {
  addComment as addCommentOp,
  editComment as editCommentOp,
  removeComment as removeCommentOp,
  setResolved as setResolvedOp,
  threadAt,
  type CommentThread,
} from "@/lib/spreadsheet/comments";
import {
  cellSelection,
  extendActive,
  extendTo,
  extendToEdge,
  moveActive,
  moveDocumentEnd,
  moveDocumentStart,
  moveEnd,
  moveHome,
  moveToEdge,
  selectAllStep,
  selectCell,
  type Bounds,
  type Direction,
  type SelectionState,
} from "@/lib/spreadsheet/selection";
import {
  applyChanges,
  buildCommand,
  History,
  revertChanges,
  structuralCommand,
  workbookStructuralCommand,
  type CellEdit,
  type Command,
} from "@/lib/spreadsheet/history";
import {
  deleteColsWorkbook,
  deleteRowsWorkbook,
  freezeCols as freezeColsOp,
  freezeRows as freezeRowsOp,
  insertColsWorkbook,
  insertRowsWorkbook,
  setColWidth,
  setColsHidden,
  setRowHeight,
  setRowsHidden,
  shiftCellsWorkbook,
} from "@/lib/spreadsheet/structure";
import {
  buildTable,
  fitsOnSheet,
  regionHasMerge,
  regionIsEmpty,
  tableFootprint,
  templateById,
} from "@/lib/spreadsheet/templates";
import {
  addSheet as addSheetOp,
  createSheet as createSheetOp,
  deleteSheet as deleteSheetOp,
  duplicateSheet as duplicateSheetOp,
  moveSheet as moveSheetOp,
  renameSheet as renameSheetOp,
  setSheetHidden as setSheetHiddenOp,
  sheetIdentities,
  switchSheet as switchSheetOp,
  visibleSheets,
} from "@/lib/spreadsheet/workbook";
import { csvToWorksheet, worksheetToCsv } from "@/lib/spreadsheet/csvio";
import {
  addRowGroup,
  collapsedRows,
  removeRowGroup,
  subtotalPlan,
  textToColumnsEdits,
  toggleRowGroup,
  type Delimiter,
  collapsedCols,
} from "@/lib/spreadsheet/datatools";
import { exportWorkbookJson, importWorkbookJson } from "@/lib/spreadsheet/jsonio";
import {
  deserializeWorkbook,
  serializeWorkbook,
  type SerializedWorkbook,
} from "@/lib/spreadsheet/persistence";
import {
  clearSourceEdits,
  clearSourceStyles,
  copyRange,
  fromTSV,
  pasteEdits,
  pasteRect,
  pasteStyles,
  toTSV,
  type Clipboard,
  transposeClipboard,
} from "@/lib/spreadsheet/clipboard";
import { computeFill, fillDestRect } from "@/lib/spreadsheet/fill";

export interface MoveOptions {
  extend?: boolean;
  toEdge?: boolean;
}

export interface BeginEditOptions {
  initial?: string;
  source?: EditSource;
}

export interface SpreadsheetController {
  worksheet: Worksheet;
  /** The whole workbook — its identity changes on every mutation, so persistence
      can watch it to know when to autosave. */
  workbook: Workbook;
  selection: SelectionState;
  editing: CellEditorState | null;
  bounds: Bounds;
  /** The RAW content of a cell — what was typed, what the formula bar shows. */
  rawValue: (row: number, col: number) => string;
  /** The formula engine — the COMPUTED display, kept in step with the raw cells.
      The grid reads it; the formula bar deliberately does not. */
  engine: FormulaEngine;
  /** The style store — cells reference styles here by id. The grid reads it to
      paint each cell; the toolbar reads it to show the active cell's format. */
  styleRegistry: StyleRegistry;
  /** The resolved style of the active cell — what the toolbar reflects. */
  activeStyle: CellStyle;
  /** The block awaiting paste, for the copy/cut outline — null when none. */
  clipboard: Clipboard | null;
  /** Dismiss the pending copy/cut block — Escape's job, as in Excel. */
  clearClipboard: () => void;

  clickCell: (pos: CellPos, shiftKey: boolean) => void;
  dragTo: (pos: CellPos) => void;
  move: (dir: Direction, opts?: MoveOptions) => void;
  /** Jump by a screenful (Page Up / Page Down). */
  movePage: (dir: "up" | "down", rows: number, extend: boolean) => void;
  pressHome: (ctrl: boolean) => void;
  pressEnd: (ctrl: boolean) => void;
  selectAll: () => void;
  selectColumn: (col: number, shiftKey: boolean) => void;
  selectRow: (row: number, shiftKey: boolean) => void;

  beginEdit: (opts?: BeginEditOptions) => void;
  /** Open the active cell's editor pre-filled with `=NAME(`, caret at the end —
      what Insert ▸ Function does. The reader types the arguments; the in-editor
      helper takes over from there. */
  insertFunction: (name: string) => void;
  /** Append text to the active cell — Insert ▸ Emoji. Appends to the OPEN
      editor when there is one, so it lands where the reader is already typing
      rather than replacing what they have written. */
  appendToCell: (text: string) => void;
  changeEdit: (value: string) => void;
  commitEdit: (thenMove?: Direction) => void;
  cancelEdit: () => void;
  clearSelection: () => void;

  copy: () => void;
  cut: () => void;
  paste: () => void;
  undo: () => void;
  redo: () => void;
  /** The rectangle a handle dragged to `target` would fill — for the preview. */
  fillPreviewRect: (target: CellPos) => Rect;
  fillTo: (target: CellPos) => void;

  /** Merge a style patch onto every cell in the selection (undoable). */
  applyFormat: (patch: Partial<CellStyle>) => void;
  /** Toggle a mark (bold/italic/underline/strikethrough) across the selection —
      off if every cell already has it, on otherwise. */
  toggleMark: (mark: Mark) => void;
  /** Apply a border preset over the selection, or clear it (border = null). */
  applyBorders: (preset: BorderPreset, border: Border | null) => void;

  /* Structural operations — all act on the rows/columns the selection spans. */
  insertRows: (where: "above" | "below") => void;
  deleteRows: () => void;
  hideRows: () => void;
  unhideRows: () => void;
  resizeRow: (row: number, height: number) => void;
  /** Resize a run of rows as one undoable command. */
  resizeRows: (from: number, to: number, height: number) => void;
  autoFitRow: (row: number) => void;
  insertCols: (where: "left" | "right") => void;
  deleteCols: () => void;
  /** Insert a block of blank cells the size of the selection, pushing the cells
      in its own band down or right. Unlike a row/column insert, nothing outside
      the band moves. */
  insertCells: (direction: "down" | "right") => void;
  /** Delete the selected block, closing the gap from below or from the right. */
  deleteCells: (direction: "up" | "left") => void;
  /**
   * Drop a pre-built table at the active cell — headers, widths, banding,
   * per-column rules, a filter and (at the top of the sheet) a frozen header, in
   * ONE undoable step.
   *
   * Refuses rather than overwrites: `blocked` says why, so the caller can tell
   * the reader instead of silently eating their data.
   */
  insertTable: (templateId: string) => { ok: boolean; blocked?: "occupied" | "no-room" };
  /** Whether a template would land cleanly at the active cell right now — for
      showing the warning before the click rather than after it. */
  tableFits: (templateId: string) => { ok: boolean; blocked?: "occupied" | "no-room" };
  hideCols: () => void;
  unhideCols: () => void;
  resizeCol: (col: number, width: number) => void;
  /** Resize a run of columns as one undoable command. */
  resizeCols: (from: number, to: number, width: number) => void;
  autoFitCol: (col: number, width: number) => void;
  freezeRows: (n: number) => void;
  freezeCols: (n: number) => void;
  /** Clear both freeze axes as one command. */
  unfreeze: () => void;

  /* Workbook — the sheets, and the operations over them. */
  /** The id of the sheet currently shown. */
  activeSheetId: string;
  /** Visible sheets, in tab order. */
  sheets: { id: string; name: string }[];
  /** Hidden sheets, for an "unhide" affordance. */
  hiddenSheets: { id: string; name: string }[];
  createSheet: () => void;
  deleteSheet: (id: string) => void;
  renameSheet: (id: string, name: string) => void;
  duplicateSheet: (id: string) => void;
  moveSheet: (id: string, toIndex: number) => void;
  hideSheet: (id: string) => void;
  unhideSheet: (id: string) => void;
  switchSheet: (id: string) => void;

  /** The workbook as a serializable value — for persistence. */
  serialize: () => SerializedWorkbook;
  /** Replace the live workbook with a loaded one (resets selection and history). */
  hydrate: (data: SerializedWorkbook) => void;

  /* Data features (Phase 10). */
  /** The style a cell is DISPLAYED with — base style plus matching conditional
      formats, computed for rendering without changing the stored style. */
  effectiveStyle: (row: number, col: number) => CellStyle;
  /** Rows hidden by the active sheet's filter (merged with manual hides). */
  filterHiddenRows: Record<number, true>;
  /** The displayed text of a cell — for filter/validation UI. */
  displayAt: (row: number, col: number) => string;
  /** The validation covering a cell, or null. */
  validationLookup: (row: number, col: number) => Validation | null;
  sortSelection: (direction: SortDirection, keyCol?: number) => void;
  toggleFilter: () => void;
  setColumnFilter: (col: number, filter: ColumnFilter | null) => void;
  clearFilter: () => void;
  setValidation: (rule: ValidationRule, settings?: ValidationSettings) => void;
  clearValidation: () => void;
  addConditionalFormat: (condition: CondCondition, styleId: number) => void;
  clearConditionalFormats: () => void;
  toggleCheckbox: (row: number, col: number) => void;
  commitValue: (row: number, col: number, raw: string) => void;

  /* Advanced UI features (Phase 11). */
  /** The merge covering a cell, or null — for spanning the anchor and hiding the
      cells it covers. */
  mergeLookup: (row: number, col: number) => Rect | null;
  /** Whether any merge intersects the current selection (enables Unmerge). */
  hasMergeInSelection: boolean;
  mergeCells: (kind: MergeKind) => void;
  unmergeCells: () => void;

  /** The URL on a cell — an explicit link, or a bare URL value auto-detected. */
  linkLookup: (row: number, col: number) => string | undefined;
  /** Set (url) or remove (null) the active cell's explicit link. */
  setCellLink: (url: string | null) => void;

  /** The comment thread on a cell, or undefined. */
  commentLookup: (row: number, col: number) => CommentThread | undefined;
  addComment: (row: number, col: number, body: string) => void;
  editComment: (row: number, col: number, entryId: string, body: string) => void;
  removeComment: (row: number, col: number, entryId: string) => void;
  resolveComment: (row: number, col: number, resolved: boolean) => void;

  /** Find every cell matching a query (row-major); replace one or all matches. */
  search: (query: string, opts: SearchOptions) => CellMatch[];
  replaceOne: (row: number, col: number, query: string, replacement: string, opts: SearchOptions) => boolean;
  replaceAll: (query: string, replacement: string, opts: SearchOptions) => number;
  /** Select and scroll to a cell — how "find next" moves. */
  revealCell: (row: number, col: number) => void;
  /** Select a rectangle — on another sheet too — and scroll to its corner. */
  selectRect: (rect: Rect, sheetId?: string) => void;

  /* --- Named ranges (see `lib/spreadsheet/names.ts`) --- */
  names: NamedRange[];
  /** Define (or redefine) a name for a range on the active sheet — the
      current selection when none is given. Returns the problem with the name,
      or null when it was defined. */
  defineNamedRange: (name: string, range?: Rect, sheetId?: string) => string | null;
  removeNamedRange: (name: string) => void;

  /* --- View --- */
  /** Show each formula's text in its cell instead of its result. */
  showFormulas: boolean;
  setShowFormulas: (value: boolean) => void;
  /** Whether the grid draws its cell boundaries. This reader's alone. */
  showGridlines: boolean;
  setShowGridlines: (value: boolean) => void;
  /** The grid's magnification, 0.5 to 2. This reader's alone; not saved. */
  zoom: number;
  setZoom: (zoom: number) => void;

  /* --- Notes, column outlines, pictures --- */
  /** A cell's note — a plain annotation — or undefined. */
  noteLookup: (row: number, col: number) => string | undefined;
  /** Set a note on the active cell; empty text removes it. */
  setNote: (row: number, col: number, text: string) => void;
  groupCols: () => void;
  ungroupCols: () => void;
  setColsCollapsed: (collapsed: boolean) => void;
  /** Columns hidden because an outline band is collapsed. */
  collapsedColsMap: Record<number, true>;
  /** Put a picture in the active cell by its https address. */
  insertImageCell: (url: string) => void;
  /** The view option that shades every protected cell. */
  showProtected: boolean;
  setShowProtected: (value: boolean) => void;

  /* --- Live collaboration (see `useWorkbookCollab.ts`) --- */
  /** Replace the workbook with what the shared document holds, keeping the
      undo history and the selection; the engine learns only what changed. */
  applyRemote: (next: Workbook, change: { cells: { sheetId: string; row: number; col: number; value: string }[]; structural: boolean; namesChanged: boolean }) => void;

  /* --- Protection (see `lib/spreadsheet/protection.ts`) --- */
  /** How the signed-in person reaches the workbook; the owner may edit
      protected cells and is the only one who may change protection. */
  access: WorkbookAccess;
  setAccess: (access: WorkbookAccess) => void;
  protection: SheetProtection | undefined;
  /** Lock the selection (or a rectangle) against everyone but the owner. */
  protectRange: (note?: string, rect?: Rect) => void;
  unprotectRange: (id: string) => void;
  protectSheet: (on: boolean) => void;
  /** What protects a cell, or null — for the lock marker and the refusal. */
  protectionLookup: (row: number, col: number) => ReturnType<typeof protectionAt>;
  /** The last refused change, as the sentence to show; cleared by `clearNotice`. */
  notice: string | null;
  clearNotice: () => void;

  /* --- Printing (see `lib/spreadsheet/printHtml.ts`) --- */
  pageSetup: PageSetup;
  setPageSetup: (patch: Partial<PageSetup>) => void;
  /** Print only the selection from now on, or clear the area. */
  setPrintArea: (on: boolean) => void;
  /** The printable document for the active sheet. */
  printDocument: (workbookTitle: string) => string;

  /* --- Pivot tables (see `lib/spreadsheet/pivot.ts`) --- */
  pivots: PivotDefinition[];
  /** The header names of the selection, for choosing pivot fields. */
  pivotFieldsOfSelection: () => string[];
  /** Summarise the selection onto a new sheet; returns the problem, or null. */
  insertPivot: (spec: PivotSpec) => string | null;
  /** Rebuild every pivot table from its source's current values. */
  refreshPivots: () => number;
  removePivot: (id: string) => void;

  /* --- Charts (see `lib/spreadsheet/charts.ts`) --- */
  charts: ChartSpec[];
  selectedChartId: string | null;
  selectChart: (id: string | null) => void;
  /** A chart of the current selection, dropped onto the sheet. Needs at
      least two cells; returns the new chart's id, or null. */
  insertChart: (type: ChartType) => string | null;
  updateChart: (id: string, patch: Partial<ChartSpec>) => void;
  removeChart: (id: string) => void;
  /** The data a chart draws right now — evaluated values, so formulas plot
      their results. */
  chartData: (spec: ChartSpec) => ChartModel;

  /** Paste only the values, or only the formatting, of the copied block. */
  pasteSpecial: (mode: "values" | "formats" | "transpose") => void;
  /** Reset the selection's cells to the default style, keeping their values. */
  clearFormatting: () => void;
  /** Drop duplicate rows in the selection, keeping the first of each. Returns
      how many rows were removed. */
  removeDuplicates: () => number;
  /** Trim the ends and collapse runs of spaces in every selected text cell.
      Returns how many cells changed. */
  trimWhitespace: () => number;
  /** Alternating row colours on the active sheet. */
  bands: Banding[];
  /** Band the selection with a preset, replacing any band it overlaps. */
  addBanding: (preset: BandPreset) => void;
  /** Remove every band touching the selection. */
  removeBanding: () => void;
  /** The colour-scale fill and data bar a cell gets from its conditional
      formats, or null when no visual rule covers it. */
  paintAt: (row: number, col: number) => CellPaint | null;
  /** Split the selection's first column across the columns to its right. */
  textToColumns: (delimiter: Delimiter) => void;
  /** Insert a SUM under each run of equal values in the grouping column. */
  insertSubtotals: (groupCol: number, sumCol: number) => number;
  /** Outline the selected rows, remove the outline, or collapse/expand it. */
  groupRows: () => void;
  ungroupRows: () => void;
  setRowsCollapsed: (collapsed: boolean) => void;
  /** Rows hidden because an outline band is collapsed. */
  collapsedRowsMap: Record<number, true>;

  /* Import / export (Phase 12). */
  /** The active sheet as CSV text (displayed values, RFC 4180). */
  exportCsv: () => string;
  /** Add a new sheet from CSV text, and switch to it. Never throws. */
  importCsv: (name: string, text: string) => void;
  /** The whole workbook as a JSON document. */
  exportJson: () => string;
  /** Replace the workbook from a JSON document — or report why it can't. */
  importJson: (text: string) => { ok: boolean; error?: string };
  /** The whole workbook as `.xlsx` bytes (SheetJS loaded on demand). */
  exportXlsx: () => Promise<ArrayBuffer>;
  /** Replace the workbook from `.xlsx` bytes — or report why it can't. */
  importXlsx: (bytes: ArrayBuffer | Uint8Array) => Promise<{ ok: boolean; error?: string }>;
}

/** The author recorded on a comment this session writes. A single-user build
    stamps "You"; a future collaboration layer supplies the real identity. */
const COMMENT_AUTHOR = "You";

/** The workbook's names in the flat shape the engine takes. */
function engineNames(wb: Workbook) {
  return (wb.names ?? []).map((n) => ({
    name: n.name,
    sheetId: n.sheetId,
    top: n.range.top,
    left: n.range.left,
    bottom: n.range.bottom,
    right: n.range.right,
  }));
}

export function useSpreadsheet(): SpreadsheetController {
  const [workbook, setWorkbook] = useState<Workbook>(() => createWorkbook());
  const [selection, setSelection] = useState<SelectionState>(() =>
    cellSelection({ row: 0, col: 0 }),
  );
  const [editing, setEditing] = useState<CellEditorState | null>(null);
  /* A synchronous mirror of `editing`, consumed by commit/cancel.
     The editor input commits on blur as a safety net, and blur fires INSIDE the
     same event as an Enter-commit or an Escape-cancel — before React re-renders
     — so the blur handler's closure still sees the edit as open. Reading the
     mirror instead, and nulling it the moment a commit or cancel CONSUMES the
     edit, makes the second call a no-op: Escape no longer commits the draft it
     just discarded, and Enter no longer records the same edit twice. Written
     only at event time — by beginEdit/changeEdit and the consumers — never
     during render. */
  const editingRef = useRef<CellEditorState | null>(null);
  /* Created once. It mirrors the raw cells (both are updated on every edit) and
     owns the computed values, so an edit recomputes only the cells that depend
     on it rather than the whole sheet. */
  const [engine] = useState(() => new FormulaEngine());
  const [access, setAccess] = useState<WorkbookAccess>("owner");
  const [notice, setNotice] = useState<string | null>(null);
  /* The style store — created once, like the engine. Cells reference its ids;
     an edit that formats a cell interns a style here and points the cell at it,
     so identical formatting is shared rather than copied. */
  const [styleRegistry, setStyleRegistry] = useState(() => new StyleRegistry());
  /* The undo/redo stacks, and the clipboard. History is a ref — it is imperative
     state React never renders, kept in step with the engine as commands apply.
     The clipboard IS rendered (its outline), so it is state. */
  const historyRef = useRef<History>(null as unknown as History);
  if (historyRef.current === null) historyRef.current = new History();
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  /* The TSV last written to the system clipboard, so paste can tell an in-app
     round trip (use the internal block, keep formulas) from foreign data. */
  const lastTSVRef = useRef<string | null>(null);
  /* A monotonic counter for comment-entry ids, so two comments written in the
     same millisecond still differ. */
  const commentSeqRef = useRef(0);

  const worksheet = activeWorksheet(workbook);
  const activeSheetId = worksheet.id;
  const bounds: Bounds = { rows: worksheet.rowCount, cols: worksheet.colCount };
  const filled = (row: number, col: number) => isFilled(worksheet, row, col);
  const rawValue = (row: number, col: number) => getCellValue(worksheet, row, col);

  const sheetById = (wb: Workbook, id: string): Worksheet | undefined =>
    wb.worksheets.find((s) => s.id === id);

  /** Repopulate the engine from the WHOLE workbook — every populated cell of
      every sheet — and tell it the current sheet names, so cross-sheet
      references resolve. The cheapest correct move after a reshape or a
      workbook-level change. */
  function rebuildEngine(wb: Workbook): void {
    engine.clear();
    engine.syncSheets(sheetIdentities(wb));
    engine.setNamedRanges(engineNames(wb));
    for (const sheet of wb.worksheets) {
      for (const [ref, cell] of Object.entries(sheet.cells)) {
        const pos = parseCellRef(ref);
        if (pos) engine.setCell(sheet.id, pos.row, pos.col, cell.value);
      }
    }
  }

  /**
   * The one path every cell mutation takes: turn a set of intended edits into a
   * command on the ACTIVE sheet, mirror it into the engine, apply it, and record
   * it for undo. A command that changes nothing records nothing. This is what
   * gives edits, paste, cut, fill and clear their undo/redo for free.
   */
  /** A pending CUT is disarmed by any edit or reshape, as in Excel.
      Its source-clearing is a deferred destructive write aimed at coordinates
      captured at cut time; once anything else changes the sheet — a value typed
      into the cut range, a row inserted above it, another sheet made active —
      those coordinates point at data the user did not ask to move, and pasting
      would wipe it. A COPY stays live (it destroys nothing on paste). */
  function cancelPendingCut(): void {
    if (clipboard?.cut) setClipboard(null);
  }

  function applyEdits(label: string, edits: CellEdit[]): void {
    if (!allowEdits(edits)) return;
    const command = buildCommand(label, worksheet, edits);
    if (command.changes.length === 0) return;
    cancelPendingCut();
    for (const c of command.changes) engine.setCell(activeSheetId, c.row, c.col, c.after);
    setWorkbook((wb) => {
      const ws = sheetById(wb, command.sheetId);
      return ws ? withActiveWorksheet(wb, applyChanges(ws, command.changes)) : wb;
    });
    historyRef.current.record(command);
  }

  function commitCommand(command: Command): void {
    if (command.kind === "cells") {
      for (const c of command.changes) engine.setCell(command.sheetId, c.row, c.col, c.after);
      setWorkbook((wb) => {
        const ws = sheetById(wb, command.sheetId);
        const merged = ws ? withActiveWorksheet(wb, applyChanges(ws, command.changes)) : wb;
        return { ...merged, activeSheetId: command.sheetId };
      });
    } else if (command.kind === "workbookStructural") {
      const restored = command.sheets.reduce((wb, s) => withActiveWorksheet(wb, s.after), workbook);
      const next = { ...restored, activeSheetId: command.sheetId };
      rebuildEngine(next);
      setWorkbook(next);
    } else {
      const rebuilt = withActiveWorksheet(workbook, command.after);
      rebuildEngine(rebuilt);
      setWorkbook((wb) => ({
        ...withActiveWorksheet(wb, command.after),
        activeSheetId: command.sheetId,
      }));
    }
  }

  function undoCommand(command: Command): void {
    if (command.kind === "cells") {
      for (const c of command.changes) engine.setCell(command.sheetId, c.row, c.col, c.before);
      setWorkbook((wb) => {
        const ws = sheetById(wb, command.sheetId);
        const merged = ws ? withActiveWorksheet(wb, revertChanges(ws, command.changes)) : wb;
        return { ...merged, activeSheetId: command.sheetId };
      });
    } else if (command.kind === "workbookStructural") {
      const restored = command.sheets.reduce((wb, s) => withActiveWorksheet(wb, s.before), workbook);
      const next = { ...restored, activeSheetId: command.sheetId };
      rebuildEngine(next);
      setWorkbook(next);
    } else {
      const rebuilt = withActiveWorksheet(workbook, command.before);
      rebuildEngine(rebuilt);
      setWorkbook((wb) => ({
        ...withActiveWorksheet(wb, command.before),
        activeSheetId: command.sheetId,
      }));
    }
  }

  /** Apply a structural reshape of the active sheet as one undoable snapshot.
      `rebuild` repopulates the engine when the edit changed cells (insert/delete);
      resize, hide and freeze leave the values untouched and skip it. */
  function applyStructural(label: string, next: Worksheet, rebuild = true): void {
    if (next === worksheet) return;
    if (worksheet.protection?.sheet && access !== "owner") {
      setNotice(refusalMessage({ kind: "sheet" }));
      return;
    }
    cancelPendingCut();
    if (rebuild) rebuildEngine(withActiveWorksheet(workbook, next));
    setWorkbook((wb) => withActiveWorksheet(wb, next));
    historyRef.current.record(structuralCommand(label, worksheet, next));
  }

  /** Apply a structural reshape whose formula rewrites reach the WHOLE workbook
      — insert/delete of rows, columns or cell blocks also rewrites references
      to the edited sheet from every other sheet. One undoable command covers
      every sheet that changed. */
  function applyStructuralWorkbook(label: string, next: Workbook): void {
    if (next === workbook) return;
    if (worksheet.protection?.sheet && access !== "owner") {
      setNotice(refusalMessage({ kind: "sheet" }));
      return;
    }
    const command = workbookStructuralCommand(label, activeSheetId, workbook, next);
    if (command.sheets.length === 0) return;
    cancelPendingCut();
    rebuildEngine(next);
    setWorkbook(next);
    historyRef.current.record(command);
  }

  /** Swap one worksheet (matched by id) inside a workbook. */
  function withSheet(wb: Workbook, ws: Worksheet): Workbook {
    return { ...wb, worksheets: wb.worksheets.map((s) => (s.id === ws.id ? ws : s)) };
  }

  /** Apply a workbook-level change (add/delete/rename/… a sheet): re-sync the
      engine's sheet list and rebuild, since names and cells across sheets may
      have moved. Not part of the cell/structural undo history. */
  function applyWorkbook(next: Workbook): void {
    if (next === workbook) return;
    /* Includes switching sheets: a cut pasted on ANOTHER sheet would clear the
       source rectangle's coordinates on that sheet — someone else's data. */
    cancelPendingCut();
    rebuildEngine(next);
    setWorkbook(next);
    if (next.activeSheetId !== activeSheetId) {
      setSelection(cellSelection({ row: 0, col: 0 }));
      setEditing(null);
    }
  }

  /* Keep the engine's name→id map in step with the workbook's sheets, so a
     cross-sheet reference resolves from the very first formula. Sheet ops rebuild
     the engine themselves; this covers the initial mount. */
  useEffect(() => {
    engine.syncSheets(sheetIdentities(workbook));
    engine.setNamedRanges(engineNames(workbook));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --- Sheet operations -------------------------------------------------- */

  function createSheet(): void {
    applyWorkbook(createSheetOp(workbook).workbook);
  }
  function deleteSheet(id: string): void {
    applyWorkbook(deleteSheetOp(workbook, id));
  }
  function renameSheet(id: string, name: string): void {
    applyWorkbook(renameSheetOp(workbook, id, name));
  }
  function duplicateSheet(id: string): void {
    applyWorkbook(duplicateSheetOp(workbook, id).workbook);
  }
  function moveSheet(id: string, toVisibleIndex: number): void {
    /* The tab bar counts VISIBLE tabs, but the workbook array also holds hidden
       sheets. The target slot is where the visible sheet at that position sits
       in the full array — passing the visible index straight through made
       "Move right" swap with a hidden neighbour, which visibly does nothing. */
    const target = visibleSheets(workbook)[toVisibleIndex];
    if (!target) return;
    const fullIndex = workbook.worksheets.findIndex((s) => s.id === target.id);
    if (fullIndex < 0) return;
    applyWorkbook(moveSheetOp(workbook, id, fullIndex));
  }
  function hideSheet(id: string): void {
    applyWorkbook(setSheetHiddenOp(workbook, id, true));
  }
  function unhideSheet(id: string): void {
    applyWorkbook(setSheetHiddenOp(workbook, id, false));
  }
  function switchSheet(id: string): void {
    applyWorkbook(switchSheetOp(workbook, id));
  }

  /* --- Data features: sort, filter, validation, conditional format ------- */

  const displayAt = (row: number, col: number) => engine.display(activeSheetId, row, col).text;
  const numberAt = (row: number, col: number) => {
    const v = engine.getValue(activeSheetId, row, col);
    return typeof v === "number" ? v : null;
  };

  /* Rows a collapsed outline band hides. Computed plainly rather than memoised:
     it walks a handful of bands, and the React compiler cannot preserve a memo
     keyed on an optional field here. */
  const collapsedRowsMap = collapsedRows(worksheet.rowGroups);

  /* Rows the active sheet's filter hides — recomputed when the workbook changes
     (which is whenever a value that could affect the filter changes). */
  const filterHiddenRows = useMemo<Record<number, true>>(() => {
    const f = worksheet.filter;
    return f ? computeFilterHidden(f, displayAt, numberAt) : {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worksheet]);

  /* Per conditional-format rule, the duplicate-value set (only for that kind). */
  const cfDupSets = useMemo(
    () =>
      (worksheet.conditionalFormats ?? []).map((cf) =>
        cf.condition.type === "duplicateValues" ? duplicateValueSet(cf.range, displayAt) : null,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [worksheet],
  );

  /* Per visual rule (colour scale, data bar), the range's lowest and highest
     number — what each cell's colour or bar length is measured against. A
     range is read to 5,000 rows past its top, which bounds a whole-column
     rule to what a sheet here actually holds. */
  const cfRangeStats = useMemo(
    () =>
      (worksheet.conditionalFormats ?? []).map((cf) => {
        if (!isVisualCondition(cf.condition)) return null;
        const values: unknown[] = [];
        const bottom = Math.min(cf.range.bottom, cf.range.top + 5000);
        for (let r = cf.range.top; r <= bottom; r++) {
          for (let c = cf.range.left; c <= cf.range.right; c++) values.push(engine.getValue(activeSheetId, r, c));
        }
        return rangeNumbers(values);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [worksheet],
  );

  function paintAt(row: number, col: number): CellPaint | null {
    const cfs = worksheet.conditionalFormats;
    if (!cfs || cfs.length === 0) return null;
    let out: CellPaint | null = null;
    for (let i = 0; i < cfs.length; i++) {
      const cf = cfs[i];
      if (!isVisualCondition(cf.condition) || !rangeContains(cf.range, row, col)) continue;
      const stats = cfRangeStats[i];
      if (!stats) continue;
      const v = engine.getValue(activeSheetId, row, col);
      if (typeof v !== "number") continue;
      if (cf.condition.type === "colorScale") out = { ...(out ?? {}), background: colorScaleColor(v, stats, cf.condition) };
      else out = { ...(out ?? {}), bar: { fraction: dataBarFraction(v, stats), color: cf.condition.color } };
    }
    return out;
  }

  /**
   * The style a cell is DISPLAYED with: its own style, then each matching
   * conditional-format rule layered on top. The stored style is never changed —
   * this is computed for rendering only (requirement).
   */
  function effectiveStyle(row: number, col: number): CellStyle {
    let style = styleRegistry.get(getCellStyleId(worksheet, row, col));
    /* Bands sit under everything: a cell's own fill, then a rule's, win. */
    if (worksheet.banding && worksheet.banding.length && !style.background) {
      const band = bandColorAt(worksheet.banding, row, col);
      if (band) style = { ...style, background: band };
    }
    const cfs = worksheet.conditionalFormats;
    if (!cfs || cfs.length === 0) return style;
    let value: ScalarValue | null = null;
    let display = "";
    for (let i = 0; i < cfs.length; i++) {
      const cf = cfs[i];
      if (!rangeContains(cf.range, row, col)) continue;
      if (value === null) {
        value = engine.getValue(activeSheetId, row, col);
        display = engine.display(activeSheetId, row, col).text;
      }
      const isDuplicate = cfDupSets[i]?.has(display) ?? false;
      const evalCustom = () =>
        cf.condition.type === "customFormula"
          ? engine.evaluateAdHoc(
              activeSheetId,
              adjustFormula(cf.condition.formula, row - cf.range.top, col - cf.range.left),
            )
          : BLANK;
      if (conditionMatches(cf.condition, { value, display, isDuplicate, evalCustom })) {
        style = mergeStyle(style, styleRegistry.get(cf.styleId));
      }
    }
    return style;
  }

  const validationLookup = (row: number, col: number) =>
    validationAt(worksheet.validations, row, col);

  /** Whether a value is allowed in a cell, per any validation covering it. */
  function isEditAllowed(row: number, col: number, draft: string): boolean {
    const v = validationLookup(row, col);
    if (!v) return true;
    const interpret = (raw: string) => engine.evaluateAdHoc(activeSheetId, raw);
    const evalCustom = (formula: string) =>
      engine.evaluateAdHoc(activeSheetId, formula, [{ row, col, value: interpret(draft) }]);
    /* The other values in the rule's range, for `unique` — read lazily, since
       only that one kind asks for them. */
    const others = () => {
      const out: string[] = [];
      for (let r = v.range.top; r <= v.range.bottom; r++) {
        for (let c = v.range.left; c <= v.range.right; c++) {
          if (r === row && c === col) continue;
          out.push(getCellValue(worksheet, r, c));
        }
      }
      return out;
    };
    const ok = validateValue(v.rule, draft, interpret, evalCustom, {
      allowBlank: v.allowBlank ?? true,
      others,
    });
    /* A warning or information style REPORTS a broken rule without refusing the
       entry — only `stop` blocks it. */
    return ok || !rejectsInvalid(v);
  }

  function overlaps(a: Rect, b: Rect): boolean {
    return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
  }

  function sortSelection(direction: SortDirection, keyCol?: number): void {
    const range = selection.range;
    const col = keyCol ?? selection.active.col;
    const edits = sortRangeEdits(worksheet, range, col, direction, (r, c) =>
      engine.getValue(activeSheetId, r, c),
    );
    applyEdits("Sort", edits);
  }

  function toggleFilter(): void {
    if (worksheet.filter) {
      applyStructural("Remove filter", { ...worksheet, filter: undefined }, false);
    } else {
      const filter: SheetFilter = { range: selection.range, columns: {} };
      applyStructural("Create filter", { ...worksheet, filter }, false);
    }
  }

  function setColumnFilter(col: number, cf: ColumnFilter | null): void {
    const f = worksheet.filter;
    if (!f) return;
    const columns = { ...f.columns };
    if (!cf || (!cf.values && !cf.condition)) delete columns[col];
    else columns[col] = cf;
    applyStructural("Filter", { ...worksheet, filter: { ...f, columns } }, false);
  }

  function clearFilter(): void {
    const f = worksheet.filter;
    if (!f) return;
    applyStructural("Clear filter", { ...worksheet, filter: { ...f, columns: {} } }, false);
  }

  function setValidation(rule: ValidationRule, settings: ValidationSettings = {}): void {
    const validation: Validation = { range: selection.range, rule, ...settings };
    applyStructural(
      "Data validation",
      { ...worksheet, validations: [...(worksheet.validations ?? []), validation] },
      false,
    );
  }

  function clearValidation(): void {
    const remaining = (worksheet.validations ?? []).filter((v) => !overlaps(v.range, selection.range));
    applyStructural(
      "Clear validation",
      { ...worksheet, validations: remaining.length ? remaining : undefined },
      false,
    );
  }

  function addBanding(preset: BandPreset): void {
    const range = { ...selection.range };
    const band: Banding = {
      id: `band_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      range,
      header: preset.header,
      odd: preset.odd,
      even: preset.even,
    };
    const kept = (worksheet.banding ?? []).filter((b) => !rectsOverlap(b.range, range));
    applyStructural("Alternating colours", { ...worksheet, banding: [...kept, band] }, false);
  }

  function removeBanding(): void {
    const range = selection.range;
    const kept = (worksheet.banding ?? []).filter((b) => !rectsOverlap(b.range, range));
    if (kept.length === (worksheet.banding ?? []).length) return;
    applyStructural("Remove alternating colours", { ...worksheet, banding: kept.length ? kept : undefined }, false);
  }

  function addConditionalFormat(condition: CondCondition, styleId: number): void {
    const cf: ConditionalFormat = { range: selection.range, condition, styleId };
    applyStructural(
      "Conditional format",
      { ...worksheet, conditionalFormats: [...(worksheet.conditionalFormats ?? []), cf] },
      false,
    );
  }

  function clearConditionalFormats(): void {
    const remaining = (worksheet.conditionalFormats ?? []).filter(
      (cf) => !overlaps(cf.range, selection.range),
    );
    applyStructural(
      "Clear conditional format",
      { ...worksheet, conditionalFormats: remaining.length ? remaining : undefined },
      false,
    );
  }

  /** Toggle a checkbox-validated cell between TRUE and FALSE. */
  function toggleCheckbox(row: number, col: number): void {
    const cur = getCellValue(worksheet, row, col).trim().toUpperCase();
    applyEdits("Toggle", [{ row, col, raw: cur === "TRUE" ? "FALSE" : "TRUE" }]);
  }

  /** Set a cell's value directly (e.g. from a validation dropdown), honouring
      validation. */
  function commitValue(row: number, col: number, raw: string): void {
    if (isEditAllowed(row, col, raw)) applyEdits("Edit cell", [{ row, col, raw }]);
  }

  /* --- Advanced UI features (Phase 11): merge, link, comment, search ------ */

  const mergeLookup = (row: number, col: number) => mergeAt(worksheet.merges, row, col);
  const hasMergeInSelection = hasMergeIn(worksheet.merges, selection.range);

  /** Merge the selection. It clears the cells the merge swallows, so the engine
      is rebuilt from the reshaped sheet. */
  function mergeCells(kind: MergeKind): void {
    applyStructural("Merge cells", applyMerge(worksheet, selection.range, kind), true);
  }
  function unmergeCells(): void {
    applyStructural("Unmerge cells", removeMerge(worksheet, selection.range), false);
  }

  /** A cell's URL: an explicit link, else a bare-URL value auto-detected so a
      typed address is clickable without changing the data. */
  function linkLookup(row: number, col: number): string | undefined {
    const explicit = linkAt(worksheet.links, cellRef(row, col));
    if (explicit) return explicit;
    return detectUrl(getCellValue(worksheet, row, col)) ?? undefined;
  }

  /** Set or remove the active cell's explicit link. */
  function setCellLink(url: string | null): void {
    const ref = cellRef(selection.active.row, selection.active.col);
    /* Normalised HERE rather than trusting the caller.
       `LinkEditor` normalises before it calls this, so Ctrl+K was always safe —
       but the ribbon's Insert ▸ Link panel is a second caller, and passing its
       raw field through stored `example.com` as a RELATIVE href (which resolves
       inside the app) and skipped `normalizeUrl`'s refusal of `javascript:` and
       `data:`. A safety rule that every caller has to remember is a rule that
       gets forgotten; this is the one place every link goes through.
       Normalising an already-safe URL is a no-op, so the existing caller is
       unaffected. */
    const safe = url === null ? null : normalizeUrl(url);
    if (url !== null && safe === null) return;
    const links = setLink(worksheet.links, ref, safe);
    if (links === worksheet.links) return;
    applyStructural(url === null ? "Remove link" : "Set link", { ...worksheet, links }, false);
  }

  const commentLookup = (row: number, col: number) =>
    threadAt(worksheet.comments, cellRef(row, col));

  function nextCommentId(): string {
    commentSeqRef.current += 1;
    return `c${commentSeqRef.current}-${Date.now().toString(36)}`;
  }

  function addComment(row: number, col: number, body: string): void {
    const text = body.trim();
    if (!text) return;
    const entry = { id: nextCommentId(), author: COMMENT_AUTHOR, timestamp: Date.now(), body: text };
    const comments = addCommentOp(worksheet.comments, cellRef(row, col), entry);
    applyStructural("Add comment", { ...worksheet, comments }, false);
  }
  function editComment(row: number, col: number, entryId: string, body: string): void {
    const comments = editCommentOp(worksheet.comments, cellRef(row, col), entryId, body.trim());
    if (comments === worksheet.comments) return;
    applyStructural("Edit comment", { ...worksheet, comments }, false);
  }
  function removeComment(row: number, col: number, entryId: string): void {
    const comments = removeCommentOp(worksheet.comments, cellRef(row, col), entryId);
    if (comments === worksheet.comments) return;
    applyStructural("Delete comment", { ...worksheet, comments }, false);
  }
  function resolveComment(row: number, col: number, resolved: boolean): void {
    const comments = setResolvedOp(worksheet.comments, cellRef(row, col), resolved);
    if (comments === worksheet.comments) return;
    applyStructural(resolved ? "Resolve comment" : "Reopen comment", { ...worksheet, comments }, false);
  }

  function search(query: string, opts: SearchOptions): CellMatch[] {
    return findMatches(worksheet, query, opts, displayAt);
  }
  function replaceOne(
    row: number,
    col: number,
    query: string,
    replacement: string,
    opts: SearchOptions,
  ): boolean {
    const raw = getCellValue(worksheet, row, col);
    const next = replaceCellRaw(raw, displayAt(row, col), query, replacement, opts);
    if (next === null) return false;
    applyEdits("Replace", [{ row, col, raw: next }]);
    return true;
  }
  function replaceAll(query: string, replacement: string, opts: SearchOptions): number {
    const edits = replaceAllEdits(worksheet, query, replacement, opts, displayAt);
    if (edits.length === 0) return 0;
    applyEdits("Replace all", edits);
    return edits.length;
  }
  function revealCell(row: number, col: number): void {
    setEditing(null);
    setSelection(selectCell({ row, col }, bounds));
  }

  /** Paste only the values, or only the formatting, of the copied block. Acts on
      the in-app clipboard — a copy that carries both, of which this takes one. */
  function pasteSpecial(mode: "values" | "formats" | "transpose"): void {
    const source = clipboard;
    if (!source) return;
    /* Transposed: the block on its side, values and formatting together. */
    const clip = mode === "transpose" ? transposeClipboard(source) : source;
    const target: CellPos = { row: selection.range.top, col: selection.range.left };
    const edits: CellEdit[] =
      mode === "values"
        ? pasteEdits(clip, target, bounds, !clip.cut)
        : mode === "transpose"
          ? [...pasteEdits(clip, target, bounds, false), ...pasteStyles(clip, target, bounds)]
          : pasteStyles(clip, target, bounds);
    applyEdits(mode === "values" ? "Paste values" : mode === "transpose" ? "Paste transposed" : "Paste format", edits);
    const rect = pasteRect(clip, target, bounds);
    setSelection({
      anchor: { row: rect.top, col: rect.left },
      active: { row: rect.top, col: rect.left },
      range: rect,
    });
  }

/**
   * Remove duplicate ROWS within the selection, keeping the first occurrence.
   *
   * Rows are compared on the SELECTED COLUMNS only — the same rule Excel uses —
   * and on their displayed values, so two cells that show the same thing count
   * as equal however they were typed. Survivors are rewritten from the top of
   * the range and the tail is cleared, all as one undoable command.
   */
  /** Split the selection's first column across the columns to its right. */
  function textToColumns(delimiter: Delimiter): void {
    applyEdits(
      "Text to columns",
      textToColumnsEdits(worksheet, selection.range, delimiter, bounds.cols),
    );
  }

  /**
   * A SUM in a row INSERTED under each run of equal values in `groupCol`.
   * Excel assumes the data is SORTED by that column — a group is a run, not
   * every row sharing a value — and this follows the same rule, which is why
   * Subtotal is normally used straight after a sort.
   *
   * The rows are inserted bottom-up, so earlier insertions cannot move a group
   * not yet processed, and the whole reshape lands as ONE structural command:
   * no data row is overwritten, the SUM never includes its own cell (writing it
   * into the last data row did both — every group ended `#REF!` with its last
   * value destroyed), and a single undo removes every subtotal again. A group
   * whose subtotal row would fall off the fixed grid is skipped rather than
   * letting the insertion push data off the edge.
   */
  function insertSubtotals(groupCol: number, sumCol: number): number {
    const plan = subtotalPlan(selection.range, groupCol, displayAt);
    if (plan.length === 0) return 0;
    const letter = columnLabelFor(sumCol);
    let nextWb = workbook;
    let inserted = 0;
    for (let i = plan.length - 1; i >= 0; i--) {
      const g = plan[i];
      let ws = nextWb.worksheets.find((s) => s.id === activeSheetId);
      if (!ws || g.to + 1 >= ws.rowCount) continue;
      /* Workbook-level insertion, so references into this sheet from other
         sheets shift with the data like any other row insertion. */
      nextWb = insertRowsWorkbook(nextWb, activeSheetId, g.to + 1, 1);
      ws = nextWb.worksheets.find((s) => s.id === activeSheetId)!;
      /* On a single-column selection the label and the SUM share one cell —
         the SUM wins, so the figure is never lost. */
      if (groupCol !== sumCol) {
        ws = setCellValue(ws, g.to + 1, groupCol, `${g.label} total`);
      }
      ws = setCellValue(ws, g.to + 1, sumCol, `=SUM(${letter}${g.from + 1}:${letter}${g.to + 1})`);
      nextWb = withSheet(nextWb, ws);
      inserted++;
    }
    if (inserted === 0) return 0;
    applyStructuralWorkbook("Subtotal", nextWb);
    return inserted;
  }

  function groupRows(): void {
    const r = selection.range;
    applyStructural(
      "Group rows",
      { ...worksheet, rowGroups: addRowGroup(worksheet.rowGroups, r.top, r.bottom) },
      false,
    );
  }
  function ungroupRows(): void {
    const r = selection.range;
    applyStructural(
      "Ungroup rows",
      { ...worksheet, rowGroups: removeRowGroup(worksheet.rowGroups, r.top, r.bottom) },
      false,
    );
  }
  function setRowsCollapsed(collapsed: boolean): void {
    const r = selection.range;
    applyStructural(
      collapsed ? "Collapse rows" : "Expand rows",
      { ...worksheet, rowGroups: toggleRowGroup(worksheet.rowGroups, r.top, r.bottom, collapsed) },
      false,
    );
  }

  /* --- Notes ----------------------------------------------------------------- */

  const noteLookup = (row: number, col: number): string | undefined => worksheet.notes?.[cellRef(row, col)];

  function setNote(row: number, col: number, text: string): void {
    const ref = cellRef(row, col);
    const notes = { ...(worksheet.notes ?? {}) };
    const trimmed = text.trim();
    if (trimmed) notes[ref] = trimmed.slice(0, 2000);
    else delete notes[ref];
    const ws = { ...worksheet };
    if (Object.keys(notes).length) ws.notes = notes;
    else delete ws.notes;
    applyStructural(trimmed ? "Note" : "Remove note", ws, false);
  }

  /* --- Column outlines --------------------------------------------------------- */

  function groupCols(): void {
    const r = selection.range;
    applyStructural("Group columns", { ...worksheet, colGroups: addRowGroup(worksheet.colGroups, r.left, r.right) }, false);
  }
  function ungroupCols(): void {
    const r = selection.range;
    applyStructural("Ungroup columns", { ...worksheet, colGroups: removeRowGroup(worksheet.colGroups, r.left, r.right) }, false);
  }
  function setColsCollapsed(collapsed: boolean): void {
    const r = selection.range;
    applyStructural(
      collapsed ? "Collapse columns" : "Expand columns",
      { ...worksheet, colGroups: toggleRowGroup(worksheet.colGroups, r.left, r.right, collapsed) },
      false,
    );
  }
  const collapsedColsMap = collapsedCols(worksheet.colGroups);

  function insertImageCell(url: string): void {
    const safe = url.trim().replace(/"/g, "");
    commitValue(selection.active.row, selection.active.col, `=IMAGE("${safe}")`);
  }

  const [showProtected, setShowProtected] = useState(false);

  function removeDuplicates(): number {
    const rect = selection.range;
    const seen = new Set<string>();
    const keep: number[] = [];
    for (let r = rect.top; r <= rect.bottom; r++) {
      const key = [];
      for (let c = rect.left; c <= rect.right; c++) key.push(displayAt(r, c));
      /* Joined on a control character no typed cell value can contain — a
         printable separator (this was the literal string "0001") lets distinct
         rows collide and be deleted as "duplicates". */
      const k = key.join(String.fromCharCode(1));
      if (seen.has(k)) continue;
      seen.add(k);
      keep.push(r);
    }
    const removed = rect.bottom - rect.top + 1 - keep.length;
    if (removed === 0) return 0;

    const edits: CellEdit[] = [];
    keep.forEach((srcRow, i) => {
      const destRow = rect.top + i;
      if (destRow === srcRow) return;
      for (let c = rect.left; c <= rect.right; c++) {
        edits.push({ row: destRow, col: c, raw: getCellValue(worksheet, srcRow, c) });
        edits.push({ row: destRow, col: c, style: getCellStyleId(worksheet, srcRow, c) });
      }
    });
    /* Clear the rows the survivors no longer fill. */
    for (let r = rect.top + keep.length; r <= rect.bottom; r++) {
      for (let c = rect.left; c <= rect.right; c++) {
        edits.push({ row: r, col: c, raw: "" });
        edits.push({ row: r, col: c, style: 0 });
      }
    }
    applyEdits("Remove duplicates", edits);
    return removed;
  }

  /** Trim and collapse whitespace in the selection's text cells. Formulas
      and numbers are left alone: a leading space is the only thing a text
      cell can carry that a person cannot see, and it breaks lookups. */
  function trimWhitespace(): number {
    const rect = selection.range;
    const edits: CellEdit[] = [];
    for (let r = rect.top; r <= rect.bottom; r++) {
      for (let c = rect.left; c <= rect.right; c++) {
        const raw = getCellValue(worksheet, r, c);
        if (!raw || raw.startsWith("=")) continue;
        const next = raw.replace(/\s+/g, " ").trim();
        if (next !== raw) edits.push({ row: r, col: c, raw: next });
      }
    }
    if (edits.length) applyEdits("Trim whitespace", edits);
    return edits.length;
  }

  /** Reset every selected cell to the default style, keeping its value. */
  function clearFormatting(): void {
    const rect = selection.range;
    const edits: CellEdit[] = [];
    for (let r = rect.top; r <= rect.bottom; r++) {
      for (let c = rect.left; c <= rect.right; c++) edits.push({ row: r, col: c, style: 0 });
    }
    applyEdits("Clear formatting", edits);
  }

  /* --- Persistence bridge ------------------------------------------------ */

  /** The whole workbook as a serializable value — what a save sends. */
  /* --- Live collaboration ------------------------------------------------- */

  function applyRemote(
    next: Workbook,
    change: { cells: { sheetId: string; row: number; col: number; value: string }[]; structural: boolean; namesChanged: boolean },
  ): void {
    if (next === workbook) return;
    if (change.structural) {
      rebuildEngine(next);
    } else {
      for (const c of change.cells) engine.setCell(c.sheetId, c.row, c.col, c.value);
      if (change.namesChanged) engine.setNamedRanges(engineNames(next));
    }
    /* A colleague removing the sheet being looked at moves the view to the
       first remaining one; otherwise the view stays put. */
    const stillThere = next.worksheets.some((ws) => ws.id === activeSheetId);
    setWorkbook({ ...next, activeSheetId: stillThere ? activeSheetId : next.activeSheetId });
    if (!stillThere) {
      setSelection(cellSelection({ row: 0, col: 0 }));
      setEditing(null);
    }
  }

  /* --- Protection --------------------------------------------------------- */

  /** Whether every cell an edit touches may be changed by this person; when
      not, the refusal is shown and nothing is applied. */
  function allowEdits(edits: readonly CellEdit[]): boolean {
    const p = worksheet.protection;
    if (!p || access === "owner") return true;
    for (const e of edits) {
      const hit = protectionInRect(p, { top: e.row, left: e.col, bottom: e.row, right: e.col });
      if (hit) {
        setNotice(refusalMessage(hit));
        return false;
      }
    }
    return true;
  }

  function setProtection(label: string, next: SheetProtection | undefined): void {
    const ws = { ...worksheet };
    if (next) ws.protection = next;
    else delete ws.protection;
    /* Recorded as a structural change so it undoes; the owner is the only
       one who reaches here, so the gate above does not refuse it. */
    cancelPendingCut();
    setWorkbook((wb) => withActiveWorksheet(wb, ws));
    historyRef.current.record(structuralCommand(label, worksheet, ws));
  }

  function protectRange(note?: string, rect?: Rect): void {
    if (access !== "owner") {
      setNotice("Only the owner can protect cells.");
      return;
    }
    const id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setProtection("Protect range", protectRangeOp(worksheet.protection, id, rect ?? selection.range, note));
  }

  function unprotectRange(id: string): void {
    if (access !== "owner") {
      setNotice("Only the owner can remove protection.");
      return;
    }
    setProtection("Remove protection", unprotectRangeOp(worksheet.protection, id));
  }

  function protectSheet(on: boolean): void {
    if (access !== "owner") {
      setNotice("Only the owner can protect the sheet.");
      return;
    }
    setProtection(on ? "Protect sheet" : "Unprotect sheet", protectSheetOp(worksheet.protection, on));
  }

  const protectionLookup = (row: number, col: number) => protectionAt(worksheet.protection, row, col);
  const clearNotice = () => setNotice(null);

  /* --- Named ranges ------------------------------------------------------ */

  const names = workbook.names ?? [];

  function defineNamedRange(name: string, range?: Rect, sheetId?: string): string | null {
    const problem = nameProblem(name, names, name);
    if (problem) return problem;
    const next = defineName(names, {
      name,
      sheetId: sheetId ?? activeSheetId,
      range: range ?? selection.range,
    });
    const wb = { ...workbook, names: next };
    engine.setNamedRanges(engineNames(wb));
    setWorkbook(wb);
    return null;
  }

  function removeNamedRange(name: string): void {
    const next = removeName(names, name);
    const wb = { ...workbook, ...(next.length ? { names: next } : { names: undefined }) };
    if (!next.length) delete wb.names;
    engine.setNamedRanges(engineNames(wb));
    setWorkbook(wb);
  }

  function selectRect(rect: Rect, sheetId?: string): void {
    if (sheetId && sheetId !== activeSheetId) {
      const target = switchSheetOp(workbook, sheetId);
      if (target !== workbook) applyWorkbook(target);
    }
    const pos = { row: rect.top, col: rect.left };
    setSelection({ anchor: pos, active: pos, range: rect });
    setEditing(null);
  }

  const [showFormulas, setShowFormulas] = useState(false);
  const [showGridlines, setShowGridlines] = useState(true);
  const [zoom, setZoomState] = useState(1);
  const setZoom = (z: number) => setZoomState(clampZoom(z));

  /* --- Printing ------------------------------------------------------------- */

  const pageSetup: PageSetup = { ...DEFAULT_PAGE_SETUP, ...(worksheet.pageSetup ?? {}) };

  function setPageSetup(patch: Partial<PageSetup>): void {
    const next = { ...pageSetup, ...patch };
    applyStructural("Page setup", { ...worksheet, pageSetup: next }, false);
  }

  function setPrintArea(on: boolean): void {
    if (on) setPageSetup({ area: { ...selection.range } });
    else {
      const { area: _area, ...rest } = pageSetup;
      void _area;
      applyStructural("Clear print area", { ...worksheet, pageSetup: rest }, false);
    }
  }

  function printDocument(workbookTitle: string): string {
    const metrics = metricsOf(worksheet);
    const rect = pageSetup.area ?? usedRange(new Set([...Object.keys(worksheet.cells), ...Object.keys(worksheet.cellStyles)]), parseCellRef);
    return printHtml({
      sheetName: worksheet.name,
      workbookTitle,
      rect,
      cell: (r, c) => {
        const d = engine.display(activeSheetId, r, c);
        const style = effectiveStyle(r, c);
        const text = getCellValue(worksheet, r, c) === "" ? "" : formatValue(engine.getValue(activeSheetId, r, c), style.numberFormat);
        return { text, style, align: style.align ?? d.align };
      },
      colWidth: (c) => colWidthOf(metrics, c),
      rowHeight: (r) => rowHeightOf(metrics, r),
      merges: worksheet.merges,
      setup: pageSetup,
    });
  }

  /* --- Pivot tables --------------------------------------------------------- */

  const pivots = workbook.pivots ?? [];

  function sourceMatrix(sheetId: string, rect: Rect): SourceCell[][] {
    const rows: SourceCell[][] = [];
    for (let r = rect.top; r <= rect.bottom; r++) {
      const line: SourceCell[] = [];
      for (let c = rect.left; c <= rect.right; c++) {
        const v = engine.getValue(sheetId, r, c);
        line.push({ text: engine.display(sheetId, r, c).text, number: typeof v === "number" ? v : null });
      }
      rows.push(line);
    }
    return rows;
  }

  function pivotFieldsOfSelection(): string[] {
    return pivotFields(sourceMatrix(activeSheetId, selection.range));
  }

  /** The target sheet with the table's old footprint cleared and the new
      table written. */
  function writePivot(wb: Workbook, def: PivotDefinition, table: ReturnType<typeof buildPivot>, oldFootprint?: Rect): Workbook {
    const target = wb.worksheets.find((ws) => ws.id === def.target.sheetId);
    if (!target) return wb;
    const writes: CellWrite[] = [];
    if (oldFootprint) {
      for (let r = oldFootprint.top; r <= oldFootprint.bottom; r++)
        for (let c = oldFootprint.left; c <= oldFootprint.right; c++) writes.push({ row: r, col: c, value: "" });
    }
    for (const w of pivotWrites(table, def.target)) writes.push({ row: w.row, col: w.col, value: w.value });
    const next = applyCellWrites(target, writes);
    return { ...wb, worksheets: wb.worksheets.map((ws) => (ws.id === target.id ? next : ws)) };
  }

  function insertPivot(spec: PivotSpec): string | null {
    const rect = selection.range;
    if (rect.bottom - rect.top < 1) return "Select the records with their header row first.";
    const matrix = sourceMatrix(activeSheetId, rect);
    const width = rect.right - rect.left + 1;
    if (spec.rowField >= width || spec.valueField >= width || (spec.colField !== undefined && spec.colField >= width)) return "Choose fields from the selected columns.";
    const table = buildPivot(matrix, spec);
    const id = `pivot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const base = createWorksheet("pivot", "Pivot");
    const added = addSheetOp(workbook, base, `Pivot ${pivots.length + 1}`);
    const def: PivotDefinition = {
      id,
      source: { sheetId: activeSheetId, rect: { ...rect } },
      spec,
      target: { sheetId: added.sheetId, row: 0, col: 0 },
    };
    const withTable = writePivot(added.workbook, def, table);
    const next: Workbook = { ...withTable, pivots: [...pivots, def], activeSheetId: added.sheetId };
    applyWorkbook(next);
    return null;
  }

  function refreshPivots(): number {
    if (pivots.length === 0) return 0;
    let wb: Workbook = workbook;
    let count = 0;
    for (const def of pivots) {
      if (!wb.worksheets.some((ws) => ws.id === def.source.sheetId) || !wb.worksheets.some((ws) => ws.id === def.target.sheetId)) continue;
      const table = buildPivot(sourceMatrix(def.source.sheetId, def.source.rect), def.spec);
      /* The previous table's extent is unknown after edits; clear a generous
         box — the target sheet exists for the table, so it holds nothing else. */
      const old = pivotFootprint(table, def.target);
      const clear: Rect = { top: old.top, left: old.left, bottom: old.top + 500, right: old.left + 60 };
      wb = writePivot(wb, def, table, clear);
      count++;
    }
    if (wb !== workbook) applyWorkbook(wb);
    return count;
  }

  function removePivot(id: string): void {
    const next = pivots.filter((p) => p.id !== id);
    const wb = { ...workbook };
    if (next.length) wb.pivots = next;
    else delete wb.pivots;
    setWorkbook(wb);
  }

  /* --- Charts --------------------------------------------------------------- */

  const charts = worksheet.charts ?? [];
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);

  function selectChart(id: string | null): void {
    setSelectedChartId(id);
    if (id) {
      /* Selecting brings it to the front, as in every drawing program. */
      const next = raiseChart(charts, id);
      if (next.some((c, i) => c !== charts[i])) {
        setWorkbook((wb) => withActiveWorksheet(wb, { ...worksheet, charts: next }));
      }
    }
  }

  function insertChart(type: ChartType): string | null {
    const rect = selection.range;
    if (rect.top === rect.bottom && rect.left === rect.right) return null;
    const id = `chart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const spec = newChart(id, type, rect, charts, "Chart");
    applyStructural("Insert chart", { ...worksheet, charts: addChartOp(charts, spec) }, false);
    setSelectedChartId(id);
    return id;
  }

  function updateChart(id: string, patch: Partial<ChartSpec>): void {
    applyStructural("Change chart", { ...worksheet, charts: updateChartOp(charts, id, patch) }, false);
  }

  function removeChart(id: string): void {
    const next = removeChartOp(charts, id);
    const ws = { ...worksheet };
    if (next.length) ws.charts = next;
    else delete ws.charts;
    applyStructural("Remove chart", ws, false);
    if (selectedChartId === id) setSelectedChartId(null);
  }

  function chartData(spec: ChartSpec): ChartModel {
    return chartModel(
      spec.rect,
      (r, c) => {
        const v = engine.getValue(activeSheetId, r, c);
        return { text: engine.display(activeSheetId, r, c).text, number: typeof v === "number" ? v : null };
      },
      spec.orientation ?? "cols",
    );
  }

  function serialize(): SerializedWorkbook {
    return serializeWorkbook(workbook, styleRegistry);
  }

  /** Replace the live state with a loaded workbook: new registry, rebuilt
      engine, fresh selection and history. The undo stack does not survive a
      reload — it is per session, not per document. */
  function hydrate(data: SerializedWorkbook): void {
    const { workbook: nextWb, styleRegistry: nextReg } = deserializeWorkbook(data);
    rebuildEngine(nextWb);
    setStyleRegistry(nextReg);
    setWorkbook(nextWb);
    setSelection(cellSelection({ row: 0, col: 0 }));
    setEditing(null);
    setClipboard(null);
    historyRef.current = new History();
  }

  /* --- Import / export --------------------------------------------------- */

  /** The active sheet as CSV — displayed (computed, plain-number) values. */
  function exportCsv(): string {
    return worksheetToCsv(worksheet, displayAt);
  }

  /** Add a new sheet built from CSV text and switch to it. Parsing is total, so
      even a malformed file yields a sheet rather than an error. */
  function importCsv(name: string, text: string): void {
    const ws = csvToWorksheet("import", name || "Imported", text);
    applyWorkbook(addSheetOp(workbook, ws, name || "Imported").workbook);
  }

  function exportJson(): string {
    return exportWorkbookJson(serialize());
  }

  /** Replace the workbook from a JSON file, or return the validation error. */
  function importJson(text: string): { ok: boolean; error?: string } {
    const result = importWorkbookJson(text);
    if (!result.ok) return { ok: false, error: result.error };
    hydrate(result.workbook);
    return { ok: true };
  }

  /** SheetJS is loaded on demand so the ~1 MB library never enters the common
      bundle — only a workbook that is actually imported/exported pays for it. */
  async function exportXlsx(): Promise<ArrayBuffer> {
    const { workbookToXlsx } = await import("@/lib/spreadsheet/xlsxio");
    return workbookToXlsx(workbook, styleRegistry);
  }

  async function importXlsx(
    bytes: ArrayBuffer | Uint8Array,
  ): Promise<{ ok: boolean; error?: string }> {
    const { xlsxToWorkbook } = await import("@/lib/spreadsheet/xlsxio");
    const result = xlsxToWorkbook(bytes);
    if (!result.ok) return { ok: false, error: result.error };
    hydrate(result.workbook);
    return { ok: true };
  }

  function clickCell(pos: CellPos, shiftKey: boolean): void {
    setEditing(null);
    setSelection((prev) =>
      shiftKey ? extendTo(prev, pos, bounds) : selectCell(pos, bounds),
    );
  }

  function dragTo(pos: CellPos): void {
    setSelection((prev) => extendTo(prev, pos, bounds));
  }

  function move(dir: Direction, opts: MoveOptions = {}): void {
    setEditing(null);
    setSelection((prev) => {
      if (opts.toEdge && opts.extend) return extendToEdge(prev, dir, filled, bounds);
      if (opts.toEdge) return moveToEdge(prev, dir, filled, bounds);
      if (opts.extend) return extendActive(prev, dir, bounds);
      return moveActive(prev, dir, bounds);
    });
  }

  /** Page Up / Page Down — jump by a screenful, the standard spreadsheet step.
      `rows` is what the viewport can show, which only the grid knows. */
  function movePage(dir: "up" | "down", rows: number, extend: boolean): void {
    setEditing(null);
    const delta = dir === "up" ? -Math.max(1, rows) : Math.max(1, rows);
    setSelection((prev) => {
      const row = Math.max(0, Math.min(bounds.rows - 1, prev.active.row + delta));
      const target: CellPos = { row, col: prev.active.col };
      return extend ? extendTo(prev, target, bounds) : selectCell(target, bounds);
    });
  }

  function pressHome(ctrl: boolean): void {
    setEditing(null);
    setSelection((prev) => (ctrl ? moveDocumentStart() : moveHome(prev)));
  }

  function pressEnd(ctrl: boolean): void {
    setEditing(null);
    setSelection((prev) =>
      ctrl ? moveDocumentEnd(filled, bounds) : moveEnd(prev, filled, bounds),
    );
  }

  function selectAll(): void {
    setEditing(null);
    setSelection((prev) => selectAllStep(prev, filled, bounds));
  }

  function selectColumn(col: number, shiftKey: boolean): void {
    setEditing(null);
    setSelection((prev) => {
      const anchorCol = shiftKey ? prev.anchor.col : col;
      return {
        anchor: { row: 0, col: anchorCol },
        active: { row: 0, col },
        range: {
          top: 0,
          bottom: bounds.rows - 1,
          left: Math.min(anchorCol, col),
          right: Math.max(anchorCol, col),
        },
      };
    });
  }

  function selectRow(row: number, shiftKey: boolean): void {
    setEditing(null);
    setSelection((prev) => {
      const anchorRow = shiftKey ? prev.anchor.row : row;
      return {
        anchor: { row: anchorRow, col: 0 },
        active: { row, col: 0 },
        range: {
          left: 0,
          right: bounds.cols - 1,
          top: Math.min(anchorRow, row),
          bottom: Math.max(anchorRow, row),
        },
      };
    });
  }

  function beginEdit(opts?: BeginEditOptions): void {
    if (!mayEdit(worksheet.protection, access, { top: selection.active.row, left: selection.active.col, bottom: selection.active.row, right: selection.active.col })) {
      const hit = protectionAt(worksheet.protection, selection.active.row, selection.active.col);
      if (hit) setNotice(refusalMessage(hit));
      return;
    }
    const { active } = selection;
    const next = startEdit(active, rawValue(active.row, active.col), opts);
    editingRef.current = next;
    setEditing(next);
  }

  function changeEdit(value: string): void {
    /* Composes on the MIRROR, which beginEdit has already set within this very
       event — so the formula bar's first keystroke lands on the edit its focus
       just began, without waiting for a render. Begins a bar-sourced edit if
       somehow none is open. */
    const base = editingRef.current ?? editing;
    const next = base
      ? editDraft(base, value)
      : startEdit(selection.active, rawValue(selection.active.row, selection.active.col), {
          initial: value,
          source: "bar",
        });
    editingRef.current = next;
    setEditing(next);
  }

  function commitEdit(thenMove?: Direction): void {
    /* Consume the edit through the mirror, not the render closure: the editor's
       blur fires a second commit inside the same event as Enter/Escape, and the
       closure would still see the edit as open (double record; Escape-then-
       commit). The first consumer nulls the mirror; the second finds nothing. */
    const current = editingRef.current;
    editingRef.current = null;
    if (current) {
      const { pos, draft } = current;
      /* Data validation rejects a disallowed value — the cell keeps what it had
         (Phase 10). Dropdown/checkbox cells can only enter valid values anyway. */
      if (isEditAllowed(pos.row, pos.col, draft)) {
        /* One edit is one command, so a single keystroke's worth of change is one
           undo step. The engine mirror and history record happen in applyEdits. */
        applyEdits("Edit cell", [{ row: pos.row, col: pos.col, raw: draft }]);
      }
    }
    setEditing(null);
    if (thenMove) setSelection((prev) => moveActive(prev, thenMove, bounds));
  }

  function cancelEdit(): void {
    editingRef.current = null;
    setEditing(null);
  }

  function clearSelection(): void {
    const rect = selection.range;
    const edits: CellEdit[] = [];
    for (let r = rect.top; r <= rect.bottom; r++) {
      for (let c = rect.left; c <= rect.right; c++) edits.push({ row: r, col: c, raw: "" });
    }
    applyEdits("Clear", edits);
  }

  /* --- Clipboard --------------------------------------------------------- */

  function writeSystemClipboard(rect: Rect): void {
    const tsv = toTSV(worksheet, engine, activeSheetId, rect);
    lastTSVRef.current = tsv;
    /* The browser clipboard is best-effort: a blocked or unavailable API leaves
       the internal clipboard as the source of truth, so in-app copy/paste keeps
       working (requirement 14). */
    try {
      void navigator.clipboard?.writeText(tsv).catch(() => {});
    } catch {
      /* No clipboard API at all — internal clipboard still holds the block. */
    }
  }

  /** Escape's dismissal of the dashed border, as in Excel: the pending block —
      copy or cut — is forgotten. A paste afterwards falls back to the system
      clipboard's plain values; a disarmed cut clears nothing. */
  function clearClipboard(): void {
    setClipboard(null);
  }

  function copy(): void {
    const rect = selection.range;
    setClipboard(copyRange(worksheet, rect, false));
    writeSystemClipboard(rect);
  }

  function cut(): void {
    const rect = selection.range;
    setClipboard(copyRange(worksheet, rect, true));
    writeSystemClipboard(rect);
  }

  function pasteBlock(clip: Clipboard, external: boolean): void {
    const target: CellPos = { row: selection.range.top, col: selection.range.left };
    /* Copies re-base their relative formulas onto the paste site; cuts and
       foreign data move verbatim. */
    const adjust = !clip.cut && !external;
    const edits: CellEdit[] = [];
    if (clip.cut) {
      /* Empty the source (value and style) before the block overlays it. */
      edits.push(...clearSourceEdits(clip), ...clearSourceStyles(clip));
    }
    edits.push(...pasteEdits(clip, target, bounds, adjust));
    /* Formatting travels with the block (Phase 5): the source styles land on the
       destination, replacing whatever was there. */
    edits.push(...pasteStyles(clip, target, bounds));
    applyEdits(clip.cut ? "Cut" : "Paste", edits);

    const rect = pasteRect(clip, target, bounds);
    setSelection({
      anchor: { row: rect.top, col: rect.left },
      active: { row: rect.top, col: rect.left },
      range: rect,
    });
    if (clip.cut) {
      /* A cut is consumed by its paste. */
      setClipboard(null);
      lastTSVRef.current = null;
    }
  }

  function paste(): void {
    let text: string | null = null;
    const finish = () => {
      /* Prefer the internal block when the system clipboard still holds what we
         wrote (an in-app round trip keeps formulas); otherwise parse whatever is
         there as tab-separated values. */
      if (text !== null && text !== "" && text !== lastTSVRef.current) {
        pasteBlock(fromTSV(text), true);
      } else if (clipboard) {
        pasteBlock(clipboard, false);
      } else if (text !== null && text !== "") {
        pasteBlock(fromTSV(text), true);
      }
    };
    try {
      const read = navigator.clipboard?.readText();
      if (read && typeof read.then === "function") {
        read.then(
          (t) => {
            text = t;
            finish();
          },
          () => finish(), // blocked/denied → fall back to the internal block
        );
        return;
      }
    } catch {
      /* No clipboard API — fall through to the internal block. */
    }
    finish();
  }

  /* --- Undo / redo ------------------------------------------------------- */

  function undo(): void {
    editingRef.current = null;
    setEditing(null);
    cancelPendingCut();
    const command = historyRef.current.undo();
    if (command) undoCommand(command);
  }

  function redo(): void {
    editingRef.current = null;
    setEditing(null);
    cancelPendingCut();
    const command = historyRef.current.redo();
    if (command) commitCommand(command);
  }

  /* --- Fill handle ------------------------------------------------------- */

  function fillPreviewRect(target: CellPos): Rect {
    return fillDestRect(selection.range, target, bounds);
  }

  function fillTo(target: CellPos): void {
    setEditing(null);
    const source = selection.range;
    const { dest, edits, styleEdits } = computeFill(worksheet, source, target, bounds);
    if (edits.length > 0 || styleEdits.length > 0) {
      applyEdits("Fill", [...edits, ...styleEdits]);
    }
    setSelection({
      anchor: { row: dest.top, col: dest.left },
      active: { row: dest.top, col: dest.left },
      range: dest,
    });
  }

  /* --- Formatting -------------------------------------------------------- */

  /** The resolved style of one cell (the empty style when unformatted). */
  const styleIdAt = (row: number, col: number) => getCellStyleId(worksheet, row, col);
  const styleAt = (row: number, col: number) => styleRegistry.get(styleIdAt(row, col));

  /** Every cell position in the current selection. */
  function selectedCells(): CellPos[] {
    const rect = selection.range;
    const out: CellPos[] = [];
    for (let r = rect.top; r <= rect.bottom; r++) {
      for (let c = rect.left; c <= rect.right; c++) out.push({ row: r, col: c });
    }
    return out;
  }

  function applyFormat(patch: Partial<CellStyle>): void {
    const edits: CellEdit[] = selectedCells().map(({ row, col }) => {
      const merged = mergeStyle(styleAt(row, col), patch);
      return { row, col, style: styleRegistry.intern(merged) };
    });
    applyEdits("Format", edits);
  }

  function toggleMark(mark: Mark): void {
    /* Turn the mark ON unless every cell in the selection already carries it, in
       which case turn it OFF — the standard toolbar toggle. */
    const cells = selectedCells();
    const allSet = cells.every(({ row, col }) => styleAt(row, col)[mark] === true);
    applyFormat({ [mark]: !allSet } as Partial<CellStyle>);
  }

  function applyBorders(preset: BorderPreset, border: Border | null): void {
    /* Each cell's affected edges are set to the border (or cleared for a null
       border / the "none" preset), leaving its other edges as they were. */
    const plan = borderEdgesForPreset(selection.range, preset);
    const edits: CellEdit[] = plan.map(({ row, col, edges }) => {
      const current = styleAt(row, col);
      const borders: Borders = { ...current.borders };
      for (const edge of edges) {
        if (border && preset !== "none") borders[edge] = border;
        else delete borders[edge];
      }
      const merged = mergeStyle(current, { borders });
      return { row, col, style: styleRegistry.intern(merged) };
    });
    applyEdits("Borders", edits);
  }

  /* --- Rows and columns -------------------------------------------------- */

  const rowSpan = () => ({
    at: selection.range.top,
    end: selection.range.bottom,
    count: selection.range.bottom - selection.range.top + 1,
  });
  const colSpan = () => ({
    at: selection.range.left,
    end: selection.range.right,
    count: selection.range.right - selection.range.left + 1,
  });

  function insertRows(where: "above" | "below"): void {
    const { at, end, count } = rowSpan();
    applyStructuralWorkbook(
      "Insert rows",
      insertRowsWorkbook(workbook, activeSheetId, where === "above" ? at : end + 1, count),
    );
  }
  function deleteRows(): void {
    const { at, count } = rowSpan();
    applyStructuralWorkbook("Delete rows", deleteRowsWorkbook(workbook, activeSheetId, at, count));
  }
  function hideRows(): void {
    const { at, end } = rowSpan();
    applyStructural("Hide rows", setRowsHidden(worksheet, at, end, true), false);
  }
  function unhideRows(): void {
    const { at, end } = rowSpan();
    applyStructural("Unhide rows", setRowsHidden(worksheet, at, end, false), false);
  }
  function resizeRow(row: number, height: number): void {
    applyStructural("Resize row", setRowHeight(worksheet, row, height), false);
  }
  function autoFitRow(row: number): void {
    /* Single-line cells auto-fit to the default height; wrapping is a display
       concern the fixed row height already clips. */
    applyStructural("Auto-fit row", setRowHeight(worksheet, row, worksheet.defaultRowHeight), false);
  }

  function insertCols(where: "left" | "right"): void {
    const { at, end, count } = colSpan();
    applyStructuralWorkbook(
      "Insert columns",
      insertColsWorkbook(workbook, activeSheetId, where === "left" ? at : end + 1, count),
    );
  }
  function deleteCols(): void {
    const { at, count } = colSpan();
    applyStructuralWorkbook("Delete columns", deleteColsWorkbook(workbook, activeSheetId, at, count));
  }
  function hideCols(): void {
    const { at, end } = colSpan();
    applyStructural("Hide columns", setColsHidden(worksheet, at, end, true), false);
  }
  function unhideCols(): void {
    const { at, end } = colSpan();
    applyStructural("Unhide columns", setColsHidden(worksheet, at, end, false), false);
  }
  function resizeCol(col: number, width: number): void {
    applyStructural("Resize column", setColWidth(worksheet, col, width), false);
  }
  function autoFitCol(col: number, width: number): void {
    applyStructural("Auto-fit column", setColWidth(worksheet, col, width), false);
  }

  function insertCells(direction: "down" | "right"): void {
    applyStructuralWorkbook(
      "Insert cells",
      shiftCellsWorkbook(workbook, activeSheetId, selection.range, direction),
    );
  }
  function deleteCells(direction: "up" | "left"): void {
    applyStructuralWorkbook(
      "Delete cells",
      shiftCellsWorkbook(workbook, activeSheetId, selection.range, direction),
    );
  }

  /**
   * Would this template land cleanly at the active cell?
   *
   * Split out from `insertTable` so the menu can warn BEFORE the click. Both go
   * through the same two checks, so what the menu says and what the action does
   * cannot disagree.
   */
  function tableFits(templateId: string): { ok: boolean; blocked?: "occupied" | "no-room" } {
    const template = templateById(templateId);
    if (!template) return { ok: false, blocked: "no-room" };
    const at = selection.active;
    if (!fitsOnSheet(worksheet, template, at)) return { ok: false, blocked: "no-room" };
    const footprint = tableFootprint(template, at);
    /* A merged region under the block counts as occupied even when its cells
       are empty — a table body rendered through someone's merge is garbled,
       and the menu must grey out for the same reason the build refuses. */
    if (!regionIsEmpty(worksheet, footprint) || regionHasMerge(worksheet, footprint))
      return { ok: false, blocked: "occupied" };
    return { ok: true };
  }

  function insertTable(templateId: string): { ok: boolean; blocked?: "occupied" | "no-room" } {
    const verdict = tableFits(templateId);
    if (!verdict.ok) return verdict;
    const template = templateById(templateId)!;
    /* One snapshot command: values, styles, widths, validations, the filter and
       the freeze all land together, so one Ctrl+Z takes the whole table back
       out. Building it as seven separate edits would need seven undos, and a
       half-undone table is a worse state than either end. */
    applyStructural(
      `Insert ${template.name.toLowerCase()}`,
      buildTable(worksheet, styleRegistry, template, selection.active),
    );
    return { ok: true };
  }

  function insertFunction(name: string): void {
    beginEdit({ initial: `=${name}(` });
  }

  function appendToCell(text: string): void {
    if (editing) {
      changeEdit(editing.draft + text);
      return;
    }
    const { active } = selection;
    commitValue(active.row, active.col, rawValue(active.row, active.col) + text);
  }

  function freezeRows(n: number): void {
    if (worksheet.frozenRows === n) return; // a no-op freeze is not an undo step
    applyStructural(n > 0 ? "Freeze rows" : "Unfreeze rows", freezeRowsOp(worksheet, n), false);
  }
  function freezeCols(n: number): void {
    if (worksheet.frozenCols === n) return;
    applyStructural(n > 0 ? "Freeze columns" : "Unfreeze columns", freezeColsOp(worksheet, n), false);
  }
  /** Clear both freeze axes as ONE command. Calling freezeRows(0) and
      freezeCols(0) from one click builds two worksheets from the same stale
      snapshot — the second write resurrects what the first cleared, which is
      why View ▸ Unfreeze never actually unfroze rows. */
  function unfreeze(): void {
    if (worksheet.frozenRows === 0 && worksheet.frozenCols === 0) return;
    applyStructural("Unfreeze", freezeColsOp(freezeRowsOp(worksheet, 0), 0), false);
  }
  /** Resize a run of rows as ONE command — Format ▸ Row height over a
      multi-row selection used to loop per row from the same stale snapshot,
      so only the last row's height survived. */
  function resizeRows(from: number, to: number, height: number): void {
    let next = worksheet;
    for (let r = from; r <= to; r++) next = setRowHeight(next, r, height);
    applyStructural("Resize rows", next, false);
  }
  function resizeCols(from: number, to: number, width: number): void {
    let next = worksheet;
    for (let c = from; c <= to; c++) next = setColWidth(next, c, width);
    applyStructural("Resize columns", next, false);
  }

  const activeStyle = styleAt(selection.active.row, selection.active.col);
  const sheets = visibleSheets(workbook).map((s) => ({ id: s.id, name: s.name }));
  const hiddenSheets = workbook.worksheets
    .filter((s) => s.hidden)
    .map((s) => ({ id: s.id, name: s.name }));

  return {
    worksheet,
    workbook,
    selection,
    editing,
    bounds,
    rawValue,
    engine,
    styleRegistry,
    activeStyle,
    clipboard,
    clearClipboard,
    activeSheetId,
    sheets,
    hiddenSheets,
    createSheet,
    deleteSheet,
    renameSheet,
    duplicateSheet,
    moveSheet,
    hideSheet,
    unhideSheet,
    switchSheet,
    serialize,
    hydrate,
    effectiveStyle,
    filterHiddenRows,
    displayAt,
    validationLookup,
    sortSelection,
    toggleFilter,
    setColumnFilter,
    clearFilter,
    setValidation,
    clearValidation,
    addConditionalFormat,
    clearConditionalFormats,
    toggleCheckbox,
    commitValue,
    mergeLookup,
    hasMergeInSelection,
    mergeCells,
    unmergeCells,
    linkLookup,
    setCellLink,
    commentLookup,
    addComment,
    editComment,
    removeComment,
    resolveComment,
    search,
    replaceOne,
    replaceAll,
    revealCell,
    selectRect,
    names,
    defineNamedRange,
    removeNamedRange,
    showFormulas,
    setShowFormulas,
    showGridlines,
    setShowGridlines,
    zoom,
    setZoom,
    noteLookup,
    setNote,
    groupCols,
    ungroupCols,
    setColsCollapsed,
    collapsedColsMap,
    insertImageCell,
    showProtected,
    setShowProtected,
    applyRemote,
    access,
    setAccess,
    protection: worksheet.protection,
    protectRange,
    unprotectRange,
    protectSheet,
    protectionLookup,
    notice,
    clearNotice,
    pageSetup,
    setPageSetup,
    setPrintArea,
    printDocument,
    pivots,
    pivotFieldsOfSelection,
    insertPivot,
    refreshPivots,
    removePivot,
    charts,
    selectedChartId,
    selectChart,
    insertChart,
    updateChart,
    removeChart,
    chartData,
    pasteSpecial,
    clearFormatting,
    removeDuplicates,
    trimWhitespace,
    paintAt,
    bands: worksheet.banding ?? [],
    addBanding,
    removeBanding,
    textToColumns,
    insertSubtotals,
    groupRows,
    ungroupRows,
    setRowsCollapsed,
    collapsedRowsMap,
    exportCsv,
    importCsv,
    exportJson,
    importJson,
    exportXlsx,
    importXlsx,
    clickCell,
    dragTo,
    move,
    movePage,
    pressHome,
    pressEnd,
    selectAll,
    selectColumn,
    selectRow,
    beginEdit,
    insertFunction,
    appendToCell,
    changeEdit,
    commitEdit,
    cancelEdit,
    clearSelection,
    copy,
    cut,
    paste,
    undo,
    redo,
    fillPreviewRect,
    fillTo,
    applyFormat,
    toggleMark,
    applyBorders,
    insertRows,
    deleteRows,
    hideRows,
    unhideRows,
    resizeRow,
    resizeRows,
    autoFitRow,
    insertCols,
    deleteCols,
    insertCells,
    deleteCells,
    insertTable,
    tableFits,
    hideCols,
    unhideCols,
    resizeCol,
    resizeCols,
    autoFitCol,
    freezeRows,
    freezeCols,
    unfreeze,
  };
}
