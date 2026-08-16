import assert from "node:assert/strict";
import { test } from "node:test";
import {
  columnLabel,
  columnIndex,
  cellRef,
  parseCellRef,
  parseRange,
  normalizeRange,
  rangeLabel,
  isSingleCell,
  rectContains,
} from "@/lib/spreadsheet/coordinates";

test("columnLabel: column number → column name", () => {
  assert.equal(columnLabel(0), "A");
  assert.equal(columnLabel(1), "B");
  assert.equal(columnLabel(25), "Z");
  assert.equal(columnLabel(26), "AA");
  assert.equal(columnLabel(27), "AB");
  assert.equal(columnLabel(51), "AZ");
  assert.equal(columnLabel(52), "BA");
  assert.equal(columnLabel(701), "ZZ");
  assert.equal(columnLabel(702), "AAA");
});

test("columnIndex: column name → column number", () => {
  assert.equal(columnIndex("A"), 0);
  assert.equal(columnIndex("B"), 1);
  assert.equal(columnIndex("Z"), 25);
  assert.equal(columnIndex("AA"), 26);
  assert.equal(columnIndex("AB"), 27);
  assert.equal(columnIndex("ZZ"), 701);
  assert.equal(columnIndex("AAA"), 702);
  assert.equal(columnIndex("aa"), 26, "case-insensitive");
  assert.equal(columnIndex("A1"), -1, "not a pure column label");
  assert.equal(columnIndex(""), -1);
});

test("columnLabel and columnIndex are inverses", () => {
  for (const i of [0, 1, 25, 26, 27, 100, 701, 702, 1000]) {
    assert.equal(columnIndex(columnLabel(i)), i);
  }
});

test("parseCellRef: cell coordinate parsing", () => {
  assert.deepEqual(parseCellRef("A1"), { row: 0, col: 0 });
  assert.deepEqual(parseCellRef("C500"), { row: 499, col: 2 });
  assert.deepEqual(parseCellRef("AA10"), { row: 9, col: 26 });
  assert.deepEqual(parseCellRef(" B2 "), { row: 1, col: 1 }, "trims");
  assert.deepEqual(parseCellRef("$C$3"), { row: 2, col: 2 }, "tolerates $ anchors");
  assert.equal(parseCellRef("A0"), null, "rows are 1-based");
  assert.equal(parseCellRef("1A"), null);
  assert.equal(parseCellRef("A"), null);
  assert.equal(parseCellRef(""), null);
});

test("cellRef and parseCellRef round-trip", () => {
  for (const [r, c] of [
    [0, 0],
    [499, 2],
    [9, 26],
    [999, 99],
  ] as const) {
    assert.deepEqual(parseCellRef(cellRef(r, c)), { row: r, col: c });
  }
});

test("parseRange: range parsing", () => {
  assert.deepEqual(parseRange("A1:C5"), { top: 0, left: 0, bottom: 4, right: 2 });
  assert.deepEqual(
    parseRange("C5:A1"),
    { top: 0, left: 0, bottom: 4, right: 2 },
    "normalises reversed corners",
  );
  assert.deepEqual(parseRange("B2"), { top: 1, left: 1, bottom: 1, right: 1 });
  assert.equal(parseRange("A1:"), null);
  assert.equal(parseRange("A1:B2:C3"), null);
  assert.equal(parseRange("nope"), null);
});

test("normalizeRange orders any two corners", () => {
  assert.deepEqual(
    normalizeRange({ row: 4, col: 2 }, { row: 0, col: 0 }),
    { top: 0, left: 0, bottom: 4, right: 2 },
  );
});

test("rangeLabel and isSingleCell", () => {
  assert.equal(rangeLabel({ top: 0, left: 0, bottom: 4, right: 2 }), "A1:C5");
  assert.equal(rangeLabel({ top: 1, left: 1, bottom: 1, right: 1 }), "B2");
  assert.equal(isSingleCell({ top: 1, left: 1, bottom: 1, right: 1 }), true);
  assert.equal(isSingleCell({ top: 0, left: 0, bottom: 4, right: 2 }), false);
});

test("rectContains", () => {
  const r = { top: 1, left: 1, bottom: 3, right: 3 };
  assert.equal(rectContains(r, 2, 2), true);
  assert.equal(rectContains(r, 1, 1), true);
  assert.equal(rectContains(r, 0, 2), false);
  assert.equal(rectContains(r, 4, 2), false);
});
