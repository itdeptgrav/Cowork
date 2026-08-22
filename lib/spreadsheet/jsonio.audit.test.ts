/**
 * JSON IO audit — round-trip fidelity and hostile-input handling.
 *
 * `importWorkbookJson`'s contract (its own header) is that it never throws and
 * never hands `deserializeWorkbook` something that would; and that export →
 * import is lossless for a workbook's persisted shape. These tests hold it to
 * both. Assertions state CORRECT behaviour; failures are tagged `// BUG(...)`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkbook, setCellValue, type Workbook, type Worksheet } from "@/lib/spreadsheet/model";
import { StyleRegistry } from "@/lib/spreadsheet/style";
import { deserializeWorkbook, serializeWorkbook } from "@/lib/spreadsheet/persistence";
import { exportWorkbookJson, importWorkbookJson } from "@/lib/spreadsheet/jsonio";
import { createSheet } from "@/lib/spreadsheet/workbook";

/** A workbook using every persisted feature the serializer writes. */
function fullFeatureWorkbook(): { wb: Workbook; registry: StyleRegistry } {
  const registry = new StyleRegistry();
  const bold = registry.intern({ bold: true });
  let wb = createWorkbook();
  wb = createSheet(wb).workbook; // Sheet2, active
  let s1 = wb.worksheets[0];
  s1 = setCellValue(s1, 0, 0, "Title");
  s1 = setCellValue(s1, 1, 0, "=Sheet2!A1");
  s1 = {
    ...s1,
    cellStyles: { A1: bold },
    frozenRows: 2,
    frozenCols: 1,
    rowHeights: { 3: 44 },
    colWidths: { 0: 150 },
    hiddenRows: { 7: true },
    hiddenCols: { 4: true },
    merges: [{ top: 0, left: 0, bottom: 0, right: 2 }],
    links: { A1: "https://example.com" },
    comments: {
      A1: {
        ref: "A1",
        entries: [{ id: "c1", author: "Ada", timestamp: 1000, body: "check" }],
        resolved: true,
      },
    },
    filter: { range: { top: 0, left: 0, bottom: 9, right: 2 }, columns: { 1: { values: ["x"] } } },
    validations: [
      { range: { top: 1, left: 1, bottom: 5, right: 1 }, rule: { kind: "list", values: ["Yes", "No"] } },
    ],
    conditionalFormats: [
      { range: { top: 0, left: 0, bottom: 9, right: 0 }, condition: { type: "greaterThan", value: 5 }, styleId: bold },
    ],
    rowGroups: [{ from: 2, to: 5, collapsed: true }],
  } satisfies Worksheet;
  const worksheets = [s1, ...wb.worksheets.slice(1)];
  return { wb: { ...wb, worksheets }, registry };
}

test("AUDIT: export→import round-trips values, styles, sheet order and the active sheet", () => {
  const { wb, registry } = fullFeatureWorkbook();
  const result = importWorkbookJson(exportWorkbookJson(serializeWorkbook(wb, registry)));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.workbook.activeSheetId, wb.activeSheetId, "the active sheet survives");
  assert.deepEqual(
    result.workbook.sheets.map((s) => s.name),
    ["Sheet1", "Sheet2"],
  );
  const back = result.workbook.sheets[0];
  const byRef = Object.fromEntries(back.cells.map((c) => [c.ref, c]));
  assert.equal(byRef["A1"].value, "Title");
  assert.equal(byRef["A2"].value, "=Sheet2!A1", "a cross-sheet formula survives verbatim");
  assert.equal(result.workbook.styles[byRef["A1"].style!].bold, true, "the style table survives id-for-id");
});

test("AUDIT: export→import round-trips geometry — freeze, sizes, hidden lines", () => {
  const { wb, registry } = fullFeatureWorkbook();
  const result = importWorkbookJson(exportWorkbookJson(serializeWorkbook(wb, registry)));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const back = result.workbook.sheets[0];
  assert.equal(back.frozenRows, 2);
  assert.equal(back.frozenCols, 1);
  assert.equal(back.rowHeights[3], 44);
  assert.equal(back.colWidths[0], 150);
  assert.deepEqual(back.hiddenRows, [7]);
  assert.deepEqual(back.hiddenCols, [4]);
});

test("AUDIT: export→import round-trips merges, links, comments, filter, validations, conditional formats", () => {
  const { wb, registry } = fullFeatureWorkbook();
  const result = importWorkbookJson(exportWorkbookJson(serializeWorkbook(wb, registry)));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const back = result.workbook.sheets[0];
  assert.deepEqual(back.merges, [{ top: 0, left: 0, bottom: 0, right: 2 }]);
  assert.deepEqual(back.links, { A1: "https://example.com" });
  assert.equal(back.comments?.A1.entries[0].body, "check");
  assert.equal(back.comments?.A1.resolved, true);
  assert.deepEqual(back.filter?.columns[1]?.values, ["x"]);
  assert.equal(back.validations?.length, 1);
  assert.equal(back.conditionalFormats?.length, 1);
});

