import assert from "node:assert/strict";
import { test } from "node:test";
import { getCellValue } from "@/lib/spreadsheet/model";
import {
  csvToWorksheet,
  parseCsv,
  serializeCsv,
  worksheetToCsv,
} from "@/lib/spreadsheet/csvio";

test("parses simple rows and columns", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2,3"), [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("handles commas inside quoted fields", () => {
  assert.deepEqual(parseCsv('name,note\n"Smith, John","a, b, c"'), [
    ["name", "note"],
    ["Smith, John", "a, b, c"],
  ]);
});

test("handles doubled quotes as an escaped quote", () => {
  assert.deepEqual(parseCsv('"she said ""hi""",plain'), [['she said "hi"', "plain"]]);
});

test("handles line breaks inside quoted fields", () => {
  assert.deepEqual(parseCsv('"line1\nline2",next'), [["line1\nline2", "next"]]);
});

test("treats CRLF, LF and a lone CR as row terminators, with no trailing blank row", () => {
  assert.deepEqual(parseCsv("a,b\r\nc,d\r\n"), [
    ["a", "b"],
    ["c", "d"],
  ]);
  assert.deepEqual(parseCsv("a\rb"), [["a"], ["b"]]);
});

test("strips a leading UTF-8 BOM and keeps unicode intact", () => {
  assert.deepEqual(parseCsv("﻿é,漢字,🚀"), [["é", "漢字", "🚀"]]);
  // Without a BOM, unicode still passes through untouched.
  assert.deepEqual(parseCsv("é,漢字,🚀"), [["é", "漢字", "🚀"]]);
});

test("empty input parses to no rows; a trailing comma is an empty final field", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("a,"), [["a", ""]]);
});

test("serializeCsv quotes only fields that need it and doubles quotes", () => {
  const csv = serializeCsv([
    ["plain", "has,comma", 'has"quote', "has\nbreak"],
    ["1000", "", "x"],
  ]);
  assert.equal(csv, 'plain,"has,comma","has""quote","has\nbreak"\r\n1000,,x');
});

test("serialize→parse round-trips awkward values", () => {
  const rows = [
    ["Smith, John", 'a "quoted" phrase', "line1\nline2"],
    ["42", "", "trailing "],
  ];
  assert.deepEqual(parseCsv(serializeCsv(rows)), rows);
});

test("csvToWorksheet places raw values, preserving numbers and making a leading = a formula", () => {
  const ws = csvToWorksheet("s", "Imported", "Item,Qty\napple,3\n=1+1,text");
  assert.equal(getCellValue(ws, 0, 0), "Item");
  assert.equal(getCellValue(ws, 1, 1), "3"); // number kept as its text
  assert.equal(getCellValue(ws, 2, 0), "=1+1"); // becomes a formula
});

test("worksheetToCsv writes the used range using the supplied displayed values", () => {
  const ws = csvToWorksheet("s", "S", "a,b\nc,d");
  // A displayer that up:cases, to prove export uses valueAt not the raw store.
  const csv = worksheetToCsv(ws, (r, c) => getCellValue(ws, r, c).toUpperCase());
  assert.equal(csv, "A,B\r\nC,D");
});

test("worksheetToCsv on an empty sheet is the empty string", () => {
  const ws = csvToWorksheet("s", "S", "");
  assert.equal(worksheetToCsv(ws, () => ""), "");
});
