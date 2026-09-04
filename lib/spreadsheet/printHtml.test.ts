import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCellRef } from "./coordinates";
import { DEFAULT_PAGE_SETUP, escapeHtml, printHtml, readPageSetup, styleToInline, usedRange, type PrintInput } from "./printHtml";

const values: Record<string, string> = { "0,0": "Item", "0,1": "Qty", "1,0": "Pens <b>", "1,1": "12" };
const input: PrintInput = {
  sheetName: "Sheet1",
  workbookTitle: "Stock",
  rect: { top: 0, left: 0, bottom: 1, right: 1 },
  cell: (r, c) => ({ text: values[`${r},${c}`] ?? "", style: r === 0 ? { bold: true } : {}, align: c === 1 && r > 0 ? "right" : "left" }),
  colWidth: () => 100,
  rowHeight: () => 24,
  setup: DEFAULT_PAGE_SETUP,
};

test("the document carries the page rule, the title and every cell, escaped", () => {
  const html = printHtml(input);
  assert.ok(html.includes("@page { size: A4 portrait; margin: 18mm; }"));
  assert.ok(html.includes("<h1>Stock<span>Sheet1</span></h1>"));
  assert.ok(html.includes("Pens &lt;b&gt;"));
  assert.ok(html.includes("font-weight:700"), "the header row is bold");
  assert.ok(html.includes("text-align:right"));
  assert.ok(html.includes("border:1px solid #bbb;"), "gridlines on by default");
  assert.ok(!html.includes("<th"), "no headings by default");
});

test("setup options: landscape, headings, no gridlines, no title, fixed width", () => {
  const html = printHtml({ ...input, setup: { ...DEFAULT_PAGE_SETUP, orientation: "landscape", paper: "Letter", margins: "narrow", headings: true, gridlines: false, title: false, fitToWidth: false } });
  assert.ok(html.includes("size: Letter landscape; margin: 8mm"));
  assert.ok(html.includes("<th style=\"\">A</th>"), "column letters");
  assert.ok(html.includes("<th style=\"\">1</th>"), "row numbers");
  assert.ok(!html.includes("border:1px"));
  assert.ok(!html.includes("<h1>"));
  assert.ok(html.includes("table-layout: fixed"));
});

test("merged cells span and their covered cells are skipped", () => {
  const html = printHtml({ ...input, merges: [{ top: 0, left: 0, bottom: 0, right: 1 }] });
  assert.ok(html.includes('rowspan="1" colspan="2"'));
  assert.equal((html.match(/<td/g) ?? []).length, 3, "one merged cell plus two on the second row");
});

test("styles map to inline css; page setup and used range read defensively", () => {
  assert.equal(styleToInline({ italic: true, color: "#f00", borders: { top: { style: "thin", color: "#000" } } }, "center"), "text-align:center;font-style:italic;color:#f00;border-top:1px solid #000");
  assert.equal(escapeHtml('<a href="x">&'), "&lt;a href=&quot;x&quot;&gt;&amp;");
  assert.deepEqual(readPageSetup({ orientation: "landscape", paper: "Tabloid", gridlines: false, area: { top: 0, left: 0, bottom: 4, right: 2 } }), {
    ...DEFAULT_PAGE_SETUP,
    orientation: "landscape",
    gridlines: false,
    area: { top: 0, left: 0, bottom: 4, right: 2 },
  });
  assert.equal(readPageSetup(null), undefined);
  assert.deepEqual(usedRange(["A1", "C4", "B2"], parseCellRef), { top: 0, left: 0, bottom: 3, right: 2 });
  assert.deepEqual(usedRange([], parseCellRef), { top: 0, left: 0, bottom: 0, right: 0 });
});
