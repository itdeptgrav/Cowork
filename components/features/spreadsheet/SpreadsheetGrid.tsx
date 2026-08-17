"use client";

/**
 * The virtualized grid.
 *
 * It renders only the cells the viewport can see (plus a small buffer), so a
 * 1000×100 sheet is a few hundred nodes, never 100,000. The header strips are
 * translated imperatively to match the one scrolling body, so they never lag it.
 *
 * Phase 6 adds structure to this: frozen rows/columns are OVERLAYS pinned over
 * the body (they show the same cells the body scrolls beneath them, so they stay
 * put while everything else moves); header edges carry resize handles; and a
 * right-click on a header opens a context menu of row/column actions. All of it
 * sits on top of the same single-scroll virtualization — the frozen bands render
 * their own small windows, so nothing here materialises the whole sheet.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  ReactNode,
} from "react";
import {
  cellRef,
  columnLabel,
  isSingleCell,
  rectContains,
  type CellPos,
  type Rect,
} from "@/lib/spreadsheet/coordinates";
import {
  colAtX,
  colWidth,
  colX,
  rowAtY,
  rowHeight,
  rowY,
  totalHeight,
  totalWidth,
  visibleCols,
  visibleRows,
  type Window as GridWindow,
  HEADER_HEIGHT,
  ROW_HEADER_WIDTH,
} from "@/lib/spreadsheet/metrics";
import { getCellStyleId, metricsOf } from "@/lib/spreadsheet/model";
import { formatValue } from "@/lib/spreadsheet/format";
import { columnValues } from "@/lib/spreadsheet/filter";
import { GridBody } from "./GridBody";
import { HeaderContextMenu, type MenuItem } from "./HeaderContextMenu";
import { CellContextMenu, type CellMenuItem } from "./CellContextMenu";
import { FilterMenu } from "./FilterMenu";
import { SearchReplaceBar } from "./SearchReplaceBar";
import { LinkEditor } from "./LinkEditor";
import { CommentPopover } from "./CommentPopover";
import { FormulaHelper } from "./FormulaHelper";
import { formulaAssist } from "@/lib/spreadsheet/formula/assist";
import type { FunctionHelp } from "@/lib/spreadsheet/formula/catalog";
import type { SpreadsheetController } from "./useSpreadsheet";

const SURFACE = "var(--surface-raised)";
const HAIRLINE = "var(--color-hairline)";
const MIN_COL_WIDTH = 24;
const MIN_ROW_HEIGHT = 16;

/** A shared canvas for measuring text when auto-fitting a column. */
let measureCanvas: HTMLCanvasElement | null = null;
function measureContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  return measureCanvas.getContext("2d");
}

type ResizeState = {
  kind: "col" | "row";
  index: number;
  startClient: number;
  startSize: number;
  size: number;
  /** Screen geometry of the guide line, captured at drag start so the render
      never has to read a ref: `base` is the resized edge's fixed offset, and the
      guide moves to `base + size`. `crossStart`/`crossLength` span the body. */
  base: number;
  crossStart: number;
  crossLength: number;
} | null;

type MenuState = { x: number; y: number; kind: "row" | "col" } | null;

