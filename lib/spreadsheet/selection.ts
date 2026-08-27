/**
 * Selection — the pure maths behind clicking, dragging and the arrow keys.
 *
 * A selection is an **anchor**, an **active** cell, and the **rectangle** they
 * span. Anchor is where a range started (a click, or the cell before Shift was
 * held); active is where the cursor is now; the rectangle is what is
 * highlighted. Every gesture is one of a handful of transforms over that triple,
 * and each is a pure function so it can be tested without a grid.
 *
 * The neighbourhood-aware moves (Ctrl+Arrow, Ctrl+A) take an `isFilled`
 * predicate rather than the worksheet itself, so this module stays independent
 * of the data model.
 */

import {
  normalizeRange,
  isSingleCell,
  type CellPos,
  type Rect,
} from "./coordinates";

export type Direction = "up" | "down" | "left" | "right";

export interface Selection {
  anchor: CellPos;
  active: CellPos;
  range: Rect;
}

/** The Phase 2 spec's name for the selection triple. */
export type SelectionState = Selection;

export interface Bounds {
  rows: number;
  cols: number;
}

/** Whether a cell carries a value — supplied by the caller from the model. */
export type FilledFn = (row: number, col: number) => boolean;

const STEP: Record<Direction, { dr: number; dc: number }> = {
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 },
};

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

/** Hold a position inside the grid. */
export function clampPos(pos: CellPos, b: Bounds): CellPos {
  return { row: clamp(pos.row, b.rows - 1), col: clamp(pos.col, b.cols - 1) };
}

/** A fresh single-cell selection at a position. */
export function cellSelection(pos: CellPos): Selection {
  return {
    anchor: pos,
    active: pos,
    range: { top: pos.row, left: pos.col, bottom: pos.row, right: pos.col },
  };
}

/** Move the whole selection to a single cell (a plain click, or Ctrl-move). */
export function selectCell(pos: CellPos, b: Bounds): Selection {
  return cellSelection(clampPos(pos, b));
}

/** Extend the current selection to a cell, keeping the anchor (Shift-click,
    Shift-drag). */
export function extendTo(sel: Selection, pos: CellPos, b: Bounds): Selection {
  const active = clampPos(pos, b);
  return { anchor: sel.anchor, active, range: normalizeRange(sel.anchor, active) };
}

/** Move the active cell one step (a plain arrow key). Collapses any range. */
export function moveActive(sel: Selection, dir: Direction, b: Bounds): Selection {
  const { dr, dc } = STEP[dir];
  return selectCell({ row: sel.active.row + dr, col: sel.active.col + dc }, b);
}

/** Grow or shrink the selection by one step (Shift+arrow). */
export function extendActive(sel: Selection, dir: Direction, b: Bounds): Selection {
  const { dr, dc } = STEP[dir];
  return extendTo(sel, { row: sel.active.row + dr, col: sel.active.col + dc }, b);
}

/**
 * The cell a Ctrl/Cmd+Arrow lands on — the edge of the populated region.
 *
 * Mirrors the spreadsheet convention: from a filled cell that borders more
 * filled cells, jump to the far end of that run; otherwise skip the blanks to
 * the next filled cell; and when nothing lies ahead, jump to the grid boundary.
 */
export function edgeInDirection(
  pos: CellPos,
  dir: Direction,
  filled: FilledFn,
  b: Bounds,
): CellPos {
  const { dr, dc } = STEP[dir];
  const inBounds = (r: number, c: number) =>
    r >= 0 && c >= 0 && r < b.rows && c < b.cols;

  let { row, col } = pos;
  const nr = row + dr;
  const nc = col + dc;
  if (!inBounds(nr, nc)) return { row, col }; // already at the edge

  const boundary = (): CellPos => ({
    row: dr > 0 ? b.rows - 1 : dr < 0 ? 0 : row,
    col: dc > 0 ? b.cols - 1 : dc < 0 ? 0 : col,
  });

  if (filled(row, col) && filled(nr, nc)) {
    // Ride the run of filled cells to its last one.
    while (inBounds(row + dr, col + dc) && filled(row + dr, col + dc)) {
      row += dr;
      col += dc;
    }
    return { row, col };
  }

  // Skip blanks to the next filled cell; if there is none, the boundary.
  let r = row + dr;
  let c = col + dc;
  while (inBounds(r, c) && !filled(r, c)) {
    r += dr;
    c += dc;
  }
  return inBounds(r, c) ? { row: r, col: c } : boundary();
}

export function moveToEdge(
  sel: Selection,
  dir: Direction,
  filled: FilledFn,
  b: Bounds,
): Selection {
  return cellSelection(edgeInDirection(sel.active, dir, filled, b));
}

