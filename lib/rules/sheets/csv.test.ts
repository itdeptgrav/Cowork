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

test("writeCsv quotes a field containing a comma", () => {
  const csv = writeCsv(sheetFromGrid([["hello, world", "b"]]));
  assert.equal(csv, `"hello, world",b`);
});

test("writeCsv quotes a field containing a newline, keeping it literal inside the quotes", () => {
  const csv = writeCsv(sheetFromGrid([["line1\nline2", "b"]]));
  assert.equal(csv, `"line1\nline2",b`);
});

test("writeCsv doubles an embedded quote", () => {
  const csv = writeCsv(sheetFromGrid([[`He said "hi"`, "b"]]));
  assert.equal(csv, `"He said ""hi""",b`);
});

test("writeCsv exports only the used range, not the whole sheet", () => {
  const csv = writeCsv(sheetFromGrid([["a", "b"], ["c", "d"]]));
  assert.equal(csv, "a,b\r\nc,d");
});

test("writeCsv of an empty sheet is an empty string", () => {
  assert.equal(writeCsv({ cells: {}, styles: {}, rows: 50, cols: 20 }), "");
});

test("readCsv parses a quoted field containing a literal comma", () => {
  const rows = readCsv(`"hello, world",b`);
  assert.deepEqual(rows, [["hello, world", "b"]]);
});

test("readCsv parses a quoted field containing a literal newline", () => {
  const rows = readCsv(`"line1\nline2",b`);
  assert.deepEqual(rows, [["line1\nline2", "b"]]);
});

test("readCsv unescapes a doubled quote inside a quoted field", () => {
  const rows = readCsv(`"He said ""hi""",b`);
  assert.deepEqual(rows, [[`He said "hi"`, "b"]]);
});

test("readCsv handles CRLF, bare LF and a missing trailing newline alike", () => {
  assert.deepEqual(readCsv("a,b\r\nc,d"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(readCsv("a,b\nc,d"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(readCsv("a,b\nc,d\n"), [["a", "b"], ["c", "d"]]);
});

test("round-trip: writeCsv then readCsv returns the original 2D array", () => {
  const original = [
    ["Name", "Notes", "Amount"],
    ["Ada, Lovelace", 'Said "hello"', "10"],
    ["Line one\nLine two", "", "20"],
  ];
  const roundTripped = readCsv(writeCsv(sheetFromGrid(original)));
  assert.deepEqual(roundTripped, original);
});
