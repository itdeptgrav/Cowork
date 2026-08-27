/**
 * CSV IO audit — adversarial round trips.
 *
 * Exercises the parser/serializer pair on the awkward inputs a real CSV brings:
 * embedded commas, quotes, newlines, CRLF/LF/CR mixes, unicode, leading zeros,
 * ragged and gappy grids, and degenerate one-cell / empty files. Assertions
 * state CORRECT behaviour; a failing assertion is tagged `// BUG(...)`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { getCellValue } from "@/lib/spreadsheet/model";
import {
  csvPositions,
  csvToWorksheet,
  parseCsv,
  serializeCsv,
  worksheetToCsv,
} from "@/lib/spreadsheet/csvio";

test("AUDIT: serialize→parse round-trips every quoting hazard at once", () => {
  const rows = [
    ["plain", "comma,inside", 'quote"inside', 'both",and,"here'],
    ['starts with "', 'ends with "', '""', '","'],
    ["line\nbreak", "crlf\r\ninside", "\r", "trailing space "],
    ["", " ", "  double  spaced  ", "\t tab kept"],
  ];
  assert.deepEqual(parseCsv(serializeCsv(rows)), rows);
});

test("AUDIT: leading zeros and number-like text survive as their exact text", () => {
  const rows = [["007", "0.50", "1e5", "-0", "01/02", "1,000"]];
  const back = parseCsv(serializeCsv(rows));
  assert.deepEqual(back, rows, "the CSV layer never reinterprets a field's text");

  // Through a worksheet: the raw store keeps the exact text too.
  const ws = csvToWorksheet("s", "S", serializeCsv(rows));
  assert.equal(getCellValue(ws, 0, 0), "007", "a leading zero is not normalised away");
  assert.equal(getCellValue(ws, 0, 5), "1,000", "a thousands-separated field stays text");
});

test("AUDIT: CRLF, LF and lone CR files parse to the same grid", () => {
  const lf = "a,b\nc,d\ne,f";
  const crlf = "a,b\r\nc,d\r\ne,f";
  const cr = "a,b\rc,d\re,f";
  const expected = [
    ["a", "b"],
    ["c", "d"],
    ["e", "f"],
  ];
  assert.deepEqual(parseCsv(lf), expected);
  assert.deepEqual(parseCsv(crlf), expected);
  assert.deepEqual(parseCsv(cr), expected);
});

test("AUDIT: trailing terminators add no row; interior blank lines are real rows", () => {
  assert.deepEqual(parseCsv("a\n"), [["a"]]);
  assert.deepEqual(parseCsv("a\r\n"), [["a"]]);
  // An interior empty line IS a row of one empty field.
  assert.deepEqual(parseCsv("a\n\nb"), [["a"], [""], ["b"]]);
  // A file that is just a terminator is one empty record.
  assert.deepEqual(parseCsv("\n"), [[""]]);
});

test("AUDIT: trailing empty fields survive a round trip", () => {
  const rows = [
    ["a", "", ""],
    ["", "", ""],
    ["", "", "z"],
  ];
  assert.equal(serializeCsv(rows), "a,,\r\n,,\r\n,,z");
  assert.deepEqual(parseCsv(serializeCsv(rows)), rows);
});

test("AUDIT: a quoted field containing CRLF keeps both characters", () => {
  const rows = [["before\r\nafter", "x"]];
  const csv = serializeCsv(rows);
  assert.deepEqual(parseCsv(csv), rows);
});

test("AUDIT: unicode — emoji, CJK, combining marks and RTL round-trip", () => {
  const rows = [["🚀🌍", "漢字テスト", "é combining", "مرحبا", "Ω≈ç√"]];
  assert.deepEqual(parseCsv(serializeCsv(rows)), rows);
  // With a BOM prepended (another tool's export), the first field is unharmed.
  assert.deepEqual(parseCsv("﻿" + serializeCsv(rows)), rows);
});

test("AUDIT: an unterminated quote is read leniently, never thrown on", () => {
  assert.deepEqual(parseCsv('a,"unclosed'), [["a", "unclosed"]]);
  assert.deepEqual(parseCsv('"'), [[""]]);
});

test("AUDIT: empty file → no rows, no cells; single cell → 1×1", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(csvPositions(""), []);
  const one = csvToWorksheet("s", "S", "only");
  assert.equal(getCellValue(one, 0, 0), "only");
  assert.equal(worksheetToCsv(one, (r, c) => getCellValue(one, r, c)), "only");
});

test("AUDIT: export writes the DISPLAYED value, so formulas export their results", () => {
  const ws = csvToWorksheet("s", "S", "=1+1,raw");
  assert.equal(getCellValue(ws, 0, 0), "=1+1", "import keeps the formula raw");
  // The caller supplies computed values; the formula cell exports its result.
  const csv = worksheetToCsv(ws, (r, c) => {
    const raw = getCellValue(ws, r, c);
    return raw === "=1+1" ? "2" : raw;
  });
  assert.equal(csv, "2,raw");
});

test("AUDIT: import of the exported computed value no longer carries the formula", () => {
  // Round trip through DISPLAYED values loses formulas by design: CSV has no
  // formula column. Assert the documented behaviour so a change is noticed.
  const first = csvToWorksheet("s", "S", "=2*3");
  const csv = worksheetToCsv(first, () => "6");
  const second = csvToWorksheet("s2", "S2", csv);
  assert.equal(getCellValue(second, 0, 0), "6");
});

test("AUDIT: a gappy sheet exports a full rectangle with empty fields", () => {
  let ws = csvToWorksheet("s", "S", "");
  // Place A1 and C3 only.
  ws = { ...ws, cells: { A1: { value: "x" }, C3: { value: "y" } } };
  const csv = worksheetToCsv(ws, (r, c) => ws.cells[`${"ABC"[c]}${r + 1}`]?.value ?? "");
  assert.equal(csv, "x,,\r\n,,\r\n,,y");
  // And that rectangle round-trips.
  assert.deepEqual(parseCsv(csv), [
    ["x", "", ""],
    ["", "", ""],
    ["", "", "y"],
  ]);
});

test("AUDIT: ragged rows place what each row has; the sheet sizes to the widest", () => {
  const ws = csvToWorksheet("s", "S", "a\nb,c,d\ne,f");
  assert.equal(getCellValue(ws, 0, 0), "a");
  assert.equal(getCellValue(ws, 1, 2), "d");
  assert.equal(getCellValue(ws, 2, 1), "f");
  assert.equal(getCellValue(ws, 0, 2), "", "a short row leaves its tail empty");
});

test("AUDIT: a long and wide import grows the sheet beyond the defaults", () => {
  // 1200 rows (default is 1000) and 120 columns (default is 100).
  const wide = Array.from({ length: 120 }, (_, c) => `c${c}`).join(",");
  const text = Array.from({ length: 1200 }, () => wide).join("\n");
  const ws = csvToWorksheet("s", "S", text);
  assert.equal(ws.rowCount, 1200);
  assert.equal(ws.colCount, 120);
  assert.equal(getCellValue(ws, 1199, 119), "c119");
  // Round trip integrity on the far corner and a middle cell.
  const back = parseCsv(worksheetToCsv(ws, (r, c) => getCellValue(ws, r, c)));
  assert.equal(back.length, 1200);
  assert.equal(back[600][60], "c60");
});

test("AUDIT: fields that LOOK like CSV syntax round-trip as data", () => {
  const rows = [['a,b', '"quoted"', "=SUM(A1:B2)", "\r\n", ","]];
  const back = parseCsv(serializeCsv(rows));
  assert.deepEqual(back, rows);
});
