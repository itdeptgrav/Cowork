import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCellRef, type Rect } from "@/lib/spreadsheet/coordinates";
import { createWorksheet, getCellValue, setCellValue, type Worksheet } from "@/lib/spreadsheet/model";
import {
  applyMerge,
  expandRangeOverMerges,
  hasMergeIn,
  isMergeAnchor,
  mergeAt,
  mergeRegionsFor,
  removeMerge,
} from "@/lib/spreadsheet/merge";

const rect = (t: number, l: number, b: number, r: number): Rect => ({ top: t, left: l, bottom: b, right: r });

function build(cells: Record<string, string>): Worksheet {
  let ws = createWorksheet("s", "Sheet1");
  for (const [ref, value] of Object.entries(cells)) {
    const p = parseCellRef(ref)!;
    ws = setCellValue(ws, p.row, p.col, value);
  }
  return ws;
}

test("merge all makes one region spanning the selection", () => {
  const regions = mergeRegionsFor(rect(0, 0, 1, 2), "all");
  assert.equal(regions.length, 1);
  assert.deepEqual(regions[0], rect(0, 0, 1, 2));
});

test("merge horizontal makes one strip per row", () => {
  const regions = mergeRegionsFor(rect(0, 0, 2, 1), "horizontal");
  assert.equal(regions.length, 3);
  assert.deepEqual(regions, [rect(0, 0, 0, 1), rect(1, 0, 1, 1), rect(2, 0, 2, 1)]);
});

test("merge vertical makes one strip per column", () => {
  const regions = mergeRegionsFor(rect(0, 0, 1, 2), "vertical");
  assert.equal(regions.length, 3);
  assert.deepEqual(regions, [rect(0, 0, 1, 0), rect(0, 1, 1, 1), rect(0, 2, 1, 2)]);
});

test("a degenerate merge (nothing to span) produces no region", () => {
  assert.deepEqual(mergeRegionsFor(rect(0, 0, 0, 0), "all"), []);
  assert.deepEqual(mergeRegionsFor(rect(0, 0, 2, 0), "horizontal"), []); // single column
  assert.deepEqual(mergeRegionsFor(rect(0, 0, 0, 2), "vertical"), []); // single row
});

test("applyMerge keeps the anchor value and clears the cells it swallows", () => {
  const ws = build({ A1: "keep", B1: "gone", A2: "also gone" });
  const next = applyMerge(ws, rect(0, 0, 1, 1), "all");
  assert.equal(getCellValue(next, 0, 0), "keep");
  assert.equal(getCellValue(next, 0, 1), "");
  assert.equal(getCellValue(next, 1, 0), "");
  assert.equal(next.merges?.length, 1);
});

test("mergeAt finds the region over a covered cell, and the anchor is the top-left", () => {
  const ws = applyMerge(build({ A1: "x" }), rect(0, 0, 1, 2), "all");
  const m = mergeAt(ws.merges, 1, 2);
  assert.ok(m);
  assert.deepEqual(m, rect(0, 0, 1, 2));
  assert.equal(isMergeAnchor(m!, 0, 0), true);
  assert.equal(isMergeAnchor(m!, 1, 2), false);
  assert.equal(mergeAt(ws.merges, 5, 5), null);
});

test("a new merge replaces one it overlaps", () => {
  let ws = applyMerge(build({}), rect(0, 0, 0, 1), "all");
  ws = applyMerge(ws, rect(0, 0, 1, 2), "all");
  assert.equal(ws.merges?.length, 1);
  assert.deepEqual(ws.merges?.[0], rect(0, 0, 1, 2));
});

test("removeMerge drops merges intersecting the range, and leaves others", () => {
  let ws = applyMerge(build({}), rect(0, 0, 0, 1), "all");
  ws = applyMerge(ws, rect(5, 0, 5, 1), "all");
  assert.equal(hasMergeIn(ws.merges, rect(0, 0, 0, 0)), true);
  ws = removeMerge(ws, rect(0, 0, 0, 0));
  assert.equal(ws.merges?.length, 1);
  assert.deepEqual(ws.merges?.[0], rect(5, 0, 5, 1));
});

test("removeMerge on the last merge clears the field", () => {
  let ws = applyMerge(build({}), rect(0, 0, 0, 1), "all");
  ws = removeMerge(ws, rect(0, 0, 0, 1));
  assert.equal(ws.merges, undefined);
});

test("expandRangeOverMerges grows a selection to contain every merge it touches", () => {
  const ws = applyMerge(build({}), rect(0, 0, 1, 2), "all");
  // A single cell inside the merge expands to the whole merge.
  assert.deepEqual(expandRangeOverMerges(ws.merges, rect(1, 2, 1, 2)), rect(0, 0, 1, 2));
  // A selection clear of the merge is unchanged.
  assert.deepEqual(expandRangeOverMerges(ws.merges, rect(5, 5, 5, 5)), rect(5, 5, 5, 5));
});
