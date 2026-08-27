/**
 * Merge audit — regions, anchors, overlap and lookup.
 *
 * Reference semantics: merging keeps ONLY the top-left (anchor) value and
 * clears the swallowed cells (their formatting survives); a new merge replaces
 * any merge it overlaps; unmerge removes spanning without restoring values;
 * lookup answers for EVERY covered cell; selections grow so they never split a
 * merge. The documented phase gaps — merges not shifted by structural edits,
 * and fill/clipboard being merge-unaware — are exercised in the structure
 * audit and the report's judgement calls.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCellRef, rectContains, type Rect } from "@/lib/spreadsheet/coordinates";
import {
  createWorksheet,
  getCellStyleId,
  getCellValue,
  setCellStyleId,
  setCellValue,
  type Worksheet,
} from "@/lib/spreadsheet/model";
import {
  anchorRef,
  applyMerge,
  expandRangeOverMerges,
  hasMergeIn,
  isMergeAnchor,
  mergeAt,
  mergeRegionsFor,
  rectsOverlap,
  removeMerge,
} from "@/lib/spreadsheet/merge";

const rect = (t: number, l: number, b: number, r: number): Rect =>
  ({ top: t, left: l, bottom: b, right: r });

function build(cells: Record<string, string>): Worksheet {
  let ws = createWorksheet("s", "Sheet1");
  for (const [ref, value] of Object.entries(cells)) {
    const p = parseCellRef(ref)!;
    ws = setCellValue(ws, p.row, p.col, value);
  }
  return ws;
}

test("AUDIT: rectsOverlap — sharing one cell overlaps, mere adjacency does not", () => {
  const a = rect(0, 0, 1, 1);
  assert.equal(rectsOverlap(a, rect(1, 1, 3, 3)), true, "corner cell shared");
  assert.equal(rectsOverlap(a, rect(0, 2, 1, 3)), false, "side by side");
  assert.equal(rectsOverlap(a, rect(2, 0, 3, 1)), false, "stacked");
  assert.equal(rectsOverlap(a, a), true, "identical");
  assert.equal(rectsOverlap(rect(0, 0, 5, 5), rect(2, 2, 3, 3)), true, "containment");
});

test("AUDIT: mergeAt answers for EVERY covered cell of a region, and only those", () => {
  const ws = applyMerge(build({}), rect(1, 1, 3, 4), "all");
  const m = rect(1, 1, 3, 4);
  for (let r = 1; r <= 3; r++) {
    for (let c = 1; c <= 4; c++) {
      assert.deepEqual(mergeAt(ws.merges, r, c), m, `covered cell (${r},${c})`);
    }
  }
  // The full border just outside answers null.
  for (let c = 0; c <= 5; c++) {
    assert.equal(mergeAt(ws.merges, 0, c), null);
    assert.equal(mergeAt(ws.merges, 4, c), null);
  }
  for (let r = 1; r <= 3; r++) {
    assert.equal(mergeAt(ws.merges, r, 0), null);
    assert.equal(mergeAt(ws.merges, r, 5), null);
  }
  assert.equal(isMergeAnchor(m, 1, 1), true);
  assert.equal(isMergeAnchor(m, 1, 2), false);
  assert.equal(isMergeAnchor(m, 3, 4), false);
  assert.equal(anchorRef(m), "B2");
});

test("AUDIT: merging keeps the anchor value and clears every swallowed value", () => {
  const ws = build({ A1: "keep", B1: "b", A2: "c", B2: "d", C3: "outside" });
  const next = applyMerge(ws, rect(0, 0, 1, 1), "all");
  assert.equal(getCellValue(next, 0, 0), "keep");
  assert.equal(getCellValue(next, 0, 1), "");
  assert.equal(getCellValue(next, 1, 0), "");
  assert.equal(getCellValue(next, 1, 1), "");
  assert.equal(getCellValue(next, 2, 2), "outside", "cells outside the merge untouched");
});

test("AUDIT: an empty anchor stays empty — swallowed values are NOT promoted", () => {
  // Real spreadsheets keep only the top-left value even when it is blank; the
  // covered value is lost (they warn, then do exactly this).
  const ws = build({ B1: "onlyB1" });
  const next = applyMerge(ws, rect(0, 0, 0, 1), "all");
  assert.equal(getCellValue(next, 0, 0), "");
  assert.equal(getCellValue(next, 0, 1), "");
});

test("AUDIT: merging clears swallowed VALUES but keeps their formatting", () => {
  // Excel keeps hidden cells' formats — visible again on unmerge.
  let ws = build({ A1: "x", B1: "y" });
  ws = setCellStyleId(ws, 0, 1, 7);
  const merged = applyMerge(ws, rect(0, 0, 0, 1), "all");
  assert.equal(getCellValue(merged, 0, 1), "");
  assert.equal(getCellStyleId(merged, 0, 1), 7, "style survives the merge");
  const unmerged = removeMerge(merged, rect(0, 0, 0, 1));
  assert.equal(getCellStyleId(unmerged, 0, 1), 7, "and reappears on unmerge");
  assert.equal(getCellValue(unmerged, 0, 1), "", "the cleared value does NOT come back");
});

test("AUDIT: horizontal/vertical merge make one strip per row/column, clearing per strip", () => {
  const ws = build({ A1: "r1", B1: "gone1", A2: "r2", B2: "gone2" });
  const horizontal = applyMerge(ws, rect(0, 0, 1, 1), "horizontal");
  assert.deepEqual(horizontal.merges, [rect(0, 0, 0, 1), rect(1, 0, 1, 1)]);
  assert.equal(getCellValue(horizontal, 0, 0), "r1");
  assert.equal(getCellValue(horizontal, 1, 0), "r2", "each row keeps its own anchor");
  assert.equal(getCellValue(horizontal, 0, 1), "");
  assert.equal(getCellValue(horizontal, 1, 1), "");

  const vertical = applyMerge(ws, rect(0, 0, 1, 1), "vertical");
  assert.deepEqual(vertical.merges, [rect(0, 0, 1, 0), rect(0, 1, 1, 1)]);
  assert.equal(getCellValue(vertical, 0, 1), "gone1", "each column's top cell is its anchor");
  assert.equal(getCellValue(vertical, 1, 1), "");
});

test("AUDIT: degenerate merges produce nothing — 1×1, one row sideways, one column down", () => {
  assert.deepEqual(mergeRegionsFor(rect(2, 2, 2, 2), "all"), []);
  assert.deepEqual(mergeRegionsFor(rect(0, 1, 5, 1), "horizontal"), [], "single column");
  assert.deepEqual(mergeRegionsFor(rect(1, 0, 1, 5), "vertical"), [], "single row");
  // But a 1×N "all" merge is real in both directions.
  assert.deepEqual(mergeRegionsFor(rect(0, 0, 0, 2), "all"), [rect(0, 0, 0, 2)]);
  assert.deepEqual(mergeRegionsFor(rect(0, 0, 2, 0), "all"), [rect(0, 0, 2, 0)]);
  const ws = applyMerge(build({ A1: "x" }), rect(0, 0, 0, 0), "all");
  assert.equal(ws.merges, undefined, "no region → worksheet unchanged");
});

test("AUDIT: a new merge REPLACES every existing merge it overlaps — even partially", () => {
  let ws = applyMerge(build({}), rect(0, 0, 0, 2), "all");  // A1:C1
  ws = applyMerge(ws, rect(3, 0, 3, 2), "all");             // A4:C4 (kept)
  // Overlaps only one cell of A1:C1.
  ws = applyMerge(ws, rect(0, 2, 1, 3), "all");             // C1:D2
  assert.equal(ws.merges?.length, 2);
  assert.ok(ws.merges!.some((m) => m.top === 3), "the disjoint merge survives");
  assert.ok(ws.merges!.some((m) => m.left === 2 && m.right === 3), "the new merge is present");
  assert.equal(mergeAt(ws.merges, 0, 0), null, "the partially-overlapped merge is fully gone");
});

test("AUDIT: unmerge by ANY intersecting selection, values stay where they are", () => {
  let ws = applyMerge(build({ A1: "x" }), rect(0, 0, 2, 2), "all");
  // A selection touching one covered (non-anchor) cell unmerges the region.
  ws = removeMerge(ws, rect(2, 2, 2, 2));
  assert.equal(ws.merges, undefined);
  assert.equal(getCellValue(ws, 0, 0), "x", "anchor value stays after unmerge");
});

test("AUDIT: removeMerge leaves non-intersecting merges alone; hasMergeIn agrees", () => {
  let ws = applyMerge(build({}), rect(0, 0, 0, 1), "all");
  ws = applyMerge(ws, rect(5, 5, 6, 6), "all");
  assert.equal(hasMergeIn(ws.merges, rect(0, 0, 4, 4)), true);
  assert.equal(hasMergeIn(ws.merges, rect(2, 0, 4, 4)), false);
  ws = removeMerge(ws, rect(2, 0, 4, 4)); // touches nothing
  assert.equal(ws.merges?.length, 2, "no-op removal keeps both merges");
});

test("AUDIT: expandRangeOverMerges chains across merges until stable", () => {
  // Two merges that do not touch each other, both touched via growth:
  //   M1 = A1:B2, M2 = B4:B5. Selecting B2:B4 touches M1 (B2) and M2 (B4);
  //   containing both needs A1:B5.
  let ws = applyMerge(build({}), rect(0, 0, 1, 1), "all");
  ws = applyMerge(ws, rect(3, 1, 4, 1), "all");
  const grown = expandRangeOverMerges(ws.merges, rect(1, 1, 3, 1));
  assert.deepEqual(grown, rect(0, 0, 4, 1));
  // And the grown rect really contains every cell of both merges.
  for (const m of ws.merges!) {
    for (let r = m.top; r <= m.bottom; r++)
      for (let c = m.left; c <= m.right; c++)
        assert.ok(rectContains(grown, r, c), `(${r},${c}) inside the grown selection`);
  }
});

test("AUDIT: a selection clear of every merge is returned unchanged", () => {
  const ws = applyMerge(build({}), rect(0, 0, 1, 1), "all");
  assert.deepEqual(expandRangeOverMerges(ws.merges, rect(5, 5, 6, 6)), rect(5, 5, 6, 6));
  assert.deepEqual(expandRangeOverMerges(undefined, rect(1, 1, 2, 2)), rect(1, 1, 2, 2));
});

test("AUDIT: re-merging the same region twice is stable — one region, values intact", () => {
  let ws = applyMerge(build({ A1: "keep" }), rect(0, 0, 1, 1), "all");
  ws = applyMerge(ws, rect(0, 0, 1, 1), "all");
  assert.equal(ws.merges?.length, 1);
  assert.equal(getCellValue(ws, 0, 0), "keep");
});
