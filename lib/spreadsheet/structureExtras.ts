/**
 * What a row or column edit does to everything that is NOT a cell.
 *
 * Inserting rows above a merged block, a validation rule, a comment or a
 * link used to leave them behind on the old coordinates — the cells moved
 * and their annotations did not. A comment about "row 5" then sat on row 5
 * while the cell it described had become row 6. These helpers move every
 * rectangle and every ref-keyed map the same way the cells move, and drop
 * what a deletion removed entirely, so the sheet stays one coherent thing.
 */

import { cellRef, parseCellRef, type Rect } from "./coordinates";

export interface LineOp {
  axis: "row" | "col";
  at: number;
  count: number;
  mode: "insert" | "delete";
}

/** Where a line index lands after the edit, or null when it was deleted. */
export function mapLineIndex(line: number, op: LineOp): number | null {
  if (op.mode === "insert") return line >= op.at ? line + op.count : line;
  if (line >= op.at && line < op.at + op.count) return null;
  return line >= op.at + op.count ? line - op.count : line;
}

/** A rectangle after the edit: moved, stretched, shrunk — or null when the
    deleted band covered all of it. */
export function shiftRect(rect: Rect, op: LineOp): Rect | null {
  const r = { ...rect };
  const lo = op.axis === "row" ? "top" : "left";
  const hi = op.axis === "row" ? "bottom" : "right";
  if (op.mode === "insert") {
    if (r[lo] >= op.at) r[lo] += op.count;
    if (r[hi] >= op.at) r[hi] += op.count;
    return r;
  }
  const end = op.at + op.count - 1;
  if (r[lo] >= op.at && r[hi] <= end) return null;
  if (r[lo] > end) {
    r[lo] -= op.count;
    r[hi] -= op.count;
  } else if (r[hi] >= op.at) {
    const removedInside = Math.min(r[hi], end) - Math.max(r[lo], op.at) + 1;
    r[hi] -= removedInside;
    if (r[lo] > op.at) r[lo] = op.at;
  }
  return r;
}

/** Every item with a `range`, shifted; items whose range is gone are dropped. */
export function shiftRanged<T extends { range: Rect }>(items: readonly T[] | undefined, op: LineOp): T[] | undefined {
  if (!items) return items;
  const out: T[] = [];
  for (const item of items) {
    const range = shiftRect(item.range, op);
    if (range) out.push({ ...item, range });
  }
  return out.length ? out : undefined;
}

/** Plain rectangles (merges), shifted; a merge reduced to one cell is dropped
    too, since a one-cell merge is no merge. */
export function shiftRects(rects: readonly Rect[] | undefined, op: LineOp): Rect[] | undefined {
  if (!rects) return rects;
  const out: Rect[] = [];
  for (const rect of rects) {
    const next = shiftRect(rect, op);
    if (next && (next.top !== next.bottom || next.left !== next.right)) out.push(next);
  }
  return out.length ? out : undefined;
}

/** A map keyed by A1 ref (links, comments, notes), re-keyed; deleted cells'
    entries are dropped. */
export function shiftRefMap<T>(map: Record<string, T> | undefined, op: LineOp): Record<string, T> | undefined {
  if (!map) return map;
  const out: Record<string, T> = {};
  let any = false;
  for (const [ref, value] of Object.entries(map)) {
    const pos = parseCellRef(ref);
    if (!pos) continue;
    const line = op.axis === "row" ? pos.row : pos.col;
    const next = mapLineIndex(line, op);
    if (next === null) continue;
    const row = op.axis === "row" ? next : pos.row;
    const col = op.axis === "row" ? pos.col : next;
    out[cellRef(row, col)] = value;
    any = true;
  }
  return any ? out : undefined;
}

/** Outline bands over the SAME axis as the edit move like a range does;
    bands over the other axis are untouched. */
export function shiftBands<T extends { from: number; to: number }>(
  bands: readonly T[] | undefined,
  op: LineOp,
  bandAxis: "row" | "col",
): T[] | undefined {
  if (!bands || op.axis !== bandAxis) return bands ? [...bands] : bands;
  const out: T[] = [];
  for (const b of bands) {
    const r = shiftRect({ top: b.from, left: 0, bottom: b.to, right: 0 }, { ...op, axis: "row" });
    if (r && r.bottom > r.top) out.push({ ...b, from: r.top, to: r.bottom });
  }
  return out.length ? out : undefined;
}
