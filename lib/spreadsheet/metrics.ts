/**
 * Grid geometry — where every row and column sits, in pixels.
 *
 * This is the arithmetic behind virtualization: given a scroll position it says
 * which rows and columns are on screen, and given a pointer it says which cell
 * was hit. It is deliberately uniform-by-default with a sparse map of overrides,
 * so Phase 1 draws a plain grid while the SAME functions already support
 * per-row/column resizing a later phase will populate — no rewrite needed.
 *
 * Pure and DOM-free: it takes numbers and returns numbers.
 */

export const DEFAULT_COL_WIDTH = 100;
export const DEFAULT_ROW_HEIGHT = 24;
/** The column-label strip along the top. */
export const HEADER_HEIGHT = 24;
/** The row-number strip down the left. */
export const ROW_HEADER_WIDTH = 48;

export interface GridMetrics {
  rows: number;
  cols: number;
  defaultRowHeight: number;
  defaultColWidth: number;
  /** Per-index size overrides. Sparse — only resized rows/columns appear. */
  rowHeights: Record<number, number>;
  colWidths: Record<number, number>;
  /** Hidden rows/columns — rendered at zero size, so the geometry skips them. */
  hiddenRows?: Record<number, true>;
  hiddenCols?: Record<number, true>;
}

function hasKeys(map: Record<number, unknown> | undefined): boolean {
  if (!map) return false;
  for (const _ in map) return true;
  return false;
}

/** Whether the column geometry needs the slow per-column walk (resizes or hides
    present) rather than the uniform fast path. */
function colsUniform(m: GridMetrics): boolean {
  return !hasKeys(m.colWidths) && !hasKeys(m.hiddenCols);
}

function rowsUniform(m: GridMetrics): boolean {
  return !hasKeys(m.rowHeights) && !hasKeys(m.hiddenRows);
}

/** The width of one column — zero when it is hidden. */
export function colWidth(m: GridMetrics, col: number): number {
  if (m.hiddenCols?.[col]) return 0;
  return m.colWidths[col] ?? m.defaultColWidth;
}

/** The height of one row — zero when it is hidden. */
export function rowHeight(m: GridMetrics, row: number): number {
  if (m.hiddenRows?.[row]) return 0;
  return m.rowHeights[row] ?? m.defaultRowHeight;
}

/**
 * Cached prefix sums for the NON-uniform case.
 *
 * When every row is the same height the offset is a multiplication, and that
 * fast path is taken. But one hidden or resized row leaves it — and a filter,
 * a hidden row or a single drag-resize all do — after which a naive offset is a
 * walk from row 0. Measured, that walk cost ~59 ms per render on a 100,000-row
 * sheet, because the grid asks for an offset per visible cell.
 *
 * So the walk is done ONCE per distinct geometry and kept: `offsets[i]` is the
 * offset of line `i`, with a final entry holding the total. Lookup is then an
 * array index (O(1)) and the inverse is a binary search (O(log n)).
 *
 * The cache is a `WeakMap` keyed by the metrics object, which the UI rebuilds
 * only when the worksheet's geometry actually changes — so a new key means the
 * sizes really did change, and a dropped worksheet takes its cache with it.
 */
interface Prefix {
  offsets: Float64Array;
}
const rowPrefixCache = new WeakMap<GridMetrics, Prefix>();
const colPrefixCache = new WeakMap<GridMetrics, Prefix>();

function buildPrefix(count: number, sizeAt: (i: number) => number): Prefix {
  const offsets = new Float64Array(count + 1);
  let acc = 0;
  for (let i = 0; i < count; i++) {
    offsets[i] = acc;
    acc += sizeAt(i);
  }
  offsets[count] = acc;
  return { offsets };
}

function rowPrefix(m: GridMetrics): Prefix {
  let p = rowPrefixCache.get(m);
  if (!p) {
    p = buildPrefix(m.rows, (r) => rowHeight(m, r));
    rowPrefixCache.set(m, p);
  }
  return p;
}

