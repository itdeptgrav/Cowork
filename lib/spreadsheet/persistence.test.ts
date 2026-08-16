import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkbook, getCellStyleId, getCellValue, setCellStyleId, setCellValue } from "@/lib/spreadsheet/model";
import { createSheet } from "@/lib/spreadsheet/workbook";
import { freezeRows, setColWidth, setRowsHidden } from "@/lib/spreadsheet/structure";
import { StyleRegistry } from "@/lib/spreadsheet/style";
import { deserializeWorkbook, serializeWorkbook } from "@/lib/spreadsheet/persistence";
import type { Workbook } from "@/lib/spreadsheet/model";

function replaceActive(wb: Workbook, next: Workbook["worksheets"][number]): Workbook {
  return { ...wb, worksheets: wb.worksheets.map((s) => (s.id === next.id ? next : s)) };
}

test("serialize stores only the filled or formatted cells (sparse)", () => {
  let wb = createWorkbook();
  let ws = wb.worksheets[0];
  ws = setCellValue(ws, 0, 0, "10");
  ws = setCellValue(ws, 5, 3, "hi");
  wb = replaceActive(wb, ws);

  const data = serializeWorkbook(wb, new StyleRegistry());
  const sheet = data.sheets[0];
  assert.equal(sheet.cells.length, 2, "a 1000×100 sheet with two values serialises two cells");
  assert.deepEqual(
    sheet.cells.map((c) => c.ref).sort(),
    ["A1", "D6"],
  );
});

test("round-trips values, formatting, and the style table", () => {
  const registry = new StyleRegistry();
  const bold = registry.intern({ bold: true });
  let wb = createWorkbook();
  let ws = wb.worksheets[0];
  ws = setCellValue(ws, 0, 0, "10");
  ws = setCellValue(ws, 1, 0, "=A1*2");
  ws = setCellStyleId(ws, 0, 0, bold);
  ws = setCellStyleId(ws, 2, 2, bold); // a styled but EMPTY cell
  wb = replaceActive(wb, ws);

  const data = serializeWorkbook(wb, registry);
  const { workbook, styleRegistry } = deserializeWorkbook(data);
  const back = workbook.worksheets[0];

  assert.equal(getCellValue(back, 0, 0), "10");
  assert.equal(getCellValue(back, 1, 0), "=A1*2");
  assert.equal(getCellStyleId(back, 0, 0), bold);
  assert.equal(getCellStyleId(back, 2, 2), bold, "a coloured empty cell survives");
  assert.deepEqual(styleRegistry.get(bold), { bold: true });
});

test("round-trips sheet metadata: dimensions, freeze, hidden lines, resizes", () => {
  let wb = createWorkbook();
  let ws = wb.worksheets[0];
  ws = freezeRows(ws, 2);
  ws = setColWidth(ws, 1, 220);
  ws = setRowsHidden(ws, 4, 5, true);
  wb = replaceActive(wb, ws);

  const { workbook } = deserializeWorkbook(serializeWorkbook(wb, new StyleRegistry()));
  const back = workbook.worksheets[0];
  assert.equal(back.frozenRows, 2);
  assert.equal(back.colWidths[1], 220);
  assert.equal(back.hiddenRows[4], true);
  assert.equal(back.hiddenRows[5], true);
});

test("round-trips multiple sheets, order, names and the active sheet", () => {
  let wb = createWorkbook(); // Sheet1
  wb = createSheet(wb).workbook; // Sheet2 (active)
  wb = createSheet(wb).workbook; // Sheet3 (active)
  // Put a cross-sheet formula so the whole thing is exercised.
  const s1 = wb.worksheets[0];
  wb = replaceActive(wb, setCellValue(s1, 0, 0, "=Sheet2!A1"));

  const { workbook } = deserializeWorkbook(serializeWorkbook(wb, new StyleRegistry()));
  assert.deepEqual(
    workbook.worksheets.map((s) => s.name),
    ["Sheet1", "Sheet2", "Sheet3"],
  );
  assert.equal(workbook.activeSheetId, wb.activeSheetId);
  assert.equal(getCellValue(workbook.worksheets[0], 0, 0), "=Sheet2!A1");
});

test("re-serializing a deserialized workbook is stable (canonical form)", () => {
  const registry = new StyleRegistry();
  registry.intern({ italic: true });
  let wb = createWorkbook();
  wb = replaceActive(wb, setCellValue(wb.worksheets[0], 3, 1, "x"));
  const once = serializeWorkbook(wb, registry);
  const { workbook, styleRegistry } = deserializeWorkbook(once);
  const twice = serializeWorkbook(workbook, styleRegistry);
  assert.equal(JSON.stringify(once), JSON.stringify(twice));
});

test("round-trips Phase 11 features: merges, links and comments", () => {
  let wb = createWorkbook();
  let ws = wb.worksheets[0];
  ws = setCellValue(ws, 0, 0, "Title");
  ws = {
    ...ws,
    merges: [{ top: 0, left: 0, bottom: 0, right: 2 }],
    links: { A5: "https://example.com", B5: "mailto:a@b.com" },
    comments: {
      C3: {
        ref: "C3",
        entries: [
          { id: "1", author: "Ada", timestamp: 1000, body: "Check this" },
          { id: "2", author: "Bo", timestamp: 2000, body: "Done" },
        ],
        resolved: true,
      },
    },
  };
  wb = replaceActive(wb, ws);

  const data = serializeWorkbook(wb, new StyleRegistry());
  const sheet = data.sheets[0];
  assert.deepEqual(sheet.merges, [{ top: 0, left: 0, bottom: 0, right: 2 }]);
  assert.deepEqual(sheet.links, { A5: "https://example.com", B5: "mailto:a@b.com" });
  assert.equal(sheet.comments?.C3.entries.length, 2);

  const { workbook } = deserializeWorkbook(data);
  const back = workbook.worksheets[0];
  assert.deepEqual(back.merges, [{ top: 0, left: 0, bottom: 0, right: 2 }]);
  assert.equal(back.links?.A5, "https://example.com");
  assert.equal(back.comments?.C3.entries[1].body, "Done");
  assert.equal(back.comments?.C3.resolved, true);
});

test("a workbook with no Phase 11 features serialises none of those fields", () => {
  let wb = createWorkbook();
  wb = replaceActive(wb, setCellValue(wb.worksheets[0], 0, 0, "plain"));
  const sheet = serializeWorkbook(wb, new StyleRegistry()).sheets[0];
  assert.equal("merges" in sheet, false);
  assert.equal("links" in sheet, false);
  assert.equal("comments" in sheet, false);
});
