/**
 * The seam between the spreadsheet's UI surfaces and its state.
 *
 * The grid is one large component that owns every mutation (`setCell`,
 * `toggleStyle`, `fill`, `insertChart`…). As the spreadsheet grows more Excel-like
 * — a right-click menu, a conditional-formatting panel, a chart panel, header
 * menus — each of those surfaces needs to read *what is selected* and issue *a
 * change* without reaching into the grid's 1,800-line render.
 *
 * So the grid exposes exactly two things to the outside: an immutable
 * {@link SelectionState} snapshot, and a `dispatch(command)` function. A command
 * is a plain data description of an intent ("fill down", "apply this style"),
 * never a closure — which keeps every surface decoupled from *how* the grid
 * carries it out, and keeps this contract testable on its own. The dispatch
 * implementation lives in the grid and simply routes each command to the handler
 * that already existed; it adds no new behaviour, it just gives the handlers a
 * single, stable front door.
 */

import type {
  CellStyle,
  ChartType,
  ConditionalRule,
  Rect,
  SheetData,
} from "@/lib/rules/sheets/grid";

/** A read-only snapshot of what is selected, handed to menus and panels. */
export interface SelectionState {
  /** The focus cell, e.g. `"B4"`. */
  active: string;
  /** The other corner of a selection, or null for a single cell. */
  anchor: string | null;
  /** The normalised selected rectangle, or null before the sheet loads. */
  rect: Rect | null;
  /** The cell currently being edited, if any. */
  editing: string | null;
  /** Whether the viewer may change anything. */
  readOnly: boolean;
  /** True when the selection spans more than one cell. */
  hasRange: boolean;
}

/**
 * Everything a UI surface can ask the grid to do.
 *
 * A discriminated union rather than a bag of callbacks: a menu can enumerate the
 * commands it offers, decide which to disable from the selection, and hand each
 * back untouched — and new phases add a variant here without threading another
 * prop through every surface.
 */
export type SheetCommand =
  | { type: "undo" }
  | { type: "redo" }
  | { type: "copy" }
  | { type: "cut" }
  | { type: "paste" }
  | { type: "clearContents" }
  | { type: "clearFormats" }
  | { type: "fillDown" }
  | { type: "fillRight" }
  | { type: "style"; patch: Partial<CellStyle> }
  | { type: "insertChart"; chartType: ChartType }
  | { type: "selectRange"; range: string }
  | { type: "beginEdit"; ref: string; seed?: string }
  /**
   * The five commands below exist for the AI assistant's Sheets tools —
   * `writeCells`/`structuralEdit`/`setHiddenRows`/`createChart` (explicit
   * range)/`applyConditionalFormat` (explicit rule). Nothing about them is
   * AI-specific: they are ordinary spreadsheet operations a menu could issue
   * too, expressed as data the same way every other command is. See
   * `components/features/workspace/ai/SheetsAssistant.tsx` for the one
   * caller today.
   */
  | { type: "writeCells"; cells: { ref: string; value: string }[] }
  /** A structural edit (insert/delete rows or columns, a sort) as its fully-computed result — see `lib/rules/sheets/grid.ts`'s insertRows/deleteRows/insertColumns/deleteColumns/sortRange. */
  | { type: "structuralEdit"; next: SheetData }
  | { type: "setHiddenRows"; hidden: number[] }
  | { type: "createChart"; range: string; chartType: ChartType; title: string }
  | { type: "applyConditionalFormat"; rule: Omit<ConditionalRule, "id"> };

/** The grid's front door: turn an intent into the change that carries it out. */
export type SheetDispatch = (command: SheetCommand) => void;
