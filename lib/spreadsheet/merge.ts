/**
 * Merged cells — a region of cells shown and edited as one.
 *
 * A merge is a rectangle. Its TOP-LEFT cell (the anchor) keeps the value and is
 * drawn spanning the whole region; the cells it covers are not rendered and hold
 * no value of their own. Merges are stored on the worksheet as a plain list of
 * rectangles (`merges: Rect[]`), kept SEPARATE from cell values — the same
 * separation the styles, filters and validations already follow.
 *
 * This module is the pure algebra over that list: which region covers a cell,
 * how a selection becomes one merge (all), a strip per row (horizontal) or a
 * strip per column (vertical), and how merging clears the cells it swallows so
 * their data does not linger invisibly beneath the anchor.
 *
 * Merges are NOT rewritten by row/column insert or delete — that reference
 * tracking is out of this phase's scope; a structural reshape leaves the merge
 * rectangles where they were, and a caller may re-merge if needed.
 */

import { cellRef, rectContains, type Rect } from "./coordinates";
import { applyCellWrites, type CellWrite, type Worksheet } from "./model";

/** The three ways a selection is merged. */
export type MergeKind = "all" | "horizontal" | "vertical";

/** Whether two rectangles share any cell. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

/** The merge covering a cell, or null. */
export function mergeAt(merges: readonly Rect[] | undefined, row: number, col: number): Rect | null {
  if (!merges) return null;
  for (const m of merges) if (rectContains(m, row, col)) return m;
  return null;
}

/** Whether a cell is the anchor (top-left) of the merge covering it. */
export function isMergeAnchor(merge: Rect, row: number, col: number): boolean {
  return merge.top === row && merge.left === col;
}

/**
 * The regions a selection produces under a merge kind. A region narrower than
 * two cells in the merged direction is dropped — a 1×1 "merge" is meaningless —
 * so "merge horizontally" over a single column yields nothing.
 */
export function mergeRegionsFor(range: Rect, kind: MergeKind): Rect[] {
  const regions: Rect[] = [];
  if (kind === "all") {
    if (range.top !== range.bottom || range.left !== range.right) regions.push({ ...range });
    return regions;
  }
  if (kind === "horizontal") {
    if (range.left === range.right) return regions;
    for (let r = range.top; r <= range.bottom; r++) {
      regions.push({ top: r, bottom: r, left: range.left, right: range.right });
    }
    return regions;
  }
  /* vertical */
  if (range.top === range.bottom) return regions;
  for (let c = range.left; c <= range.right; c++) {
    regions.push({ top: range.top, bottom: range.bottom, left: c, right: c });
  }
  return regions;
}

/**
 * Merge a selection, returning a NEW worksheet. New regions replace any existing
 * merge they overlap, and every cell a region covers EXCEPT its anchor is
 * cleared — merging keeps only the top-left value, the standard behaviour, and
 * clearing is what keeps the swallowed data from reappearing on unmerge.
 */
export function applyMerge(ws: Worksheet, range: Rect, kind: MergeKind): Worksheet {
  const regions = mergeRegionsFor(range, kind);
  if (regions.length === 0) return ws;

  const kept = (ws.merges ?? []).filter(
    (m) => !regions.some((region) => rectsOverlap(m, region)),
  );
  const next: Worksheet = { ...ws, merges: [...kept, ...regions] };

  /* Clearing the swallowed cells is one batched write, so merging a large block
     stays linear rather than copying the cell map once per cell. */
  const writes: CellWrite[] = [];
  for (const region of regions) {
    for (let r = region.top; r <= region.bottom; r++) {
      for (let c = region.left; c <= region.right; c++) {
        if (r === region.top && c === region.left) continue; // keep the anchor
        writes.push({ row: r, col: c, value: "" });
      }
    }
  }
  return applyCellWrites(next, writes);
}

/**
 * Unmerge every merge that intersects a selection, returning a NEW worksheet.
 * The cells stay where they are — unmerging only removes the spanning, it does
 * not restore the values a merge cleared.
 */
export function removeMerge(ws: Worksheet, range: Rect): Worksheet {
  const merges = ws.merges;
  if (!merges || merges.length === 0) return ws;
  const kept = merges.filter((m) => !rectsOverlap(m, range));
  if (kept.length === merges.length) return ws;
  return { ...ws, merges: kept.length ? kept : undefined };
}

/** Whether any merge intersects a selection — for enabling the Unmerge action. */
export function hasMergeIn(merges: readonly Rect[] | undefined, range: Rect): boolean {
  if (!merges) return false;
  return merges.some((m) => rectsOverlap(m, range));
}

/**
 * The rectangle a selection must grow to so it never splits a merge: expand it
 * until it contains every merge it touches, repeating until stable (growing to
 * cover one merge can bring it into contact with another).
 */
export function expandRangeOverMerges(merges: readonly Rect[] | undefined, range: Rect): Rect {
  if (!merges || merges.length === 0) return range;
  let out = { ...range };
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of merges) {
      if (!rectsOverlap(m, out)) continue;
      const top = Math.min(out.top, m.top);
      const left = Math.min(out.left, m.left);
      const bottom = Math.max(out.bottom, m.bottom);
      const right = Math.max(out.right, m.right);
      if (top !== out.top || left !== out.left || bottom !== out.bottom || right !== out.right) {
        out = { top, left, bottom, right };
        grew = true;
      }
    }
  }
  return out;
}

/** A cell's A1 ref, re-exported convenience for callers building link/comment
    maps keyed the same way merges' anchors would be. */
export function anchorRef(merge: Rect): string {
  return cellRef(merge.top, merge.left);
}
