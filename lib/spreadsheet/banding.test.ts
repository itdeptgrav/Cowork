import assert from "node:assert/strict";
import { test } from "node:test";
import { bandColorAt, readBands, rectsOverlap, shiftBanding, type Banding } from "./banding";

const band: Banding = { id: "b1", range: { top: 2, left: 0, bottom: 7, right: 3 }, header: "#d9dde3", odd: "#ffffff", even: "#f1f3f5" };

test("rows alternate below a header row, and nothing paints outside the range", () => {
  assert.equal(bandColorAt([band], 2, 0), "#d9dde3", "the first row is the header");
  assert.equal(bandColorAt([band], 3, 1), "#ffffff");
  assert.equal(bandColorAt([band], 4, 1), "#f1f3f5");
  assert.equal(bandColorAt([band], 5, 3), "#ffffff");
  assert.equal(bandColorAt([band], 1, 0), undefined);
  assert.equal(bandColorAt([band], 4, 4), undefined);
  assert.equal(bandColorAt([{ ...band, header: undefined }], 2, 0), "#ffffff", "no header: the first row is simply odd");
});

test("stored bands are read defensively", () => {
  assert.deepEqual(readBands([band, { id: "x" }, { id: "y", range: { top: 0, left: 0, bottom: 1, right: 1 }, odd: "red", even: "#ffffff" }]), [band]);
  assert.deepEqual(readBands("nope"), []);
});

test("bands follow inserted and deleted rows", () => {
  assert.deepEqual(shiftBanding([band], { axis: "row", at: 0, count: 2, mode: "insert" })[0].range, { top: 4, left: 0, bottom: 9, right: 3 });
  assert.deepEqual(shiftBanding([band], { axis: "row", at: 3, count: 2, mode: "delete" })[0].range, { top: 2, left: 0, bottom: 5, right: 3 });
  assert.equal(shiftBanding([band], { axis: "row", at: 2, count: 6, mode: "delete" }).length, 0, "a band whose rows all went is gone");
  assert.deepEqual(shiftBanding([band], { axis: "col", at: 1, count: 1, mode: "insert" })[0].range, { top: 2, left: 0, bottom: 7, right: 4 });
});

test("overlap is symmetric and inclusive", () => {
  assert.equal(rectsOverlap(band.range, { top: 7, left: 3, bottom: 9, right: 5 }), true);
  assert.equal(rectsOverlap(band.range, { top: 8, left: 0, bottom: 9, right: 3 }), false);
});
