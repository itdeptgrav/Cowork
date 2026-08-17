import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorksheet, getCellValue, setCellValue } from "@/lib/spreadsheet/model";
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

const at = (row: number, col: number) => ({ row, col });

function build(id: string, row = 0, col = 0) {
  const ws = createWorksheet("s", "Sheet1");
  const registry = new StyleRegistry();
  const template = templateById(id)!;
  return { ws: buildTable(ws, registry, template, at(row, col)), registry, template };
}

test("every template is well formed", () => {
  const ids = new Set<string>();
  for (const t of TABLE_TEMPLATES) {
    assert.ok(!ids.has(t.id), `duplicate template id ${t.id}`);
    ids.add(t.id);
    assert.ok(t.name.length > 0 && t.summary.length > 0, `${t.id} needs a name and a summary`);
    assert.ok(t.columns.length > 0, `${t.id} needs columns`);
    for (const row of t.sample) {
      assert.equal(
        row.length,
        t.columns.length,
        `${t.id}: a sample row must have one entry per column`,
      );
    }
    assert.ok(
      t.sample.length <= BODY_ROWS,
      `${t.id}: more sample rows than the body has room for`,
    );
  }
});

test("the header row carries the labels, and the body is as tall as declared", () => {
  const { ws, template } = build("project-tracker");
  template.columns.forEach((c, i) => {
    assert.equal(getCellValue(ws, 0, i), c.label, `header ${i}`);
  });
  const rect = tableFootprint(template, at(0, 0));
  assert.equal(rect.bottom, BODY_ROWS, "header plus BODY_ROWS body rows");
  assert.equal(rect.right, template.columns.length - 1);
});

test("sample rows land under the header and the rest of the body is blank", () => {
  const { ws } = build("project-tracker");
  assert.equal(getCellValue(ws, 1, 0), "Draft the brief");
  assert.equal(getCellValue(ws, 2, 0), "Agree the budget");
  assert.equal(getCellValue(ws, 3, 0), "", "no third sample row");
});

test("a ruled column validates its BODY and never its own header", () => {
  const { ws, template } = build("project-tracker");
  const statusCol = template.columns.findIndex((c) => c.label === "Status");
  const v = (ws.validations ?? []).find((x) => x.range.left === statusCol);
  assert.ok(v, "the Status column has a validation");
  assert.equal(v.range.top, 1, "starts below the header");
  assert.equal(v.range.bottom, BODY_ROWS);
  assert.equal(v.rule.kind, "list");
  assert.equal(v.allowBlank, true, "a half-filled table is normal, not an error");
});

test("column widths are applied only where the template asks for one", () => {
  const { ws, template } = build("task-list", 0, 2);
  template.columns.forEach((c, i) => {
    if (c.width === undefined) return;
    assert.equal(ws.colWidths[2 + i], c.width, `width of column ${i}`);
  });
});

test("a computed column writes a real formula, offset to where it was dropped", () => {
  const atA = build("budget").ws;
  // Difference is the 5th column (E when anchored at A), = Budgeted − Actual.
  assert.equal(getCellValue(atA, 1, 4), "=C2-D2");
  assert.equal(getCellValue(atA, 2, 4), "=C3-D3");

  // The same template dropped at column F names its own neighbours.
  const atF = build("budget", 0, 5).ws;
  assert.equal(getCellValue(atF, 1, 9), "=H2-I2");
});

test("the inventory template multiplies quantity by unit price", () => {
  const { ws } = build("inventory");
  assert.equal(getCellValue(ws, 1, 4), "=C2*D2");
});

test("the header row gets a filter over the whole block", () => {
  const { ws, template } = build("action-items", 3, 1);
  const rect = tableFootprint(template, at(3, 1));
  assert.deepEqual(ws.filter?.range, rect);
});

test("the header freezes only when the table starts at the top of the sheet", () => {
  assert.equal(build("task-list", 0, 0).ws.frozenRows, 1, "at A1 the header freezes");
  assert.equal(
    build("task-list", 4, 0).ws.frozenRows,
    0,
    "further down it must not freeze the rows above it",
  );
});

test("a second table clears the rules inside its own block, and leaves the rest alone", () => {
  const registry = new StyleRegistry();
  let ws = createWorksheet("s", "Sheet1");
  // Project tracker: 7 columns, with a list rule on Status (2) and a checkbox on Done (6).
  ws = buildTable(ws, registry, templateById("project-tracker")!, at(0, 0));
  assert.equal(ruleAt(ws, 2), "list");
  assert.equal(ruleAt(ws, 6), "checkbox");

  // Task list: 5 columns. Its column 2 is Due, which has no rule at all — so the
  // old Status rule must be gone rather than left governing a date column.
  ws = buildTable(ws, registry, templateById("task-list")!, at(0, 0));
  assert.equal(ruleAt(ws, 2), undefined, "a stale rule inside the new block is cleared");
  assert.equal(ruleAt(ws, 3), "list", "the new table's own Priority rule is in place");
  // Column 6 is outside the new table, and the old table's cells there were never
  // overwritten — so its rule still matches real data and correctly survives.
  assert.equal(ruleAt(ws, 6), "checkbox", "a rule outside the block is not the new table's to remove");
});

/** The kind of rule governing a column's body, or undefined when it has none. */
function ruleAt(ws: ReturnType<typeof createWorksheet>, col: number): string | undefined {
  return (ws.validations ?? []).find((v) => v.range.left <= col && v.range.right >= col)?.rule.kind;
}

test("identical body cells share one interned style", () => {
  const registry = new StyleRegistry();
  const before = registry.size();
  buildTable(createWorksheet("s", "Sheet1"), registry, templateById("task-list")!, at(0, 0));
  // A header style plus a handful of body shapes — nothing like one per cell.
  assert.ok(
    registry.size() - before < 15,
    `expected a flyweight, got ${registry.size() - before} styles`,
  );
});

test("regionIsEmpty sees a single occupied cell anywhere in the block", () => {
  const template = templateById("task-list")!;
  const rect = tableFootprint(template, at(0, 0));
  let ws = createWorksheet("s", "Sheet1");
  assert.equal(regionIsEmpty(ws, rect), true);
  ws = setCellValue(ws, 6, 2, "mine");
  assert.equal(regionIsEmpty(ws, rect), false, "a table must not silently eat this");
});

test("fitsOnSheet refuses an anchor that would run off the edge", () => {
  const ws = createWorksheet("s", "Sheet1");
  const template = templateById("project-tracker")!;
  assert.equal(fitsOnSheet(ws, template, at(0, 0)), true);
  assert.equal(fitsOnSheet(ws, template, at(ws.rowCount - 2, 0)), false, "not enough rows");
  assert.equal(fitsOnSheet(ws, template, at(0, ws.colCount - 2)), false, "not enough columns");
});
