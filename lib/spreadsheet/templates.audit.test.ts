/**
 * Templates audit — geometry, offset formula rewriting, styles, widths,
 * validations, fit checks and overlap behaviour of the pre-built tables.
 *
 * These tests assert CORRECT behaviour under real-spreadsheet semantics — a
 * template must compute, format and validate the same wherever it is dropped —
 * not what the code happens to do. Assertions that fail are kept, marked
 * // BUG(<id>), so the failure list is the finding list.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import * as barrel from "@/lib/spreadsheet";
import { parseCellRef } from "@/lib/spreadsheet/coordinates";
import { FormulaEngine } from "@/lib/spreadsheet/formula/engine";
import { BLANK, type ScalarValue } from "@/lib/spreadsheet/formula/value";
import {
  createWorksheet,
  getCellStyleId,
  getCellValue,
  setCellValue,
  type Worksheet,
} from "@/lib/spreadsheet/model";
import { StyleRegistry } from "@/lib/spreadsheet/style";
import {
  BODY_ROWS,
  TABLE_TEMPLATES,
  buildTable,
  fitsOnSheet,
  regionIsEmpty,
  tableFootprint,
  templateById,
} from "@/lib/spreadsheet/templates";
import { validateValue, validationAt } from "@/lib/spreadsheet/validation";

const at = (row: number, col: number) => ({ row, col });

function build(id: string, row = 0, col = 0, ws?: Worksheet) {
  const sheet = ws ?? createWorksheet("s", "Sheet1");
  const registry = new StyleRegistry();
  const template = templateById(id)!;
  return { ws: buildTable(sheet, registry, template, at(row, col)), registry, template };
}

/** The same interpretation the grid uses: a numeric string is a number. */
function interpret(raw: string): ScalarValue {
  const t = raw.trim();
  if (t === "") return BLANK;
  if (/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  const up = t.toUpperCase();
  if (up === "TRUE") return true;
  if (up === "FALSE") return false;
  return raw;
}

/** Load every cell of a built worksheet into a real formula engine. */
function engineFor(ws: Worksheet, sheetId = "s"): FormulaEngine {
  const engine = new FormulaEngine();
  engine.syncSheets([{ id: sheetId, name: ws.name }]);
  for (const [ref, cell] of Object.entries(ws.cells)) {
    const pos = parseCellRef(ref)!;
    engine.setCell(sheetId, pos.row, pos.col, cell.value);
  }
  return engine;
}

/* ── 1. Geometry — the footprint is what the menu advertises ──────────────── */

test("AUDIT: every footprint is columns × (BODY_ROWS + 1), translated exactly by the anchor", () => {
  for (const t of TABLE_TEMPLATES) {
    const origin = tableFootprint(t, at(0, 0));
    assert.equal(origin.bottom - origin.top + 1, BODY_ROWS + 1, `${t.id}: height`);
    assert.equal(origin.right - origin.left + 1, t.columns.length, `${t.id}: width`);

    const moved = tableFootprint(t, at(7, 3));
    assert.deepEqual(
      moved,
      { top: 7, left: 3, bottom: 7 + BODY_ROWS, right: 3 + t.columns.length - 1 },
      `${t.id}: the footprint translates with the anchor`,
    );
  }
});

test("AUDIT: templateById finds every template and rejects an unknown id", () => {
  for (const t of TABLE_TEMPLATES) assert.equal(templateById(t.id), t);
  assert.equal(templateById("no-such-template"), undefined);
});

/* ── 2. Template data coheres with its own rules ──────────────────────────── */

test("AUDIT: every non-empty sample value passes its own column's rule", () => {
  for (const t of TABLE_TEMPLATES) {
    t.columns.forEach((column, i) => {
      if (!column.rule) return;
      for (const row of t.sample) {
        const sample = row[i] ?? "";
        if (sample === "") continue;
        assert.equal(
          validateValue(column.rule, sample, interpret, () => true, { allowBlank: true }),
          true,
          `${t.id}: sample "${sample}" must satisfy the ${column.rule.kind} rule on "${column.label}"`,
        );
      }
    });
  }
});

test("AUDIT: samples in number-formatted columns are numbers (or blank)", () => {
  const numeric = new Set(["number", "currency", "percent", "accounting", "scientific"]);
  for (const t of TABLE_TEMPLATES) {
    t.columns.forEach((column, i) => {
      /* TableColumn.numberFormat IS the kind string — checking it directly
         (a `.kind` read made this test silently skip every column). */
      if (!column.numberFormat || !numeric.has(column.numberFormat)) return;
      for (const row of t.sample) {
        const sample = row[i] ?? "";
        if (sample === "") continue;
        assert.ok(
          Number.isFinite(Number(sample)),
          `${t.id}: "${sample}" in the ${column.label} column must read as a number`,
        );
      }
    });
  }
});

/* ── 3. Formulas are rewritten to the insertion point ─────────────────────── */

test("AUDIT: budget's Difference names its own row and columns from any anchor", () => {
  // Anchored at A1: Budgeted is C, Actual is D, first body row is row 2.
  const a1 = build("budget").ws;
  assert.equal(getCellValue(a1, 1, 4), "=C2-D2");
  assert.equal(getCellValue(a1, 12, 4), "=C13-D13", "the last body row is offset too");

  // Anchored at C5 (row 4, col 2): Budgeted is E, Actual is F, first body row is row 6.
  const c5 = build("budget", 4, 2).ws;
  assert.equal(getCellValue(c5, 5, 6), "=E6-F6");
  assert.equal(getCellValue(c5, 16, 6), "=E17-F17");

  // A row-only offset moves the row numbers and nothing else.
  const a10 = build("budget", 9, 0).ws;
  assert.equal(getCellValue(a10, 10, 4), "=C11-D11");

  // An anchor past column Z must produce double-letter references.
  const y1 = build("budget", 0, 24).ws;
  assert.equal(getCellValue(y1, 1, 28), "=AA2-AB2");
});

test("AUDIT: an offset budget table COMPUTES budgeted minus actual through the real engine", () => {
  const { ws } = build("budget", 4, 2);
  const engine = engineFor(ws);
  // Sample row: 5000 budgeted, 4200 actual → the Difference cell must say 800.
  assert.equal(engine.getValue("s", 5, 6), 800);
  // Type into a blank body row: the formula there must read ITS OWN row.
  engine.setCell("s", 8, 4, "100");
  engine.setCell("s", 8, 5, "40");
  assert.equal(engine.getValue("s", 8, 6), 60);
});

test("AUDIT: an offset inventory table COMPUTES quantity × unit price through the real engine", () => {
  const { ws } = build("inventory", 2, 1);
  const engine = engineFor(ws);
  engine.setCell("s", 3, 3, "7"); // Quantity
  engine.setCell("s", 3, 4, "2.5"); // Unit price
  assert.equal(engine.getValue("s", 3, 5), 17.5);
});

/* ── 4. Styles, formats and widths land on the offset cells ───────────────── */

test("AUDIT: header and band styles land on the anchor's cells, not A1's", () => {
  const { ws, registry } = build("task-list", 3, 2);

  const header = registry.get(getCellStyleId(ws, 3, 2));
  assert.deepEqual(header, {
    bold: true,
    color: "#ffffff",
    background: "#3c4043",
    valign: "middle",
  });

  // Body row 1 (unbanded) of the plain Task column carries no style at all.
  assert.equal(getCellStyleId(ws, 4, 2), 0, "an unbanded plain cell stays default");
  // Body row 2 (banded) carries the band background.
  assert.equal(registry.get(getCellStyleId(ws, 5, 2)).background, "#f5f6f7");
  // Nothing lands outside the footprint.
  assert.equal(getCellStyleId(ws, 3, 1), 0, "left of the table");
  assert.equal(getCellStyleId(ws, 2, 2), 0, "above the table");
});

test("AUDIT: number formats and alignment survive insertion at an offset", () => {
  const { ws, registry, template } = build("project-tracker", 2, 1);
  const col = (label: string) => 1 + template.columns.findIndex((c) => c.label === label);

  const start = registry.get(getCellStyleId(ws, 3, col("Start")));
  assert.equal(start.numberFormat?.kind, "shortDate", "Start keeps its date format");
  const banded = registry.get(getCellStyleId(ws, 4, col("Start")));
  assert.equal(banded.numberFormat?.kind, "shortDate", "banded rows keep it too");
  assert.equal(banded.background, "#f5f6f7");

  const priority = registry.get(getCellStyleId(ws, 3, col("Priority")));
  assert.equal(priority.align, "center", "Priority keeps its centring");
});

test("AUDIT: column widths land on the offset columns and nowhere else", () => {
  const { ws, template } = build("project-tracker", 0, 3);
  template.columns.forEach((c, i) => {
    if (c.width === undefined) return;
    assert.equal(ws.colWidths[3 + i], c.width, `width of ${c.label}`);
  });
  assert.equal(ws.colWidths[0], undefined);
  assert.equal(ws.colWidths[1], undefined);
  assert.equal(ws.colWidths[2], undefined);
  assert.equal(ws.colWidths[3 + template.columns.length], undefined, "past the table");
});

/* ── 5. Validations (dropdowns, checkboxes, shapes) survive insertion ─────── */

test("AUDIT: checkbox, list and shape rules govern exactly the offset body columns", () => {
  const { ws, template } = build("project-tracker", 2, 1);
  const rect = tableFootprint(template, at(2, 1));
  const col = (label: string) => 1 + template.columns.findIndex((c) => c.label === label);

  const done = (ws.validations ?? []).find((v) => v.range.left === col("Done"));
  assert.ok(done, "the Done column is validated");
  assert.equal(done.rule.kind, "checkbox");
  assert.deepEqual(done.range, { top: 3, left: col("Done"), bottom: rect.bottom, right: col("Done") });
  assert.equal(done.allowBlank, true);

  const status = validationAt(ws.validations, 3, col("Status"));
  assert.equal(status?.rule.kind, "list");
  assert.equal(validationAt(ws.validations, 2, col("Status")), null, "never the header row");
  assert.equal(validationAt(ws.validations, rect.bottom + 1, col("Status")), null, "never below the body");

  const roster = build("team-roster", 1, 1);
  const email = (roster.ws.validations ?? []).find((v) => v.rule.kind === "shape");
  assert.ok(email, "the Email column keeps its shape rule");
  assert.equal(email.range.left, 1 + roster.template.columns.findIndex((c) => c.label === "Email"));
});

test("AUDIT: a validation reaching beyond the block keeps governing the cells outside it", () => {
  // Somebody validated D1:D100, then drops a 5-column table over rows 1–13.
  // The table owns its own block — but D50 was never part of it, and a rule the
  // person put on D50 must not silently vanish because its RANGE touched the block.
  let ws = createWorksheet("s", "Sheet1");
  ws = {
    ...ws,
    validations: [
      { range: { top: 0, left: 3, bottom: 99, right: 3 }, rule: { kind: "list", values: ["A", "B"] } },
    ],
  };
  const registry = new StyleRegistry();
  const next = buildTable(ws, registry, templateById("task-list")!, at(0, 0));

  // Inside the block the table's own rule wins.
  assert.equal(validationAt(next.validations, 1, 3)?.rule.kind, "list");
  // Outside it, the trimmed remainder (D14:D100) keeps the person's rule.
  assert.ok(
    validationAt(next.validations, 49, 3),
    "a rule on cells outside the table must survive the insertion",
  );
});

/* ── 6. Fit and overlap checks at the edges ───────────────────────────────── */

test("AUDIT: fitsOnSheet accepts an exact fit and refuses one cell past it", () => {
  const ws = createWorksheet("s", "Sheet1");
  const t = templateById("project-tracker")!;
  const lastRowAnchor = ws.rowCount - 1 - BODY_ROWS; // bottom lands on the last row
  const lastColAnchor = ws.colCount - t.columns.length; // right lands on the last column

  assert.equal(fitsOnSheet(ws, t, at(0, 0)), true, "an empty sheet fits at A1");
  assert.equal(fitsOnSheet(ws, t, at(lastRowAnchor, 0)), true, "exactly reaching the bottom fits");
  assert.equal(fitsOnSheet(ws, t, at(lastRowAnchor + 1, 0)), false, "one row past does not");
  assert.equal(fitsOnSheet(ws, t, at(0, lastColAnchor)), true, "exactly reaching the right edge fits");
  assert.equal(fitsOnSheet(ws, t, at(0, lastColAnchor + 1)), false, "one column past does not");
  assert.equal(fitsOnSheet(ws, t, at(lastRowAnchor, lastColAnchor)), true, "the exact corner fits");
});

test("AUDIT: regionIsEmpty sees occupancy exactly to the footprint's edge", () => {
  const t = templateById("task-list")!;
  const rect = tableFootprint(t, at(0, 0));
  const empty = createWorksheet("s", "Sheet1");
  assert.equal(regionIsEmpty(empty, rect), true);

  // A value in the far corner of the block blocks it.
  assert.equal(regionIsEmpty(setCellValue(empty, rect.bottom, rect.right, "x"), rect), false);
  // A value one cell outside each edge does not.
  assert.equal(regionIsEmpty(setCellValue(empty, rect.bottom + 1, 0, "x"), rect), true);
  assert.equal(regionIsEmpty(setCellValue(empty, 0, rect.right + 1, "x"), rect), true);
  // A whitespace-only cell still counts as occupied — the conservative reading:
  // the one failure this feature cannot have is eating somebody's cell.
  assert.equal(regionIsEmpty(setCellValue(empty, 5, 2, " "), rect), false);
});

test("AUDIT: building over old content replaces every cell of the block, values and styles", () => {
  const registry = new StyleRegistry();
  let ws = createWorksheet("s", "Sheet1");
  ws = setCellValue(ws, 3, 0, "junk");
  ws = { ...ws, cellStyles: { A4: registry.intern({ bold: true, background: "#ff0000" }) } };

  const next = buildTable(ws, registry, templateById("project-tracker")!, at(0, 0));
  // Row 4 is body row 3 — no sample there, so the cell must end EMPTY, not "junk".
  assert.equal(getCellValue(next, 3, 0), "");
  // And its old formatting must be gone (body row 3 is unbanded → default style).
  assert.equal(getCellStyleId(next, 3, 0), 0);
});

test("AUDIT: a merged region overlapping the block must not survive into the table", () => {
  // B2:C3 merged but EMPTY passes the emptiness check, so the table lands on it.
  // A merge left inside the block garbles the grid: the table writes seven
  // headers and twelve rows, and the merge hides some of them behind one cell.
  // Real spreadsheets either refuse the placement or unmerge the region.
  let ws = createWorksheet("s", "Sheet1");
  ws = { ...ws, merges: [{ top: 1, left: 1, bottom: 2, right: 2 }] };
  const registry = new StyleRegistry();
  const t = templateById("project-tracker")!;
  const rect = tableFootprint(t, at(0, 0));

  assert.equal(regionIsEmpty(ws, rect), true, "the merge is invisible to the emptiness check");
  const next = buildTable(ws, registry, t, at(0, 0));
  const overlapping = (next.merges ?? []).filter(
    (m) => !(m.right < rect.left || m.left > rect.right || m.bottom < rect.top || m.top > rect.bottom),
  );
  assert.deepEqual(overlapping, [], "no merged region may remain inside the table block");
});

/* ── 7. Surrounding sheet state ───────────────────────────────────────────── */

test("AUDIT: inserting at the top must not shrink an existing deeper freeze", () => {
  let ws = createWorksheet("s", "Sheet1");
  ws = { ...ws, frozenRows: 3 };
  const registry = new StyleRegistry();
  const next = buildTable(ws, registry, templateById("task-list")!, at(0, 0));
  // The table needs AT LEAST its header frozen (max(1, current)); it has no
  // business unfreezing rows somebody chose to freeze.
  assert.equal(next.frozenRows, 3, "a deeper existing freeze survives the insertion");
});

test("AUDIT: buildTable is pure — the input worksheet is untouched", () => {
  let ws = createWorksheet("s", "Sheet1");
  ws = {
    ...ws,
    validations: [{ range: { top: 0, left: 9, bottom: 5, right: 9 }, rule: { kind: "checkbox" } }],
    filter: { range: { top: 20, left: 0, bottom: 25, right: 3 }, columns: {} },
  };
  const before = JSON.stringify(ws);
  buildTable(ws, new StyleRegistry(), templateById("budget")!, at(0, 0));
  assert.equal(JSON.stringify(ws), before, "the input worksheet must not be mutated");
});

test("AUDIT: the filter and freeze land with the table", () => {
  const { ws, template } = build("action-items", 0, 0);
  assert.deepEqual(ws.filter?.range, tableFootprint(template, at(0, 0)));
  assert.equal(ws.frozenRows, 1, "at the top the header freezes");
  const lower = build("action-items", 6, 0).ws;
  assert.equal(lower.frozenRows, 0, "further down nothing freezes");
  assert.deepEqual(lower.filter?.range, tableFootprint(template, at(6, 0)));
});

/* ── 8. The barrel ────────────────────────────────────────────────────────── */

test("AUDIT: the engine barrel exports the templates module like its peers", () => {
  const b = barrel as Record<string, unknown>;
  assert.equal(typeof b.createWorksheet, "function", "model is in the barrel");
  assert.equal(typeof b.validateValue, "function", "validation is in the barrel");
  assert.equal(typeof b.buildTable, "function", "templates is in the barrel");
  assert.ok(Array.isArray(b.TABLE_TEMPLATES), "the template list is in the barrel");
});