export function extendToEdge(
  sel: Selection,
  dir: Direction,
  filled: FilledFn,
  b: Bounds,
): Selection {
  return extendTo(sel, edgeInDirection(sel.active, dir, filled, b), b);
}

/** The whole sheet as one rectangle. */
export function selectAllRect(b: Bounds): Rect {
  return { top: 0, left: 0, bottom: b.rows - 1, right: b.cols - 1 };
}

/**
 * The contiguous block of data around a cell — what the first Ctrl/Cmd+A picks.
 *
 * Grows a rectangle from the active cell while the row or column just outside it
 * holds any value, the standard "current region" expansion. Each border scan
 * reaches ONE CELL PAST each end of the rectangle's span, so diagonally-adjacent
 * data counts as connected — as Excel's CurrentRegion and Sheets' Ctrl+A treat
 * it: the region is bounded by fully blank rows and columns, corners included.
 * An isolated empty cell stays a single cell, so pressing the shortcut on a
 * blank sheet selects one cell first and the whole sheet next.
 */
export function dataRegion(active: CellPos, filled: FilledFn, b: Bounds): Rect {
  const rect: Rect = {
    top: active.row,
    left: active.col,
    bottom: active.row,
    right: active.col,
  };

  /* Span scans include one cell beyond each end (clamped to the grid), so a
     neighbour touching only at a corner still pulls its row/column in. */
  const rowHasData = (r: number, c0: number, c1: number) => {
    const lo = Math.max(0, c0);
    const hi = Math.min(b.cols - 1, c1);
    for (let c = lo; c <= hi; c++) if (filled(r, c)) return true;
    return false;
  };
  const colHasData = (c: number, r0: number, r1: number) => {
    const lo = Math.max(0, r0);
    const hi = Math.min(b.rows - 1, r1);
    for (let r = lo; r <= hi; r++) if (filled(r, c)) return true;
    return false;
  };

  let growing = true;
  while (growing) {
    growing = false;
    if (rect.top > 0 && rowHasData(rect.top - 1, rect.left - 1, rect.right + 1)) {
      rect.top -= 1;
      growing = true;
    }
    if (rect.bottom < b.rows - 1 && rowHasData(rect.bottom + 1, rect.left - 1, rect.right + 1)) {
      rect.bottom += 1;
      growing = true;
    }
    if (rect.left > 0 && colHasData(rect.left - 1, rect.top - 1, rect.bottom + 1)) {
      rect.left -= 1;
      growing = true;
    }
    if (rect.right < b.cols - 1 && colHasData(rect.right + 1, rect.top - 1, rect.bottom + 1)) {
      rect.right += 1;
      growing = true;
    }
  }
  return rect;
}

/**
 * What Ctrl/Cmd+A selects, given where it currently is: the data region first,
 * then — pressed again, once the region is already selected — the whole sheet.
 * Once the whole sheet is selected, further presses keep it selected (Excel and
 * Sheets do not cycle back down to the data region).
 */
export function selectAllStep(sel: Selection, filled: FilledFn, b: Bounds): Selection {
  const region = dataRegion(sel.active, filled, b);
  const everything = selectAllRect(b);
  const sameRect = (a: Rect, c: Rect) =>
    a.top === c.top && a.left === c.left && a.bottom === c.bottom && a.right === c.right;
  const next =
    sameRect(sel.range, everything) || sameRect(sel.range, region) || isSingleCell(region)
      ? everything
      : region;
  return { anchor: sel.active, active: sel.active, range: next };
}

/** The rightmost filled column in a row, or 0 when the row is empty. */
export function rowEnd(row: number, filled: FilledFn, b: Bounds): number {
  for (let c = b.cols - 1; c >= 0; c--) if (filled(row, c)) return c;
  return 0;
}

/** Home — the start of the active row. */
export function moveHome(sel: Selection): Selection {
  return cellSelection({ row: sel.active.row, col: 0 });
}

/** End — the last filled cell in the active row (or its start when empty). */
export function moveEnd(sel: Selection, filled: FilledFn, b: Bounds): Selection {
  return cellSelection({ row: sel.active.row, col: rowEnd(sel.active.row, filled, b) });
}

/** Ctrl+Home — the top-left of the sheet. */
export function moveDocumentStart(): Selection {
  return cellSelection({ row: 0, col: 0 });
}

/** Ctrl+End — the bottom-right of the used data, or A1 when the sheet is empty. */
export function moveDocumentEnd(filled: FilledFn, b: Bounds): Selection {
  let lastRow = 0;
  let lastCol = 0;
  let any = false;
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      if (filled(r, c)) {
        any = true;
        if (r > lastRow) lastRow = r;
        if (c > lastCol) lastCol = c;
      }
    }
  }
  return cellSelection(any ? { row: lastRow, col: lastCol } : { row: 0, col: 0 });
}
