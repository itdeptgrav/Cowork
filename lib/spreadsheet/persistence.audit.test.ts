/**
 * Persistence audit — serialize/deserialize round-trip fidelity for EVERY field
 * the serialized shape carries, canonical-form stability, and tolerance of the
 * sparse/duplicate edge cases a store can hand back.
 *
 * Assertions state CORRECT behaviour; failures are tagged `// BUG(...)`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorkbook,
  createWorksheet,
  getCellStyleId,
  getCellValue,
  type Workbook,
  type Worksheet,
} from "@/lib/spreadsheet/model";
import { StyleRegistry } from "@/lib/spreadsheet/style";
import {
  deserializeWorkbook,
  serializeWorkbook,
  type SerializedWorkbook,
} from "@/lib/spreadsheet/persistence";

function fullSheet(id: string, name: string, styleId: number): Worksheet {
  let ws = createWorksheet(id, name, 50, 20);
  ws = {
    ...ws,
    cells: { A1: { value: "v" }, B2: { value: "=A1*2" }, T50: { value: "corner" } },
    cellStyles: { A1: styleId, C9: styleId }, // C9 is styled-but-empty
    rowHeights: { 5: 60 },
    colWidths: { 2: 200 },
    hiddenRows: { 8: true },
    hiddenCols: { 3: true },
    frozenRows: 1,
    frozenCols: 2,
    filter: { range: { top: 0, left: 0, bottom: 9, right: 3 }, columns: { 0: { values: ["v"] } } },
    validations: [
      {
        range: { top: 0, left: 0, bottom: 4, right: 0 },
        rule: { kind: "list", values: ["a", "b"] },
        allowBlank: false,
        errorStyle: "warning",
      },
    ],
    conditionalFormats: [
      {
        range: { top: 0, left: 0, bottom: 9, right: 9 },
        condition: { type: "textContains", value: "v" },
        styleId,
      },
    ],
    merges: [{ top: 10, left: 0, bottom: 12, right: 1 }],
    links: { A1: "https://example.com" },
    comments: {
      B2: { ref: "B2", entries: [{ id: "1", author: "Ada", timestamp: 5, body: "why?" }] },
    },
    rowGroups: [{ from: 20, to: 25, collapsed: true }, { from: 30, to: 32 }],
  };
  return ws;
}

function fullWorkbook(): { wb: Workbook; registry: StyleRegistry } {
  const registry = new StyleRegistry();
  const styleId = registry.intern({ bold: true, background: "#ffee00" });
  const s1 = fullSheet("sheet-1", "Main", styleId);
  const s2 = { ...createWorksheet("sheet-2", "Second"), hidden: true as const };
  const s3 = createWorksheet("sheet-3", "Third");
  return { wb: { worksheets: [s1, s2, s3], activeSheetId: "sheet-3" }, registry };
}

test("AUDIT: every serialized field survives a hydrate round trip", () => {
  const { wb, registry } = fullWorkbook();
  const { workbook, styleRegistry } = deserializeWorkbook(serializeWorkbook(wb, registry));
  const back = workbook.worksheets[0];
  const orig = wb.worksheets[0];

  assert.equal(getCellValue(back, 0, 0), "v");
  assert.equal(getCellValue(back, 1, 1), "=A1*2");
  assert.equal(getCellValue(back, 49, 19), "corner");
  assert.equal(getCellStyleId(back, 0, 0), getCellStyleId(orig, 0, 0));
  assert.equal(getCellStyleId(back, 8, 2), getCellStyleId(orig, 8, 2), "styled-but-empty survives");
  assert.deepEqual(styleRegistry.get(getCellStyleId(back, 0, 0)), { bold: true, background: "#ffee00" });

  assert.equal(back.rowCount, 50);
  assert.equal(back.colCount, 20);
  assert.deepEqual(back.rowHeights, { 5: 60 });
  assert.deepEqual(back.colWidths, { 2: 200 });
  assert.deepEqual(back.hiddenRows, { 8: true });
  assert.deepEqual(back.hiddenCols, { 3: true });
  assert.equal(back.frozenRows, 1);
  assert.equal(back.frozenCols, 2);

  assert.deepEqual(back.filter, orig.filter);
  assert.deepEqual(back.validations, orig.validations);
  assert.deepEqual(back.conditionalFormats, orig.conditionalFormats);
  assert.deepEqual(back.merges, orig.merges);
  assert.deepEqual(back.links, orig.links);
  assert.deepEqual(back.comments, orig.comments);
  assert.deepEqual(back.rowGroups, orig.rowGroups, "outline groups survive persistence");
});

test("AUDIT: sheet order, names, hidden flags and the active sheet survive", () => {
  const { wb, registry } = fullWorkbook();
  const { workbook } = deserializeWorkbook(serializeWorkbook(wb, registry));
  assert.deepEqual(
    workbook.worksheets.map((s) => [s.id, s.name, !!s.hidden]),
    [
      ["sheet-1", "Main", false],
      ["sheet-2", "Second", true],
      ["sheet-3", "Third", false],
    ],
  );
  assert.equal(workbook.activeSheetId, "sheet-3");
});

test("AUDIT: serialization is canonical — a second round trip is byte-identical", () => {
  const { wb, registry } = fullWorkbook();
  const once = serializeWorkbook(wb, registry);
  const { workbook, styleRegistry } = deserializeWorkbook(once);
  const twice = serializeWorkbook(workbook, styleRegistry);
  assert.equal(JSON.stringify(once), JSON.stringify(twice));
});

test("AUDIT: an unknown activeSheetId falls back to the first sheet, never to a crash", () => {
  const { wb, registry } = fullWorkbook();
  const data = serializeWorkbook(wb, registry);
  const tampered: SerializedWorkbook = { ...data, activeSheetId: "sheet-404" };
  const { workbook } = deserializeWorkbook(tampered);
  assert.equal(workbook.activeSheetId, "sheet-1");
});

test("AUDIT: a stored cell entry that is empty-and-unstyled hydrates to no cell at all", () => {
  const { wb, registry } = fullWorkbook();
  const data = serializeWorkbook(wb, registry);
  data.sheets[0].cells.push({ ref: "M13" }); // neither value nor style
  const { workbook } = deserializeWorkbook(data);
  const back = workbook.worksheets[0];
  assert.equal(back.cells["M13"], undefined, "no phantom cell in the sparse store");
  assert.equal(back.cellStyles["M13"], undefined);
});

test("AUDIT: duplicate refs in stored cells resolve last-wins without duplicating keys", () => {
  const { wb, registry } = fullWorkbook();
  const data = serializeWorkbook(wb, registry);
  data.sheets[0].cells.push({ ref: "A1", value: "override" });
  const { workbook } = deserializeWorkbook(data);
  assert.equal(getCellValue(workbook.worksheets[0], 0, 0), "override");
});

test("AUDIT: a style id 0 entry and an unknown style id are both harmless", () => {
  const registry = new StyleRegistry();
  let wb = createWorkbook();
  const ws = { ...wb.worksheets[0], cells: { A1: { value: "x" } }, cellStyles: { A1: 99 } };
  wb = { ...wb, worksheets: [ws] };
  const data = serializeWorkbook(wb, registry);
  const { workbook, styleRegistry } = deserializeWorkbook(data);
  assert.equal(getCellStyleId(workbook.worksheets[0], 0, 0), 99, "the id itself survives");
  assert.deepEqual(styleRegistry.get(99), {}, "an unknown id reads as the empty style, no throw");
});

test("AUDIT: absent optional feature blocks stay absent — no empty husks appear", () => {
  const registry = new StyleRegistry();
  const wb = createWorkbook();
  const sheet = serializeWorkbook(wb, registry).sheets[0];
  for (const key of ["filter", "validations", "conditionalFormats", "merges", "links", "comments", "rowGroups"]) {
    assert.equal(key in sheet, false, `${key} is not serialized when unused`);
  }
  const { workbook } = deserializeWorkbook(serializeWorkbook(wb, registry));
  const back = workbook.worksheets[0];
  assert.equal(back.filter, undefined);
  assert.equal(back.merges, undefined);
  assert.equal(back.rowGroups, undefined);
});

test("AUDIT: legacy data missing hiddenRows/hiddenCols/frozen fields hydrates with defaults", () => {
  const registry = new StyleRegistry();
  const data = serializeWorkbook(createWorkbook(), registry);
  const legacy = JSON.parse(JSON.stringify(data)) as SerializedWorkbook;
  delete (legacy.sheets[0] as Partial<SerializedWorkbook["sheets"][number]>).hiddenRows;
  delete (legacy.sheets[0] as Partial<SerializedWorkbook["sheets"][number]>).hiddenCols;
  delete (legacy.sheets[0] as Partial<SerializedWorkbook["sheets"][number]>).frozenRows;
  delete (legacy.sheets[0] as Partial<SerializedWorkbook["sheets"][number]>).frozenCols;
  let hydrated: ReturnType<typeof deserializeWorkbook> | undefined;
  assert.doesNotThrow(() => {
    hydrated = deserializeWorkbook(legacy);
  });
  const back = hydrated!.workbook.worksheets[0];
  assert.deepEqual(back.hiddenRows, {});
  assert.deepEqual(back.hiddenCols, {});
  assert.equal(back.frozenRows, 0);
  assert.equal(back.frozenCols, 0);
});
