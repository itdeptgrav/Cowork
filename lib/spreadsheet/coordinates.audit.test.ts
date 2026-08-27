/**
 * Coordinates audit — A1 addressing at its boundaries.
 *
 * Adversarial cases against the pure addressing layer: bijective base-26 at
 * every carry boundary (Z→AA, AZ→BA, ZZ→AAA), `$`-anchored parses, refs that
 * must be rejected, and ranges given corner-to-corner in every order. The
 * reference semantics are Google Sheets / Excel A1 notation.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cellRef,
  columnIndex,
  columnLabel,
  isSingleCell,
  normalizeRange,
  parseCellRef,
  parseRange,
  rangeLabel,
  rectArea,
  rectContains,
} from "@/lib/spreadsheet/coordinates";

test("AUDIT: column labels at every base-26 carry boundary", () => {
  const cases: [number, string][] = [
    [0, "A"],
    [25, "Z"],
    [26, "AA"],       // the first carry — bijective base-26, no digit zero
    [51, "AZ"],
    [52, "BA"],
    [77, "BZ"],
    [701, "ZZ"],
    [702, "AAA"],     // the second carry
    [703, "AAB"],
    [1377, "AZZ"],
    [1378, "BAA"],
    [16383, "XFD"],   // Excel's last column
  ];
  for (const [index, label] of cases) {
    assert.equal(columnLabel(index), label, `columnLabel(${index})`);
    assert.equal(columnIndex(label), index, `columnIndex(${label})`);
  }
});

test("AUDIT: columnLabel/columnIndex round-trip densely through both carries", () => {
  for (let i = 0; i <= 800; i++) {
    assert.equal(columnIndex(columnLabel(i)), i, `round trip at ${i}`);
  }
});

test("AUDIT: columnLabel rejects garbage rather than inventing a label", () => {
  assert.equal(columnLabel(-1), "");
  assert.equal(columnLabel(1.5), "");
  assert.equal(columnLabel(Number.NaN), "");
});

test("AUDIT: columnIndex rejects anything that is not pure letters", () => {
  for (const bad of ["", "A1", "1", "$A", "A$", "A A", " A", "A-"]) {
    assert.equal(columnIndex(bad), -1, `columnIndex(${JSON.stringify(bad)})`);
  }
  assert.equal(columnIndex("aa"), 26, "lowercase is the same column");
});

test("AUDIT: parseCellRef accepts all four $-anchor shapes at the same position", () => {
  // $ anchors are copy-time semantics only; the position is identical.
  for (const ref of ["B2", "$B2", "B$2", "$B$2"]) {
    assert.deepEqual(parseCellRef(ref), { row: 1, col: 1 }, ref);
  }
});

test("AUDIT: parseCellRef rejects invalid refs as null, never a wrong position", () => {
  const invalid = [
    "A0",      // rows are 1-based
    "0",
    "1A",      // digits before letters
    "A",       // no row
    "1",       // no column
    "",
    " ",
    "$",
    "$$A$1",   // doubled anchor
    "A-1",
    "A1.5",
    "A 1",     // interior space
    "A1B",     // trailing letters
    "!A1",
  ];
  for (const ref of invalid) {
    assert.equal(parseCellRef(ref), null, `parseCellRef(${JSON.stringify(ref)})`);
  }
});

test("AUDIT: parseCellRef trims, tolerates case, and keeps leading-zero rows", () => {
  assert.deepEqual(parseCellRef("  c3  "), { row: 2, col: 2 });
  // "A016" is how the name box treats it: row 16.
  assert.deepEqual(parseCellRef("A016"), { row: 15, col: 0 });
});

test("AUDIT: cellRef/parseCellRef round-trip at grid corners", () => {
  for (const [r, c] of [
    [0, 0],
    [0, 25],
    [0, 26],
    [999, 0],
    [999, 99],
    [0, 701],
    [0, 702],
    [1048575, 16383], // Excel's bottom-right XFD1048576
  ] as const) {
    assert.deepEqual(parseCellRef(cellRef(r, c)), { row: r, col: c }, cellRef(r, c));
  }
});

test("AUDIT: normalizeRange orders every corner-to-corner pairing identically", () => {
  const expected = { top: 1, left: 1, bottom: 4, right: 3 };
  const tl = { row: 1, col: 1 };
  const tr = { row: 1, col: 3 };
  const bl = { row: 4, col: 1 };
  const br = { row: 4, col: 3 };
  // Dragging between any two opposite corners spans the same rectangle.
  assert.deepEqual(normalizeRange(tl, br), expected);
  assert.deepEqual(normalizeRange(br, tl), expected);
  assert.deepEqual(normalizeRange(tr, bl), expected);
  assert.deepEqual(normalizeRange(bl, tr), expected);
});

test("AUDIT: parseRange accepts a range typed corner-to-corner in any order", () => {
  const expected = { top: 2, left: 1, bottom: 6, right: 3 };
  for (const text of ["B3:D7", "D7:B3", "B7:D3", "D3:B7"]) {
    assert.deepEqual(parseRange(text), expected, text);
  }
});

test("AUDIT: parseRange of a single ref is a one-cell rect; invalid text is null", () => {
  assert.deepEqual(parseRange("B2"), { top: 1, left: 1, bottom: 1, right: 1 });
  assert.deepEqual(parseRange("$B$2"), { top: 1, left: 1, bottom: 1, right: 1 });
  assert.deepEqual(parseRange(" A1 : B2 "), { top: 0, left: 0, bottom: 1, right: 1 });
  for (const bad of ["A1:", ":A1", ":", "A1::B2", "A1:B2:C3", "A0:B2", "A1:2B", "nope", ""]) {
    assert.equal(parseRange(bad), null, `parseRange(${JSON.stringify(bad)})`);
  }
});

test("AUDIT: rangeLabel round-trips through parseRange", () => {
  const rects = [
    { top: 0, left: 0, bottom: 0, right: 0 },
    { top: 1, left: 1, bottom: 4, right: 3 },
    { top: 0, left: 26, bottom: 9, right: 701 },
  ];
  for (const rect of rects) {
    assert.deepEqual(parseRange(rangeLabel(rect)), rect, rangeLabel(rect));
  }
  assert.equal(rangeLabel({ top: 0, left: 26, bottom: 9, right: 701 }), "AA1:ZZ10");
});

test("AUDIT: rectContains is inclusive of all four edges, exclusive just outside", () => {
  const r = { top: 2, left: 3, bottom: 5, right: 7 };
  // Every corner is inside.
  assert.equal(rectContains(r, 2, 3), true);
  assert.equal(rectContains(r, 2, 7), true);
  assert.equal(rectContains(r, 5, 3), true);
  assert.equal(rectContains(r, 5, 7), true);
  // One step outside each edge is not.
  assert.equal(rectContains(r, 1, 5), false);
  assert.equal(rectContains(r, 6, 5), false);
  assert.equal(rectContains(r, 3, 2), false);
  assert.equal(rectContains(r, 3, 8), false);
});

test("AUDIT: rectArea and isSingleCell at the degenerate sizes", () => {
  assert.equal(rectArea({ top: 0, left: 0, bottom: 0, right: 0 }), 1);
  assert.equal(rectArea({ top: 0, left: 0, bottom: 0, right: 4 }), 5);
  assert.equal(rectArea({ top: 2, left: 3, bottom: 5, right: 7 }), 20);
  assert.equal(isSingleCell({ top: 3, left: 3, bottom: 3, right: 3 }), true);
  assert.equal(isSingleCell({ top: 3, left: 3, bottom: 3, right: 4 }), false);
});
