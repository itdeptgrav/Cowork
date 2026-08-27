/**
 * Adversarial audit of `csv.ts` — RFC 4180 corners the happy-path tests skip:
 * lone empty quoted fields, CRLF inside quotes, trailing delimiters, quote
 * torture, and full round trips. The lone-quoted-empty-field cases pinned a
 * real final-flush bug when first written; fixed, and kept to keep it so.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readCsv, writeCsv } from "./csv.ts";
import { cellRef, type CellMap, type SheetData } from "./grid.ts";

function sheetFromGrid(grid: string[][]): SheetData {
  const cells: CellMap = {};
  grid.forEach((row, r) =>
    row.forEach((value, c) => {
      if (value !== "") cells[cellRef(r, c)] = value;
    }),
  );
  return { cells, styles: {}, rows: 50, cols: 20 };
}

test("a record that is a single quoted empty field is one row, not zero", () => {
  /* RFC 4180: `""` is a record containing one field whose value is empty.
     After consuming it, `field === ""` and `row.length === 0` — exactly the
     state a row break leaves behind — so the parser has to remember the field
     was STARTED to flush it at end of text. */
  assert.deepEqual(readCsv('""'), [[""]]);
});

test("a trailing quoted-empty-only line is not silently dropped", () => {
  assert.deepEqual(readCsv('a\n""'), [["a"], [""]]);
});

test("a quoted empty field is kept when a neighbour anchors the row", () => {
  /* The easy cases — a neighbouring field or delimiter anchors the row, so
     these never depended on the end-of-text flush. */
  assert.deepEqual(readCsv('a,""'), [["a", ""]]);
  assert.deepEqual(readCsv('"",a'), [["", "a"]]);
});

test("a trailing comma is a real trailing empty field", () => {
  assert.deepEqual(readCsv("a,"), [["a", ""]]);
  assert.deepEqual(readCsv("a,b,\nc,d,"), [["a", "b", ""], ["c", "d", ""]]);
});

test("CRLF inside quotes is literal; CRLF outside is one row break, not two", () => {
  assert.deepEqual(readCsv('"a\r\nb",c'), [["a\r\nb", "c"]]);
  assert.deepEqual(readCsv("a\r\nb"), [["a"], ["b"]]);
  assert.deepEqual(readCsv("a\rb"), [["a"], ["b"]], "bare CR is a row break too");
});

test("quote torture: doubled quotes, quotes mid-field, adjacent quoted fields", () => {
  assert.deepEqual(readCsv('""""'), [['"']], "four quotes = one escaped quote");
  assert.deepEqual(readCsv('"a""b","c"'), [['a"b', "c"]]);
  assert.deepEqual(readCsv('"a","b"'), [["a", "b"]]);
});

test("writeCsv leaves leading/trailing spaces alone — they are data", () => {
  const csv = writeCsv(sheetFromGrid([[" padded ", "x"]]));
  assert.equal(csv, " padded ,x");
  assert.deepEqual(readCsv(csv), [[" padded ", "x"]]);
});

test("writeCsv quotes a field containing CR alone", () => {
  const csv = writeCsv(sheetFromGrid([["a\rb"]]));
  assert.equal(csv, '"a\rb"');
  assert.deepEqual(readCsv(csv), [["a\rb"]]);
});

test("used-range export starts at the first used cell, filling interior gaps", () => {
  /* Data at B2 and D3 only: export is the 2×3 box B2:D3, not the sheet. */
  const cells: CellMap = { B2: "x", D3: "y" };
  const csv = writeCsv({ cells, styles: {}, rows: 50, cols: 20 });
  assert.equal(csv, "x,,\r\n,,y");
});

test("a formula's raw text round-trips as typed", () => {
  /* The sheet stores raw text, so CSV export carries the formula string —
     documented storage semantics ("raw, never derived") rather than Excel's
     evaluate-then-export. Pinned so a change here is deliberate. */
  const grid = [["=SUM(A2:A9)", '=IF(A1>0,"yes, sir","no")']];
  assert.deepEqual(readCsv(writeCsv(sheetFromGrid(grid))), grid);
});

test("full round trip over a hostile grid", () => {
  const grid = [
    ["comma, here", 'quote " here', "new\nline"],
    ["", "  spaced  ", "0123"],
    ["trailing,", '""', "€₹ünïcode"],
  ];
  assert.deepEqual(readCsv(writeCsv(sheetFromGrid(grid))), grid);
});
