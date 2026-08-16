/**
 * Spreadsheet coordinates — the pure addressing layer.
 *
 * This module is the vocabulary the rest of the spreadsheet speaks in: it turns
 * a column index into "A", a cell into "A1", and a typed range "A1:C5" into a
 * rectangle. It has no dependency on React, the DOM, or the data model, so it
 * can be reasoned about and tested on its own.
 *
 * Everything here is **0-based** internally — row 0 is displayed as "1", column
 * 0 as "A". Displaying is the caller's concern; the maths is cleaner in 0-based.
 */

/** A single cell, 0-based. */
export interface CellPos {
  row: number;
  col: number;
}

/** An inclusive rectangle of cells, 0-based. `top <= bottom`, `left <= right`. */
export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/**
 * A column index to its spreadsheet label: 0→"A", 25→"Z", 26→"AA", 701→"ZZ".
 *
 * This is bijective base-26 (there is no "digit 0"), which is why it is not a
 * plain base conversion: each place runs A–Z with no zero, so carrying borrows
 * one from the place above before dividing.
 */
export function columnLabel(index: number): string {
  if (!Number.isInteger(index) || index < 0) return "";
  let n = index;
  let label = "";
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

/**
 * A column label back to its index: "A"→0, "Z"→25, "AA"→26. Returns -1 for
 * anything that is not one or more letters, so a caller can reject it.
 */
export function columnIndex(label: string): number {
  if (!label || !/^[A-Za-z]+$/.test(label)) return -1;
  let n = 0;
  for (const ch of label.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

/** A position to its A1 reference: (0,0)→"A1", (499,2)→"C500". */
export function cellRef(row: number, col: number): string {
  return `${columnLabel(col)}${row + 1}`;
}

/**
 * An A1 reference to a position, tolerating a `$`-anchored ref ("$A$1"). Returns
 * null for anything that is not `<letters><digits>`, so parsing failure is a
 * value the caller handles rather than an exception.
 */
export function parseCellRef(ref: string): CellPos | null {
  const match = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref.trim());
  if (!match) return null;
  const col = columnIndex(match[1]);
  const row = Number.parseInt(match[2], 10) - 1;
  if (col < 0 || row < 0 || !Number.isFinite(row)) return null;
  return { row, col };
}

/** The bounding rectangle of two corners, in any order. */
export function normalizeRange(a: CellPos, b: CellPos): Rect {
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

/**
 * A typed range to a rectangle: "A1:C5" → the block, "B2" → a single-cell rect.
 * Null when either side does not parse, so an invalid range never becomes a
 * silently-wrong selection.
 */
export function parseRange(text: string): Rect | null {
  const parts = text.trim().split(":");
  if (parts.length === 1) {
    const one = parseCellRef(parts[0]);
    return one ? { top: one.row, left: one.col, bottom: one.row, right: one.col } : null;
  }
  if (parts.length !== 2) return null;
  const a = parseCellRef(parts[0]);
  const b = parseCellRef(parts[1]);
  if (!a || !b) return null;
  return normalizeRange(a, b);
}

/** A rectangle to its label: a single cell reads "B2", a block reads "A1:C5". */
export function rangeLabel(rect: Rect): string {
  const start = cellRef(rect.top, rect.left);
  if (isSingleCell(rect)) return start;
  return `${start}:${cellRef(rect.bottom, rect.right)}`;
}

/** Whether a rectangle covers exactly one cell. */
export function isSingleCell(rect: Rect): boolean {
  return rect.top === rect.bottom && rect.left === rect.right;
}

/** Whether a position lies inside a rectangle. */
export function rectContains(rect: Rect, row: number, col: number): boolean {
  return row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right;
}

/** How many cells a rectangle covers. */
export function rectArea(rect: Rect): number {
  return (rect.bottom - rect.top + 1) * (rect.right - rect.left + 1);
}