test("AUDIT: export→import round-trips row groups (outline bands)", () => {
  const { wb, registry } = fullFeatureWorkbook();
  const data = serializeWorkbook(wb, registry);
  assert.deepEqual(
    data.sheets[0].rowGroups,
    [{ from: 2, to: 5, collapsed: true }],
    "precondition: the serializer writes rowGroups",
  );
  const result = importWorkbookJson(exportWorkbookJson(data));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.workbook.sheets[0].rowGroups,
    [{ from: 2, to: 5, collapsed: true }],
    "row groups must survive the JSON round trip",
  );
});

test("AUDIT: an imported workbook must feed deserializeWorkbook without throwing — null style entry", () => {
  // A null element is valid JSON; the importer degrades it to {} IN PLACE (the
  // table is id-indexed, so dropping it would renumber every later style), and
  // the registry itself tolerates one as a second line of defence.
  const result = importWorkbookJson(
    JSON.stringify({ sheets: [{ id: "s", name: "S", cells: [{ ref: "A1", value: "x" }] }], styles: [null] }),
  );
  assert.equal(result.ok, true, "a null style entry is not fundamentally not-a-workbook");
  if (!result.ok) return;
  assert.doesNotThrow(() => deserializeWorkbook(result.workbook));
});

test("AUDIT: non-positive sheet dimensions are coerced to a usable sheet", () => {
  const result = importWorkbookJson(
    JSON.stringify({ sheets: [{ id: "s", name: "S", rowCount: 0, colCount: -5, cells: [] }] }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.workbook.sheets[0].rowCount >= 1, "rowCount must be at least 1");
  assert.ok(result.workbook.sheets[0].colCount >= 1, "colCount must be at least 1");
  // And the top end is capped at the same ceiling the xlsx importer enforces.
  const huge = importWorkbookJson(
    JSON.stringify({ sheets: [{ id: "s", name: "S", rowCount: 1e9, colCount: 1e9, cells: [] }] }),
  );
  assert.equal(huge.ok, true);
  if (!huge.ok) return;
  assert.ok(huge.workbook.sheets[0].rowCount <= 200_000, "rowCount is capped");
  assert.ok(huge.workbook.sheets[0].colCount <= 4_096, "colCount is capped");
});

test("AUDIT: corrupt shapes are normalised or rejected, never thrown", () => {
  const cases = [
    "null",
    "true",
    '{"sheets": {}}',
    '{"sheets": [null]}',
    '{"sheets": [{"cells": {"A1": "not an array"}}]}',
    '{"sheets": [{"rowHeights": [1,2,3], "hiddenRows": {"0": true}}]}',
    '{"sheets": [{"filter": [], "merges": {}, "links": [], "comments": 5}]}',
  ];
  for (const text of cases) {
    let result: ReturnType<typeof importWorkbookJson> | undefined;
    assert.doesNotThrow(() => {
      result = importWorkbookJson(text);
    }, `importing ${text} must not throw`);
    const r = result!;
    if (r.ok) {
      assert.doesNotThrow(
        () => deserializeWorkbook(r.workbook),
        `deserializing the normalised form of ${text} must not throw`,
      );
    }
  }
});

test("AUDIT: a malformed advanced block is dropped rather than passed through", () => {
  const result = importWorkbookJson(
    JSON.stringify({
      sheets: [{ id: "s", name: "S", cells: [], filter: ["not", "an", "object"], merges: {}, links: [] }],
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.filter, undefined, "an array is not a filter block");
  assert.equal(sheet.merges, undefined, "an object is not a merges array");
  assert.equal(sheet.links, undefined, "an array is not a links map");
});

test("AUDIT: the version field is stamped 1 on the way out", () => {
  // Divergence noted for the report: an input claiming any other version is
  // accepted silently and rewritten as version 1 — there is no version check.
  const result = importWorkbookJson(JSON.stringify({ version: 99, sheets: [{ id: "s", name: "S", cells: [] }] }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.workbook.version, 1);
});

test("AUDIT: cell values of the wrong JSON type are dropped, not stringified", () => {
  const result = importWorkbookJson(
    JSON.stringify({
      sheets: [{ id: "s", name: "S", cells: [{ ref: "A1", value: 42 }, { ref: "B1", value: "kept" }] }],
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const byRef = Object.fromEntries(result.workbook.sheets[0].cells.map((c) => [c.ref, c.value]));
  assert.equal(byRef["A1"], undefined, "a numeric `value` is not silently coerced");
  assert.equal(byRef["B1"], "kept");
});