function colPrefix(m: GridMetrics): Prefix {
  let p = colPrefixCache.get(m);
  if (!p) {
    p = buildPrefix(m.cols, (c) => colWidth(m, c));
    colPrefixCache.set(m, p);
  }
  return p;
}

/** The largest index whose offset is <= `target`, by binary search. */
function searchPrefix(offsets: Float64Array, count: number, target: number): number {
  let lo = 0;
  let hi = count - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= target) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** The x offset of a column's left edge. */
export function colX(m: GridMetrics, col: number): number {
  if (colsUniform(m)) return col * m.defaultColWidth;
  const { offsets } = colPrefix(m);
  if (col <= 0) return 0;
  if (col >= offsets.length) return offsets[offsets.length - 1];
  return offsets[col];
}

/** The y offset of a row's top edge. */
export function rowY(m: GridMetrics, row: number): number {
  if (rowsUniform(m)) return row * m.defaultRowHeight;
  const { offsets } = rowPrefix(m);
  if (row <= 0) return 0;
  if (row >= offsets.length) return offsets[offsets.length - 1];
  return offsets[row];
}

/** The full scrollable width of the grid body. */
export function totalWidth(m: GridMetrics): number {
  return colX(m, m.cols);
}

/** The full scrollable height of the grid body. */
export function totalHeight(m: GridMetrics): number {
  return rowY(m, m.rows);
}

/** Which column contains an x offset, clamped to the grid. */
export function colAtX(m: GridMetrics, x: number): number {
  if (x < 0) return 0;
  if (colsUniform(m)) {
    return Math.min(m.cols - 1, Math.floor(x / m.defaultColWidth));
  }
  return searchPrefix(colPrefix(m).offsets, m.cols, x);
}

/** Which row contains a y offset, clamped to the grid. */
export function rowAtY(m: GridMetrics, y: number): number {
  if (y < 0) return 0;
  if (rowsUniform(m)) {
    return Math.min(m.rows - 1, Math.floor(y / m.defaultRowHeight));
  }
  return searchPrefix(rowPrefix(m).offsets, m.rows, y);
}

export interface Window {
  start: number;
  end: number;
}

/**
 * The columns to actually render for a viewport, plus a buffer either side so a
 * fast scroll does not reveal a blank edge before the next frame.
 */
export function visibleCols(
  m: GridMetrics,
  scrollLeft: number,
  viewportWidth: number,
  buffer = 2,
): Window {
  const start = Math.max(0, colAtX(m, scrollLeft) - buffer);
  const end = Math.min(m.cols - 1, colAtX(m, scrollLeft + viewportWidth) + buffer);
  return { start, end };
}

/** The rows to actually render for a viewport, with a buffer. */
export function visibleRows(
  m: GridMetrics,
  scrollTop: number,
  viewportHeight: number,
  buffer = 4,
): Window {
  const start = Math.max(0, rowAtY(m, scrollTop) - buffer);
  const end = Math.min(m.rows - 1, rowAtY(m, scrollTop + viewportHeight) + buffer);
  return { start, end };
}

/** The zoom levels the View tab offers, as factors. */
export const ZOOM_LEVELS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2] as const;

export function clampZoom(z: number): number {
  return Math.min(2, Math.max(0.5, Math.round(z * 100) / 100));
}

/**
 * The same geometry at a zoom: every height and width multiplied, so the
 * virtualisation, hit-testing and scrolling all keep working in pixels. A
 * zoom of 1 returns the metrics untouched.
 */
export function scaleMetrics(m: GridMetrics, zoom: number): GridMetrics {
  if (zoom === 1) return m;
  const scaleMap = (map: Record<number, number>): Record<number, number> => {
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(map)) out[Number(k)] = Math.max(1, Math.round(v * zoom));
    return out;
  };
  return {
    ...m,
    defaultRowHeight: Math.max(1, Math.round(m.defaultRowHeight * zoom)),
    defaultColWidth: Math.max(1, Math.round(m.defaultColWidth * zoom)),
    rowHeights: scaleMap(m.rowHeights),
    colWidths: scaleMap(m.colWidths),
  };
}