export function SpreadsheetGrid({
  controller,
  containerRef,
  searchOpen,
  onSearchOpen,
}: {
  controller: SpreadsheetController;
  containerRef: RefObject<HTMLDivElement | null>;
  /** The find/replace bar, owned by the parent so the ribbon can open it too. */
  searchOpen: false | "find" | "replace";
  onSearchOpen: (v: false | "find" | "replace") => void;
}) {
  const { worksheet, selection, editing } = controller;
  /* The geometry hides both manually-hidden rows and rows a filter hides. */
  const metrics = useMemo(() => {
    const base = metricsOf(worksheet);
    /* Three things can hide a row: hiding it by hand, a filter, and a collapsed
       outline band. They all land in one map, so the geometry has a single
       notion of "hidden" rather than three. */
    const filtered = controller.filterHiddenRows;
    const collapsed = controller.collapsedRowsMap;
    if (Object.keys(filtered).length === 0 && Object.keys(collapsed).length === 0) return base;
    return { ...base, hiddenRows: { ...base.hiddenRows, ...filtered, ...collapsed } };
  }, [worksheet, controller.filterHiddenRows, controller.collapsedRowsMap]);
  const frozenRows = worksheet.frozenRows;
  const frozenCols = worksheet.frozenCols;
  const frozenH = rowY(metrics, frozenRows);
  const frozenW = colX(metrics, frozenCols);

  const bodyRef = useRef<HTMLDivElement>(null);
  const colStripRef = useRef<HTMLDivElement>(null);
  const rowStripRef = useRef<HTMLDivElement>(null);
  const frozenRowBandRef = useRef<HTMLDivElement>(null);
  const frozenColBandRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const fillingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const [fillPreview, setFillPreview] = useState<Rect | null>(null);
  const [resize, setResize] = useState<ResizeState>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [dropdown, setDropdown] = useState<{ row: number; col: number; x: number; y: number } | null>(null);
  const [filterMenu, setFilterMenu] = useState<{ col: number; x: number; y: number } | null>(null);
  const [cellMenu, setCellMenu] = useState<{ x: number; y: number } | null>(null);
  const [linkEditor, setLinkEditor] = useState<{ row: number; col: number; x: number; y: number } | null>(null);
  const [commentAt, setCommentAt] = useState<{ row: number; col: number; x: number; y: number } | null>(null);

  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scroll, setScroll] = useState({ top: 0, left: 0 });

  /* Formula helper: the caret inside the cell editor, which suggestion is
     highlighted, whether Escape has dismissed it, and a caret to restore after
     inserting a chosen function. */
  const [caret, setCaret] = useState(0);
  const [helperActive, setHelperActive] = useState(0);
  const [helperClosed, setHelperClosed] = useState(false);
  const pendingCaretRef = useRef<number | null>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewport({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowWindow = useMemo(
    () => visibleRows(metrics, scroll.top, viewport.height),
    [metrics, scroll.top, viewport.height],
  );
  const colWindow = useMemo(
    () => visibleCols(metrics, scroll.left, viewport.width),
    [metrics, scroll.left, viewport.width],
  );

  /**
   * Put the header strips where the body currently is.
   *
   * The strips are moved imperatively rather than through state because a scroll
   * must not wait on a React render. The cost of that is a second source of
   * truth, and it can drift: anything that changes `scrollLeft`/`scrollTop`
   * WITHOUT going through the scroll handler leaves the strips translated to a
   * position the body no longer holds, and the column labels stop sitting over
   * their columns. So this is written as one function, called from the scroll
   * handler AND after every commit, which makes drift unrepresentable.
   */
  const syncStrips = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (colStripRef.current)
      colStripRef.current.style.transform = `translateX(${-el.scrollLeft}px)`;
    if (rowStripRef.current)
      rowStripRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
    if (frozenRowBandRef.current)
      frozenRowBandRef.current.style.transform = `translateX(${-el.scrollLeft}px)`;
    if (frozenColBandRef.current)
      frozenColBandRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
  }, []);

  const onBodyScroll = useCallback(() => {
    syncStrips();
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const e = bodyRef.current;
        if (e) setScroll({ top: e.scrollTop, left: e.scrollLeft });
      });
    }
  }, [syncStrips]);

  /* Re-align the strips after every commit — four style writes, and the only
     thing that guarantees a resize (or any other layout change) cannot leave the
     headers offset from the cells. */
  useEffect(() => {
    syncStrips();
  });

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /* Bring the active cell into view — offset so it never hides beneath a frozen
     band. A cell inside the frozen region is always visible, so skip it.

     Only when the ACTIVE CELL MOVED. `metrics` is a dependency because the maths
     reads it, but a metrics change on its own — resizing a column, hiding a row,
     freezing a pane — must not scroll anywhere: in every spreadsheet, dragging a
     column edge leaves the view exactly where it was. Without this guard a
     resize scrolled the viewport back to the active cell. */
  const active = selection.active;
  const lastActiveRef = useRef({ row: -1, col: -1 });
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const moved =
      lastActiveRef.current.row !== active.row || lastActiveRef.current.col !== active.col;
    lastActiveRef.current = { row: active.row, col: active.col };
    if (!moved) return;
    const x = colX(metrics, active.col);
    const w = colWidth(metrics, active.col);
    const y = rowY(metrics, active.row);
    const h = rowHeight(metrics, active.row);
    if (active.col >= frozenCols) {
      if (x < el.scrollLeft + frozenW) el.scrollLeft = x - frozenW;
      else if (x + w > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w - el.clientWidth;
    }
    if (active.row >= frozenRows) {
      if (y < el.scrollTop + frozenH) el.scrollTop = y - frozenH;
      else if (y + h > el.scrollTop + el.clientHeight) el.scrollTop = y + h - el.clientHeight;
    }
  }, [active.row, active.col, metrics, frozenRows, frozenCols, frozenH, frozenW]);

  const cellEditKey =
    editing && editing.source === "cell" ? `${editing.pos.row}:${editing.pos.col}` : null;
  useEffect(() => {
    if (!cellEditKey) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
    setCaret(len);
    setHelperClosed(false);
  }, [cellEditKey]);

  /* What to offer for the current draft + caret: a function suggestion list, a
     signature for the call being filled, or nothing. Only for the in-cell
     editor — the formula bar keeps its own plain field. */
  const assist = useMemo(
    () =>
      editing && editing.source === "cell"
        ? formulaAssist(editing.draft, caret)
        : null,
    [editing, caret],
  );
  /* The highlight resets to the top whenever the draft changes (see the editor's
     onChange) — arrow keys, which don't change the draft, leave it put. */
  /* Restore the caret after a suggestion rewrites the draft (a controlled input
     resets it to the end otherwise). */
  const cellDraft = editing?.source === "cell" ? editing.draft : null;
  useEffect(() => {
    const c = pendingCaretRef.current;
    if (c == null) return;
    pendingCaretRef.current = null;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(c, c);
  }, [cellDraft]);

  /* The cell under a pointer, in body content coordinates. */
  function cellAtEvent(e: { clientX: number; clientY: number }): CellPos {
    const el = bodyRef.current;
    if (!el) return { row: 0, col: 0 };
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft;
    const y = e.clientY - rect.top + el.scrollTop;
    return { row: rowAtY(metrics, y), col: colAtX(metrics, x) };
  }

  function focusGrid() {
    containerRef.current?.focus();
  }

  /** Open a validation dropdown just below its cell. */
  function openDropdown(row: number, col: number) {
    const el = bodyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDropdown({
      row,
      col,
      x: rect.left + colX(metrics, col) - el.scrollLeft,
      y: rect.top + rowY(metrics, row) + rowHeight(metrics, row) - el.scrollTop,
    });
  }

  /** Open a column's filter menu below its header cell. */
  function openFilter(col: number, row: number) {
    const el = bodyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setFilterMenu({
      col,
      x: rect.left + colX(metrics, col) - el.scrollLeft,
      y: rect.top + rowY(metrics, row) + rowHeight(metrics, row) - el.scrollTop,
    });
  }

  /** The screen point just below a cell — where a popover anchored to it opens. */
  function cellAnchorXY(row: number, col: number): { x: number; y: number } {
    const el = bodyRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + colX(metrics, col) - el.scrollLeft,
      y: rect.top + rowY(metrics, row) + rowHeight(metrics, row) - el.scrollTop,
    };
  }
  function openComment(row: number, col: number) {
    setCellMenu(null);
    setCommentAt({ row, col, ...cellAnchorXY(row, col) });
  }

  /** Snap a cell to the anchor of the merge covering it, so selecting or editing
      a merged region always targets the cell that holds its value. */
  function snapToMerge(pos: CellPos): CellPos {
    const m = controller.mergeLookup(pos.row, pos.col);
    return m ? { row: m.top, col: m.left } : pos;
  }

  function onBodyPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    focusGrid();
    controller.clickCell(snapToMerge(cellAtEvent(e)), e.shiftKey);
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  /** Right-click a cell: select it (unless already inside the selection), then
      open the cell menu at the cursor. */
  function openCellMenu(e: ReactMouseEvent) {
    e.preventDefault();
    focusGrid();
    const pos = cellAtEvent(e);
    if (!rectContains(selection.range, pos.row, pos.col)) {
      controller.clickCell(snapToMerge(pos), false);
    }
    setCellMenu({ x: e.clientX, y: e.clientY });
  }
  function onBodyPointerMove(e: ReactPointerEvent) {
    if (!draggingRef.current) return;
    controller.dragTo(cellAtEvent(e));
  }
  function onBodyPointerUp(e: ReactPointerEvent) {
    draggingRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* Capture was already released. */
    }
  }

  function onFillPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    focusGrid();
    fillingRef.current = true;
    setFillPreview(selection.range);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onFillPointerMove(e: ReactPointerEvent) {
    if (!fillingRef.current) return;
    setFillPreview(controller.fillPreviewRect(cellAtEvent(e)));
  }
  function onFillPointerUp(e: ReactPointerEvent) {
    if (!fillingRef.current) return;
    fillingRef.current = false;
    const target = cellAtEvent(e);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* Capture was already released. */
    }
    setFillPreview(null);
    controller.fillTo(target);
  }

  /* --- Resize (drag a header edge; double-click auto-fits) --------------- */

  function beginResize(kind: "col" | "row", index: number, e: ReactPointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    const el = bodyRef.current;
    const rect = el?.getBoundingClientRect();
    const startSize = kind === "col" ? colWidth(metrics, index) : rowHeight(metrics, index);
    const base =
      kind === "col"
        ? (rect?.left ?? 0) - (el?.scrollLeft ?? 0) + colX(metrics, index)
        : (rect?.top ?? 0) - (el?.scrollTop ?? 0) + rowY(metrics, index);
    setResize({
      kind,
      index,
      startClient: kind === "col" ? e.clientX : e.clientY,
      startSize,
      size: startSize,
      base,
      crossStart: kind === "col" ? (rect?.top ?? 0) : (rect?.left ?? 0),
      crossLength: kind === "col" ? (rect?.height ?? 0) : (rect?.width ?? 0),
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onResizeMove(e: ReactPointerEvent) {
    if (!resize) return;
    const delta = (resize.kind === "col" ? e.clientX : e.clientY) - resize.startClient;
    const min = resize.kind === "col" ? MIN_COL_WIDTH : MIN_ROW_HEIGHT;
    setResize({ ...resize, size: Math.max(min, resize.startSize + delta) });
  }
  function endResize(e: ReactPointerEvent) {
    if (!resize) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (resize.kind === "col") controller.resizeCol(resize.index, resize.size);
    else controller.resizeRow(resize.index, resize.size);
    setResize(null);
  }

  /** The natural width of a column: its widest populated cell, plus padding. */
  function autoFitColumn(col: number) {
    const ctx = measureContext();
    let widest = MIN_COL_WIDTH;
    if (ctx) {
      for (const ref of Object.keys(worksheet.cells)) {
        const m = /^([A-Z]+)(\d+)$/.exec(ref);
        if (!m) continue;
        const c = m[1].split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
        if (c !== col) continue;
        const r = Number(m[2]) - 1;
        const style = controller.styleRegistry.get(getCellStyleId(worksheet, r, c));
        const text = formatValue(
          controller.engine.getValue(controller.activeSheetId, r, c),
          style.numberFormat,
        );
        if (!text) continue;
        ctx.font = `${style.bold ? "bold " : ""}${style.fontSize ?? 13}px ${style.fontFamily ?? "sans-serif"}`;
        widest = Math.max(widest, ctx.measureText(text).width);
      }
    }
    controller.autoFitCol(col, Math.min(400, Math.round(widest) + 16));
  }

  /* --- Context menu ------------------------------------------------------ */

  function openRowMenu(e: ReactMouseEvent, row: number) {
    e.preventDefault();
    focusGrid();
    if (!(row >= selection.range.top && row <= selection.range.bottom)) {
      controller.selectRow(row, false);
    }
    setMenu({ x: e.clientX, y: e.clientY, kind: "row" });
  }
  function openColMenu(e: ReactMouseEvent, col: number) {
    e.preventDefault();
    focusGrid();
    if (!(col >= selection.range.left && col <= selection.range.right)) {
      controller.selectColumn(col, false);
    }
    setMenu({ x: e.clientX, y: e.clientY, kind: "col" });
  }

  const menuItems = (): MenuItem[] => {
    if (!menu) return [];
    if (menu.kind === "row") {
      const n = selection.range.bottom - selection.range.top + 1;
      const plural = n > 1 ? `${n} rows` : "row";
      return [
        { label: "Insert row above", onClick: () => controller.insertRows("above") },
        { label: "Insert row below", onClick: () => controller.insertRows("below") },
        { label: `Delete ${plural}`, onClick: () => controller.deleteRows() },
        {},
        { label: `Hide ${plural}`, onClick: () => controller.hideRows() },
        { label: "Unhide rows", onClick: () => controller.unhideRows() },
        { label: "Auto-fit row height", onClick: () => controller.autoFitRow(selection.active.row) },
        {},
        {
          label: `Freeze up to row ${selection.range.bottom + 1}`,
          onClick: () => controller.freezeRows(selection.range.bottom + 1),
        },
        { label: "Unfreeze rows", onClick: () => controller.freezeRows(0), disabled: frozenRows === 0 },
      ];
    }
    const n = selection.range.right - selection.range.left + 1;
    const plural = n > 1 ? `${n} columns` : "column";
    return [
      { label: "Insert column left", onClick: () => controller.insertCols("left") },
      { label: "Insert column right", onClick: () => controller.insertCols("right") },
      { label: `Delete ${plural}`, onClick: () => controller.deleteCols() },
      {},
      { label: `Hide ${plural}`, onClick: () => controller.hideCols() },
      { label: "Unhide columns", onClick: () => controller.unhideCols() },
      { label: "Auto-fit column width", onClick: () => autoFitColumn(selection.active.col) },
      {},
      {
        label: `Freeze up to column ${columnLabel(selection.range.right)}`,
        onClick: () => controller.freezeCols(selection.range.right + 1),
      },
      { label: "Unfreeze columns", onClick: () => controller.freezeCols(0), disabled: frozenCols === 0 },
    ];
  };

  /* Every leaf here runs a real controller action — no decorative entries. The
     link and comment popovers open at the menu's own position. */
  const cellMenuItems = (): CellMenuItem[] => {
    const active = selection.active;
    const at = cellMenu ?? { x: 0, y: 0 };
    const hasClip = !!controller.clipboard;
    const link = controller.linkLookup(active.row, active.col);
    const hasComment = !!controller.commentLookup(active.row, active.col);
    const items: CellMenuItem[] = [
      { label: "Cut", onClick: () => controller.cut() },
      { label: "Copy", onClick: () => controller.copy() },
      { label: "Paste", onClick: () => controller.paste() },
      {
        label: "Paste special",
        submenu: [
          { label: "Values only", onClick: () => controller.pasteSpecial("values"), disabled: !hasClip },
          { label: "Formatting only", onClick: () => controller.pasteSpecial("formats"), disabled: !hasClip },
        ],
      },
      {},
      {
        label: "Insert",
        submenu: [
          { label: "Row above", onClick: () => controller.insertRows("above") },
          { label: "Row below", onClick: () => controller.insertRows("below") },
          { label: "Column left", onClick: () => controller.insertCols("left") },
          { label: "Column right", onClick: () => controller.insertCols("right") },
        ],
      },
      {
        label: "Delete",
        submenu: [
          { label: "Rows", onClick: () => controller.deleteRows() },
          { label: "Columns", onClick: () => controller.deleteCols() },
        ],
      },
      { label: "Clear contents", onClick: () => controller.clearSelection() },
      {},
      {
        label: "Format",
        submenu: [
          { label: "Bold", onClick: () => controller.toggleMark("bold") },
          { label: "Italic", onClick: () => controller.toggleMark("italic") },
          { label: "Underline", onClick: () => controller.toggleMark("underline") },
          { label: "Strikethrough", onClick: () => controller.toggleMark("strikethrough") },
          {},
          { label: "Clear formatting", onClick: () => controller.clearFormatting() },
        ],
      },
      {
        label: "Merge",
        submenu: [
          { label: "Merge all", onClick: () => controller.mergeCells("all") },
          { label: "Merge horizontally", onClick: () => controller.mergeCells("horizontal") },
          { label: "Merge vertically", onClick: () => controller.mergeCells("vertical") },
          { label: "Unmerge", onClick: () => controller.unmergeCells(), disabled: !controller.hasMergeInSelection },
        ],
      },
      {},
      {
        label: "Sort",
        submenu: [
          { label: "Sort ascending", onClick: () => controller.sortSelection("asc") },
          { label: "Sort descending", onClick: () => controller.sortSelection("desc") },
        ],
      },
      {
        label: worksheet.filter ? "Remove filter" : "Create filter",
        onClick: () => controller.toggleFilter(),
      },
      {},
      {
        label: link ? "Edit link" : "Insert link",
        onClick: () => setLinkEditor({ row: active.row, col: active.col, x: at.x, y: at.y }),
      },
    ];
    if (link) items.push({ label: "Remove link", onClick: () => controller.setCellLink(null) });
    items.push({
      label: hasComment ? "Edit comment" : "Insert comment",
      onClick: () => setCommentAt({ row: active.row, col: active.col, x: at.x, y: at.y }),
    });
    return items;
  };

  /* --- Keyboard ---------------------------------------------------------- */

  /**
   * A key the grid has dealt with. Stopping propagation is the point: the app
   * shell listens on `window` for its own shortcuts (Ctrl/Cmd+K opens the global
   * command palette) and only excludes `<input>`/`<textarea>`/contentEditable —
   * and the grid is a focusable `div`, so without this a spreadsheet keystroke
   * also fires the surrounding application's. Every branch below routes through
   * here so that stays true as keys are added.
   */
  function claim(e: ReactKeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
  }

  /** How many rows a screenful is, for Page Up / Page Down. */
  function pageRows(): number {
    const h = bodyRef.current?.clientHeight ?? 0;
    return Math.max(1, Math.floor(h / Math.max(1, worksheet.defaultRowHeight)) - 1);
  }

  function onGridKeyDown(e: ReactKeyboardEvent) {
    if (editing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    switch (e.key) {
      case "PageUp":
        claim(e);
        controller.movePage("up", pageRows(), e.shiftKey);
        return;
      case "PageDown":
        claim(e);
        controller.movePage("down", pageRows(), e.shiftKey);
        return;
      case "Escape":
        /* Close whatever is open, the way Escape behaves everywhere else. */
        if (cellMenu || dropdown || filterMenu || linkEditor || commentAt || searchOpen) {
          claim(e);
          setCellMenu(null);
          setDropdown(null);
          setFilterMenu(null);
          setLinkEditor(null);
          setCommentAt(null);
          onSearchOpen(false);
        }
        return;
      case "ArrowUp":
        claim(e);
        controller.move("up", { extend: e.shiftKey, toEdge: ctrl });
        return;
      case "ArrowDown":
        claim(e);
        controller.move("down", { extend: e.shiftKey, toEdge: ctrl });
        return;
      case "ArrowLeft":
        claim(e);
        controller.move("left", { extend: e.shiftKey, toEdge: ctrl });
        return;
      case "ArrowRight":
        claim(e);
        controller.move("right", { extend: e.shiftKey, toEdge: ctrl });
        return;
      case "Tab":
        claim(e);
        controller.move(e.shiftKey ? "left" : "right");
        return;
      case "Enter":
        claim(e);
        controller.beginEdit({ source: "cell" });
        return;
      case "Home":
        claim(e);
        controller.pressHome(ctrl);
        return;
      case "End":
        claim(e);
        controller.pressEnd(ctrl);
        return;
      case "Delete":
      case "Backspace":
        claim(e);
        controller.clearSelection();
        return;
      case "F2":
        claim(e);
        controller.beginEdit();
        return;
      case "F11":
        /* Shift+F11 adds a sheet, as in Sheets and Excel. Plain F11 is the
           browser's full-screen and stays the browser's. */
        if (!e.shiftKey) return;
        claim(e);
        controller.createSheet();
        return;
      default:
        if (ctrl) {
          const key = e.key.toLowerCase();
          switch (key) {
            case "a":
              claim(e);
              controller.selectAll();
              return;
            case "c":
              claim(e);
              controller.copy();
              return;
            case "x":
              claim(e);
              controller.cut();
              return;
            case "v":
              claim(e);
              controller.paste();
              return;
            case "f":
              claim(e);
              onSearchOpen("find");
              return;
            case "h":
              /* Find AND replace — the bar opens with replace already shown. */
              claim(e);
              onSearchOpen("replace");
              return;
            case "k": {
              /* Insert link, as in Sheets. Claiming it also keeps Ctrl+K from
                 reaching the app shell's global command palette. */
              claim(e);
              const a = selection.active;
              setLinkEditor({ row: a.row, col: a.col, ...cellAnchorXY(a.row, a.col) });
              return;
            }
            case "m": {
              /* Ctrl+Alt+M — comment on the active cell, as in Sheets. Plain
                 Ctrl+M is not ours, so it falls through untouched. */
              if (!e.altKey) return;
              claim(e);
              const a = selection.active;
              setCommentAt({ row: a.row, col: a.col, ...cellAnchorXY(a.row, a.col) });
              return;
            }
            case "s":
              /* Autosave already runs; this makes the browser's own Save dialog
                 not appear, which is what a spreadsheet does with Ctrl+S. */
              claim(e);
              return;
            case "z":
              claim(e);
              if (e.shiftKey) controller.redo();
              else controller.undo();
              return;
            case "y":
              claim(e);
              controller.redo();
              return;
            case "b":
              claim(e);
              controller.toggleMark("bold");
              return;
            case "i":
              claim(e);
              controller.toggleMark("italic");
              return;
            case "u":
              claim(e);
              controller.toggleMark("underline");
              return;
            default:
              return;
          }
        }
        if (e.key.length === 1 && !e.altKey) {
          claim(e);
          controller.beginEdit({ initial: e.key, source: "cell" });
        }
    }
  }

  /** Insert a chosen function as `NAME(`, replacing the prefix being typed and
      leaving the caret inside the parens so the signature shows next. */
  function acceptSuggestion(help: FunctionHelp) {
    if (!editing || editing.source !== "cell" || assist?.kind !== "list") return;
    const draft = editing.draft;
    const insert = `${help.name}(`;
    const next = draft.slice(0, assist.tokenStart) + insert + draft.slice(caret);
    const nextCaret = assist.tokenStart + insert.length;
    controller.changeEdit(next);
    pendingCaretRef.current = nextCaret;
    setCaret(nextCaret);
    setHelperActive(0);
    setHelperClosed(false);
  }

  /** Keystrokes the helper claims before the editor's own commit/cancel keys:
      arrows move the highlight, Enter/Tab accept a suggestion, Escape dismisses
      the popover (a second Escape then cancels the edit as usual). */
  function onEditorKey(e: ReactKeyboardEvent) {
    const showing = assist && !helperClosed;
    if (showing && assist.kind === "list") {
      const n = assist.matches.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHelperActive((h) => (h + 1) % n);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHelperActive((h) => (h - 1 + n) % n);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        acceptSuggestion(assist.matches[Math.min(helperActive, n - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setHelperClosed(true);
        return;
      }
    } else if (showing && assist.kind === "signature" && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setHelperClosed(true);
      return;
    }
    onEditorKeyDown(e);
  }

  function onEditorKeyDown(e: ReactKeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      controller.commitEdit(e.shiftKey ? "up" : "down");
      focusGrid();
    } else if (e.key === "Tab") {
      e.preventDefault();
      controller.commitEdit(e.shiftKey ? "left" : "right");
      focusGrid();
    } else if (e.key === "Escape") {
      e.preventDefault();
      controller.cancelEdit();
      focusGrid();
    }
  }

  /* --- Header strips ----------------------------------------------------- */

  /* Column and row headers, built with inline for-loops in the render body so
     the handlers' ref access is seen as event-time. Frozen headers are the same
     cell, pinned (a higher z so they sit over the scrolling ones). */
  const colHeaders = [];
  const frozenColHeaders = [];
  for (let c = 0; c <= colWindow.end; c++) {
    const pinned = c < frozenCols;
    if (!pinned && c < colWindow.start) continue;
    const selected = c >= selection.range.left && c <= selection.range.right;
    const node = (
      <div
        key={c}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          containerRef.current?.focus();
          controller.selectColumn(c, e.shiftKey);
        }}
        onContextMenu={(e) => openColMenu(e, c)}
        title={`Column ${columnLabel(c)}`}
        className={`absolute flex cursor-pointer items-center justify-center border-r border-b text-[11px] transition-colors select-none hover:text-ink ${
          selected ? "font-medium text-ink" : "text-ink-muted"
        }`}
        style={{
          left: colX(metrics, c),
          top: 0,
          width: colWidth(metrics, c),
          height: HEADER_HEIGHT,
          borderColor: HAIRLINE,
          backgroundColor: selected ? "color-mix(in srgb, var(--ink) 8%, transparent)" : SURFACE,
          zIndex: pinned ? 2 : undefined,
        }}
      >
        {columnLabel(c)}
        <div
          onPointerDown={(e) => beginResize("col", c, e)}
          onPointerMove={onResizeMove}
          onPointerUp={endResize}
          onDoubleClick={(e) => {
            e.stopPropagation();
            autoFitColumn(c);
          }}
          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize"
          style={{ transform: "translateX(50%)" }}
        />
      </div>
    );
    if (pinned) frozenColHeaders.push(node);
    else colHeaders.push(node);
  }

  const rowHeaders = [];
  const frozenRowHeaders = [];
  for (let r = 0; r <= rowWindow.end; r++) {
    const pinned = r < frozenRows;
    if (!pinned && r < rowWindow.start) continue;
    const selected = r >= selection.range.top && r <= selection.range.bottom;
    const node = (
      <div
        key={r}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          containerRef.current?.focus();
          controller.selectRow(r, e.shiftKey);
        }}
        onContextMenu={(e) => openRowMenu(e, r)}
        title={`Row ${r + 1}`}
        className={`absolute flex cursor-pointer items-center justify-center border-r border-b text-[11px] transition-colors select-none hover:text-ink ${
          selected ? "font-medium text-ink" : "text-ink-muted"
        }`}
        style={{
          left: 0,
          top: rowY(metrics, r),
          width: ROW_HEADER_WIDTH,
          height: rowHeight(metrics, r),
          borderColor: HAIRLINE,
          backgroundColor: selected ? "color-mix(in srgb, var(--ink) 8%, transparent)" : SURFACE,
          zIndex: pinned ? 2 : undefined,
        }}
      >
        {r + 1}
        <div
          onPointerDown={(e) => beginResize("row", r, e)}
          onPointerMove={onResizeMove}
          onPointerUp={endResize}
          onDoubleClick={(e) => {
            e.stopPropagation();
            controller.autoFitRow(r);
          }}
          className="absolute bottom-0 left-0 h-1.5 w-full cursor-row-resize"
          style={{ transform: "translateY(50%)" }}
        />
      </div>
    );
    if (pinned) frozenRowHeaders.push(node);
    else rowHeaders.push(node);
  }

  /* --- Selection / overlay geometry -------------------------------------- */

  const range = selection.range;
  const selX = colX(metrics, range.left);
  const selY = rowY(metrics, range.top);
  const selW = colX(metrics, range.right + 1) - selX;
  const selH = rowY(metrics, range.bottom + 1) - selY;
  /* The active outline covers the whole merge when the active cell is merged, so
     a merged cell reads and edits as one. */
  const activeMerge = controller.mergeLookup(active.row, active.col);
  const actRect: Rect = activeMerge ?? {
    top: active.row,
    left: active.col,
    bottom: active.row,
    right: active.col,
  };
  const actX = colX(metrics, actRect.left);
  const actY = rowY(metrics, actRect.top);
  const actW = colX(metrics, actRect.right + 1) - actX;
  const actH = rowY(metrics, actRect.bottom + 1) - actY;
  const multi = !isSingleCell(range);

  /* An edit on a merged anchor fills the whole merge, not just the anchor cell. */
  const editMerge = editing ? controller.mergeLookup(editing.pos.row, editing.pos.col) : null;
  const editW = (pos: CellPos) =>
    editMerge ? colX(metrics, editMerge.right + 1) - colX(metrics, editMerge.left) : colWidth(metrics, pos.col);
  const editH = (pos: CellPos) =>
    editMerge ? rowY(metrics, editMerge.bottom + 1) - rowY(metrics, editMerge.top) : rowHeight(metrics, pos.row);

  const rectBox = (rect: Rect) => {
    const x = colX(metrics, rect.left);
    const y = rowY(metrics, rect.top);
    return {
      left: x,
      top: y,
      width: colX(metrics, rect.right + 1) - x,
      height: rowY(metrics, rect.bottom + 1) - y,
    };
  };
  const clipBox = controller.clipboard ? rectBox(controller.clipboard.source) : null;
  const fillBox = fillPreview ? rectBox(fillPreview) : null;

  /**
   * The grid lines, drawn from the REAL geometry.
   *
   * These used to be a repeating CSS background sized `defaultColWidth ×
   * defaultRowHeight`. That is a uniform lattice, and the sheet's geometry is
   * not uniform: resize a column and the lines carried on repeating every 100px,
   * painting a line straight through the widened cell — so the cell looked
   * unchanged (or split) even though its header, its selection and its contents
   * had all moved. Hidden rows and columns broke it the same way.
   *
   * Drawing one element per boundary in the visible window costs a few dozen
   * divs — the same order as the cells already rendered there — and cannot
   * disagree with `colX`/`rowY`, because it is `colX`/`rowY`.
   */
  function gridLinesFor(rows: GridWindow, cols: GridWindow): ReactNode[] {
    const lines: ReactNode[] = [];
    for (let c = cols.start; c <= cols.end + 1; c++) {
      const x = colX(metrics, c);
      lines.push(
        <div
          key={`v${c}`}
          className="pointer-events-none absolute top-0 bottom-0"
          style={{ left: x, width: 1, background: HAIRLINE }}
        />,
      );
    }
    for (let r = rows.start; r <= rows.end + 1; r++) {
      const y = rowY(metrics, r);
      lines.push(
        <div
          key={`h${r}`}
          className="pointer-events-none absolute right-0 left-0"
          style={{ top: y, height: 1, background: HAIRLINE }}
        />,
      );
    }
    return lines;
  }

  /* A frozen band selects the cell under it directly, so a click there hits the
     pinned cell rather than whatever the body scrolled beneath it. */
  function frozenClick(e: ReactPointerEvent, region: "corner" | "rows" | "cols") {
    if (e.button !== 0) return;
    focusGrid();
    const el = bodyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + (region === "rows" ? el.scrollLeft : 0);
    const y = e.clientY - rect.top + (region === "cols" ? el.scrollTop : 0);
    controller.clickCell({ row: rowAtY(metrics, y), col: colAtX(metrics, x) }, e.shiftKey);
  }

  /* The props every GridBody (main body and the frozen bands) shares — only the
     row/column windows differ between them. */
  const commonBodyProps = {
    worksheet,
    sheetId: controller.activeSheetId,
    engine: controller.engine,
    effectiveStyle: controller.effectiveStyle,
    validationAt: controller.validationLookup,
    onToggleCheckbox: controller.toggleCheckbox,
    onOpenDropdown: openDropdown,
    filter: worksheet.filter,
    onOpenFilter: openFilter,
    merges: worksheet.merges,
    linkAt: controller.linkLookup,
    hasComment: (r: number, c: number) => !!controller.commentLookup(r, c),
    onOpenComment: openComment,
    metrics,
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onGridKeyDown}
      role="grid"
      aria-label={`${worksheet.name} grid`}
      aria-rowcount={worksheet.rowCount}
      aria-colcount={worksheet.colCount}
      /* A keyboard user needs to see that the grid itself holds focus — it is a
         focusable div, so without a ring there is nothing to see. */
      /* `select-none`: dragging across cells is a range selection, not a text
         selection — without this the browser paints its native text-highlight
         over cell contents while you drag. Text selection is re-enabled only on
         the edit input below, so it works when you double-click into a cell. */
      className="grid h-full min-h-0 w-full overflow-hidden rounded-card border outline-none select-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--ink)_45%,transparent)]"
      style={{
        gridTemplateColumns: `${ROW_HEADER_WIDTH}px minmax(0, 1fr)`,
        gridTemplateRows: `${HEADER_HEIGHT}px minmax(0, 1fr)`,
        borderColor: HAIRLINE,
        background: SURFACE,
      }}
    >
      {/* The active cell, announced to screen readers. The grid is a canvas-like
          surface of absolutely-positioned divs, so there is no focusable node per
          cell to read; this narrates the cursor instead. */}
      <span aria-live="polite" className="sr-only">
        {`${cellRef(active.row, active.col)}${multi ? ` through ${cellRef(range.bottom, range.right)}` : ""}: ${
          controller.displayAt(active.row, active.col) || "empty"
        }`}
      </span>
      {/* Corner — select-all. */}
      <div
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          focusGrid();
          controller.selectAll();
        }}
        className="cursor-pointer border-r border-b"
        style={{ borderColor: HAIRLINE, background: SURFACE }}
      />

      {/* Column-label strip — scrolling headers translated, frozen ones pinned. */}
      <div className="relative overflow-hidden" style={{ background: SURFACE }}>
        <div ref={colStripRef} className="absolute top-0 left-0 h-full will-change-transform">
          {colHeaders}
        </div>
        {frozenCols > 0 && <div className="absolute top-0 left-0 h-full">{frozenColHeaders}</div>}
      </div>

      {/* Row-number strip — scrolling headers translated, frozen ones pinned. */}
      <div className="relative overflow-hidden" style={{ background: SURFACE }}>
        <div ref={rowStripRef} className="absolute top-0 left-0 w-full will-change-transform">
          {rowHeaders}
        </div>
        {frozenRows > 0 && <div className="absolute top-0 left-0 w-full">{frozenRowHeaders}</div>}
      </div>

      {/* Body cell — the scrolling surface, with frozen bands pinned over it. */}
      <div className="relative overflow-hidden">
        <div
          ref={bodyRef}
          onScroll={onBodyScroll}
          onPointerDown={onBodyPointerDown}
          onPointerMove={onBodyPointerMove}
          onPointerUp={onBodyPointerUp}
          onContextMenu={openCellMenu}
          onDoubleClick={() => controller.beginEdit()}
          className="absolute inset-0 overflow-auto"
          style={{ touchAction: "none" }}
        >
          <div className="relative" style={{ width: totalWidth(metrics), height: totalHeight(metrics) }}>
            {gridLinesFor(rowWindow, colWindow)}
            <GridBody {...commonBodyProps} rowWindow={rowWindow} colWindow={colWindow} />

            {multi &&
              (() => {
                const tint = "color-mix(in srgb, var(--ink) 9%, transparent)";
                /* The active (anchor) cell reads UN-tinted, the way Sheets draws
                   it. So the range tint is four strips laid AROUND the anchor
                   rather than one rectangle with an opaque patch dropped on top —
                   that patch hid the anchor cell's own value and fill (the "first
                   cell disappears under a white box" bug). Any strip that collapses
                   to zero (anchor sitting on a selection edge) simply isn't drawn. */
                const strips = [
                  { left: selX, top: selY, width: selW, height: actY - selY },
                  { left: selX, top: actY + actH, width: selW, height: selY + selH - (actY + actH) },
                  { left: selX, top: actY, width: actX - selX, height: actH },
                  { left: actX + actW, top: actY, width: selX + selW - (actX + actW), height: actH },
                ];
                return (
                  <>
                    {strips.map((s, i) =>
                      s.width > 0 && s.height > 0 ? (
                        <div
                          key={i}
                          className="pointer-events-none absolute"
                          style={{ ...s, backgroundColor: tint }}
                        />
                      ) : null,
                    )}
                    {/* The range's own 1px boundary — transparent fill, so it
                        outlines the block the way every spreadsheet does without
                        covering anything underneath. */}
                    <div
                      className="pointer-events-none absolute"
                      style={{
                        left: selX,
                        top: selY,
                        width: selW,
                        height: selH,
                        boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--ink) 45%, transparent)",
                      }}
                    />
                  </>
                );
              })()}
            <div
              className="pointer-events-none absolute"
              style={{ left: actX, top: actY, width: actW, height: actH, boxShadow: "inset 0 0 0 2px var(--ink)" }}
            />

            {clipBox && (
              <div
                className="pointer-events-none absolute"
                style={{
                  left: clipBox.left,
                  top: clipBox.top,
                  width: clipBox.width,
                  height: clipBox.height,
                  border: "1px dashed var(--ink)",
                  opacity: 0.7,
                }}
              />
            )}
            {fillBox && (
              <div
                className="pointer-events-none absolute"
                style={{
                  left: fillBox.left,
                  top: fillBox.top,
                  width: fillBox.width,
                  height: fillBox.height,
                  border: "1px dashed var(--ink)",
                  backgroundColor: "color-mix(in srgb, var(--ink) 5%, transparent)",
                }}
              />
            )}

            {!editing && (
              /* The visible handle stays a small square, but the thing you have
                 to hit is bigger than 7px — a padded, transparent target around
                 it, centred on the selection's corner. */
              <div
                onPointerDown={onFillPointerDown}
                onPointerMove={onFillPointerMove}
                onPointerUp={onFillPointerUp}
                title="Drag to fill"
                className="absolute z-20 flex items-center justify-center"
                style={{
                  left: selX + selW - 8,
                  top: selY + selH - 8,
                  width: 16,
                  height: 16,
                  cursor: "crosshair",
                  touchAction: "none",
                }}
              >
                <span
                  className="block"
                  style={{
                    width: 7,
                    height: 7,
                    background: "var(--ink)",
                    border: "1px solid var(--surface-raised)",
                  }}
                />
              </div>
            )}

            {editing && editing.source === "cell" && (
              <input
                ref={inputRef}
                value={editing.draft}
                onChange={(e) => {
                  controller.changeEdit(e.target.value);
                  setCaret(e.target.selectionStart ?? e.target.value.length);
                  setHelperClosed(false);
                  setHelperActive(0);
                }}
                onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                onKeyDown={onEditorKey}
                onBlur={() => controller.commitEdit()}
                className="absolute z-10 px-1.5 text-[13px] text-ink outline-none select-text"
                style={{
                  left: colX(metrics, editing.pos.col),
                  top: rowY(metrics, editing.pos.row),
                  width: editW(editing.pos),
                  height: editH(editing.pos),
                  background: SURFACE,
                  boxShadow: "inset 0 0 0 2px var(--ink)",
                }}
              />
            )}

            {/* Formula helper — suggestions or the active call's signature,
                anchored under the cell being edited (flipped above near the
                bottom edge). */}
            {editing &&
              editing.source === "cell" &&
              assist &&
              !helperClosed &&
              (() => {
                const cellLeft = colX(metrics, editing.pos.col);
                const cellTop = rowY(metrics, editing.pos.row);
                const cellH = editH(editing.pos);
                const screenTop = cellTop - scroll.top;
                const above =
                  screenTop + cellH + 240 > viewport.height && screenTop - 240 > 0;
                return (
                  <FormulaHelper
                    view={
                      assist.kind === "list"
                        ? {
                            kind: "list",
                            items: assist.matches,
                            active: Math.min(helperActive, assist.matches.length - 1),
                          }
                        : { kind: "signature", help: assist.help, argIndex: assist.argIndex }
                    }
                    placement={above ? "above" : "below"}
                    style={{
                      left: cellLeft,
                      top: above ? cellTop - 2 : cellTop + cellH + 2,
                    }}
                    onPick={acceptSuggestion}
                    onHover={setHelperActive}
                  />
                );
              })()}
            {editing && editing.source === "bar" && (
              <div
                className="pointer-events-none absolute z-10 flex items-center overflow-hidden px-1.5 text-[13px] whitespace-nowrap text-ink"
                style={{
                  left: colX(metrics, editing.pos.col),
                  top: rowY(metrics, editing.pos.row),
                  width: editW(editing.pos),
                  height: editH(editing.pos),
                  background: SURFACE,
                  boxShadow: "inset 0 0 0 2px var(--ink)",
                }}
              >
                {editing.draft}
              </div>
            )}
          </div>
        </div>

        {/* Frozen columns band — pinned to the left, scrolls vertically only. */}
        {frozenCols > 0 && (
          <div
            onPointerDown={(e) => frozenClick(e, "cols")}
            className="absolute top-0 bottom-0 left-0 overflow-hidden"
            style={{ width: frozenW, background: SURFACE, borderRight: `2px solid ${HAIRLINE}` }}
          >
            <div ref={frozenColBandRef} className="absolute top-0 left-0 will-change-transform" style={{ width: frozenW, height: totalHeight(metrics) }}>
              {gridLinesFor(rowWindow, { start: 0, end: frozenCols - 1 })}
              <GridBody {...commonBodyProps} rowWindow={rowWindow} colWindow={{ start: 0, end: frozenCols - 1 }} />
            </div>
          </div>
        )}

        {/* Frozen rows band — pinned to the top, scrolls horizontally only. */}
        {frozenRows > 0 && (
          <div
            onPointerDown={(e) => frozenClick(e, "rows")}
            className="absolute top-0 right-0 left-0 overflow-hidden"
            style={{ height: frozenH, background: SURFACE, borderBottom: `2px solid ${HAIRLINE}` }}
          >
            <div ref={frozenRowBandRef} className="absolute top-0 left-0 will-change-transform" style={{ width: totalWidth(metrics), height: frozenH }}>
              {gridLinesFor({ start: 0, end: frozenRows - 1 }, colWindow)}
              <GridBody {...commonBodyProps} rowWindow={{ start: 0, end: frozenRows - 1 }} colWindow={colWindow} />
            </div>
          </div>
        )}

        {/* Frozen corner — pinned to both, never scrolls. */}
        {frozenRows > 0 && frozenCols > 0 && (
          <div
            onPointerDown={(e) => frozenClick(e, "corner")}
            className="absolute top-0 left-0 overflow-hidden"
            style={{
              width: frozenW,
              height: frozenH,
              background: SURFACE,
              borderRight: `2px solid ${HAIRLINE}`,
              borderBottom: `2px solid ${HAIRLINE}`,
            }}
          >
            <div className="absolute top-0 left-0" style={{ width: frozenW, height: frozenH }}>
              {gridLinesFor({ start: 0, end: frozenRows - 1 }, { start: 0, end: frozenCols - 1 })}
              <GridBody {...commonBodyProps} rowWindow={{ start: 0, end: frozenRows - 1 }} colWindow={{ start: 0, end: frozenCols - 1 }} />
            </div>
          </div>
        )}
      </div>

      {/* Resize guide line, spanning the grid while a header edge is dragged. */}
      {resize && (
        <div
          className="pointer-events-none fixed z-40"
          style={
            resize.kind === "col"
              ? {
                  left: resize.base + resize.size,
                  top: resize.crossStart,
                  width: 2,
                  height: resize.crossLength,
                  background: "var(--ink)",
                }
              : {
                  top: resize.base + resize.size,
                  left: resize.crossStart,
                  height: 2,
                  width: resize.crossLength,
                  background: "var(--ink)",
                }
          }
        />
      )}

      {menu && (
        <HeaderContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />
      )}

      {cellMenu && (
        <CellContextMenu
          x={cellMenu.x}
          y={cellMenu.y}
          items={cellMenuItems()}
          onClose={() => setCellMenu(null)}
        />
      )}

      {searchOpen && (
        <SearchReplaceBar
          controller={controller}
          withReplace={searchOpen === "replace"}
          onClose={() => {
            onSearchOpen(false);
            focusGrid();
          }}
        />
      )}

      {linkEditor && (
        <LinkEditor
          x={linkEditor.x}
          y={linkEditor.y}
          initialUrl={controller.linkLookup(linkEditor.row, linkEditor.col) ?? ""}
          onSubmit={(url) => controller.setCellLink(url)}
          onRemove={() => controller.setCellLink(null)}
          onClose={() => setLinkEditor(null)}
        />
      )}

      {commentAt && (
        <CommentPopover
          x={commentAt.x}
          y={commentAt.y}
          label={cellRef(commentAt.row, commentAt.col)}
          thread={controller.commentLookup(commentAt.row, commentAt.col)}
          onAdd={(body) => controller.addComment(commentAt.row, commentAt.col, body)}
          onEdit={(id, body) => controller.editComment(commentAt.row, commentAt.col, id, body)}
          onRemove={(id) => controller.removeComment(commentAt.row, commentAt.col, id)}
          onResolve={(resolved) => controller.resolveComment(commentAt.row, commentAt.col, resolved)}
          onClose={() => setCommentAt(null)}
        />
      )}

      {dropdown &&
        (() => {
          const rule = controller.validationLookup(dropdown.row, dropdown.col)?.rule;
          const values = rule?.kind === "list" ? rule.values : [];
          return (
            <HeaderContextMenu
              x={dropdown.x}
              y={dropdown.y}
              items={values.map((v) => ({
                label: v,
                onClick: () => controller.commitValue(dropdown.row, dropdown.col, v),
              }))}
              onClose={() => setDropdown(null)}
            />
          );
        })()}

      {filterMenu &&
        worksheet.filter &&
        (() => {
          const f = worksheet.filter;
          return (
            <FilterMenu
              x={filterMenu.x}
              y={filterMenu.y}
              values={columnValues(f.range, filterMenu.col, controller.displayAt)}
              current={f.columns[filterMenu.col]}
              onApply={(cf) => controller.setColumnFilter(filterMenu.col, cf)}
              onClose={() => setFilterMenu(null)}
            />
          );
        })()}
    </div>
  );
}
