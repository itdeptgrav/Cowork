import assert from "node:assert/strict";
import { test } from "node:test";
import { mapLineIndex, shiftBands, shiftRanged, shiftRect, shiftRects, shiftRefMap } from "./structureExtras";

test("a line index moves down past an insertion and up past a deletion, or vanishes", () => {
  assert.equal(mapLineIndex(5, { axis: "row", at: 2, count: 2, mode: "insert" }), 7);
  assert.equal(mapLineIndex(1, { axis: "row", at: 2, count: 2, mode: "insert" }), 1);
  assert.equal(mapLineIndex(5, { axis: "row", at: 2, count: 2, mode: "delete" }), 3);
  assert.equal(mapLineIndex(2, { axis: "row", at: 2, count: 2, mode: "delete" }), null);
});

test("rectangles move, stretch, shrink and disappear with the band", () => {
  const rect = { top: 4, left: 1, bottom: 8, right: 3 };
  assert.deepEqual(shiftRect(rect, { axis: "row", at: 0, count: 2, mode: "insert" }), { top: 6, left: 1, bottom: 10, right: 3 });
  assert.deepEqual(shiftRect(rect, { axis: "row", at: 6, count: 1, mode: "insert" }), { top: 4, left: 1, bottom: 9, right: 3 }, "inside: grows");
  assert.deepEqual(shiftRect(rect, { axis: "row", at: 5, count: 2, mode: "delete" }), { top: 4, left: 1, bottom: 6, right: 3 }, "inside: shrinks");
  assert.deepEqual(shiftRect(rect, { axis: "col", at: 0, count: 1, mode: "delete" }), { top: 4, left: 0, bottom: 8, right: 2 });
  assert.equal(shiftRect(rect, { axis: "row", at: 4, count: 5, mode: "delete" }), null, "wholly deleted");
});

test("ranged rules, merges and ref-keyed maps follow the cells", () => {
  const rules = [{ range: { top: 0, left: 0, bottom: 2, right: 0 }, kind: "a" }, { range: { top: 5, left: 0, bottom: 5, right: 0 }, kind: "b" }];
  const shifted = shiftRanged(rules, { axis: "row", at: 5, count: 1, mode: "delete" });
  assert.deepEqual(shifted, [{ range: { top: 0, left: 0, bottom: 2, right: 0 }, kind: "a" }], "the deleted rule is gone");

  const merges = [{ top: 1, left: 1, bottom: 1, right: 2 }, { top: 3, left: 0, bottom: 4, right: 0 }];
  assert.deepEqual(shiftRects(merges, { axis: "col", at: 2, count: 1, mode: "delete" }), [{ top: 3, left: 0, bottom: 4, right: 0 }], "a merge cut to one cell is no merge");
  assert.deepEqual(shiftRects(merges, { axis: "row", at: 0, count: 1, mode: "insert" }), [{ top: 2, left: 1, bottom: 2, right: 2 }, { top: 4, left: 0, bottom: 5, right: 0 }]);

  const comments = { A1: "first", B3: "third", C5: "fifth" };
  assert.deepEqual(shiftRefMap(comments, { axis: "row", at: 1, count: 2, mode: "insert" }), { A1: "first", B5: "third", C7: "fifth" });
  assert.deepEqual(shiftRefMap(comments, { axis: "row", at: 2, count: 1, mode: "delete" }), { A1: "first", C4: "fifth" });
  assert.equal(shiftRefMap({ A1: "x" }, { axis: "row", at: 0, count: 1, mode: "delete" }), undefined);
});

test("outline bands move only with their own axis", () => {
  const bands = [{ from: 2, to: 5 }, { from: 8, to: 9, collapsed: true }];
  assert.deepEqual(shiftBands(bands, { axis: "row", at: 0, count: 1, mode: "insert" }, "row"), [{ from: 3, to: 6 }, { from: 9, to: 10, collapsed: true }]);
  assert.deepEqual(shiftBands(bands, { axis: "col", at: 0, count: 1, mode: "insert" }, "row"), bands, "a column edit leaves row bands alone");
  assert.deepEqual(shiftBands(bands, { axis: "row", at: 8, count: 2, mode: "delete" }, "row"), [{ from: 2, to: 5 }], "a deleted band is gone");
  assert.equal(shiftBands(undefined, { axis: "row", at: 0, count: 1, mode: "insert" }, "row"), undefined);
});
