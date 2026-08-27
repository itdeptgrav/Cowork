/**
 * Adversarial audit of `aiTools.ts` — each tool hit with wrong-range,
 * out-of-bounds and boundary arguments, checked against the sheet the action
 * would actually apply to. The ref-canonicalisation, unchecked-insert and
 * reversed-between cases pinned real bugs when first written; fixed, and
 * kept to keep them so.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { sheetsActionRequiresConfirmation, validateSheetsToolCall } from "./aiTools.ts";
import type { SheetData } from "./grid.ts";

function sheet(overrides: Partial<SheetData> = {}): SheetData {
  return { cells: {}, styles: {}, rows: 50, cols: 20, ...overrides };
}

/* ── Reference canonicalisation ───────────────────────────────────────────── */

test("set_cells canonicalises a zero-padded ref to the cell it names", () => {
  /* "B02" parses to row 1 / col 1 — the cell everyone calls B2. Passing the
     raw key through would mean the apply step writes cells["B02"], an address
     the grid NEVER reads back (all lookups go through cellRef → "B2"): the
     user clicks Apply and sees nothing happen. So every ref is re-encoded
     via cellRef(parseRef(ref)), never merely uppercased. */
  const r = validateSheetsToolCall("set_cells", { cells: [{ ref: "B02", value: "9" }] }, sheet());
  assert.equal(r.ok, true);
  if (r.ok && r.action.tool === "set_cells") assert.equal(r.action.cells[0].ref, "B2");
});

test("set_formula and flag_outliers canonicalise zero-padded refs the same way", () => {
  const f = validateSheetsToolCall(
    "set_formula",
    { ref: "A01", formula: "=SUM(B1:B2)", explanation: "" },
    sheet(),
  );
  assert.equal(f.ok, true);
  if (f.ok && f.action.tool === "set_formula") assert.equal(f.action.ref, "A1");

  const o = validateSheetsToolCall(
    "flag_outliers",
    { range: "A1:A10", flags: [{ ref: "A03", reason: "high" }] },
    sheet(),
  );
  assert.equal(o.ok, true);
  if (o.ok && o.action.tool === "flag_outliers") assert.equal(o.action.flags[0].ref, "A3");
});

/* ── Structural bounds ────────────────────────────────────────────────────── */

test("insert_rows far beyond the sheet's end is rejected, as delete_rows is", () => {
  /* Unchecked, the action would apply as a no-op-looking row-count inflation
     (nothing shifts, the sheet just grows), which reads to the user as "the
     assistant did nothing". `beforeRow` of rows+1 — insert below the last
     row, the same append the grid's own menu performs — stays allowed. */
  const r = validateSheetsToolCall("insert_rows", { beforeRow: 9999, count: 3 }, sheet({ rows: 50 }));
  assert.equal(r.ok, false);
  assert.equal(validateSheetsToolCall("insert_rows", { beforeRow: 51, count: 1 }, sheet({ rows: 50 })).ok, true);
  assert.equal(validateSheetsToolCall("insert_rows", { beforeRow: 52, count: 1 }, sheet({ rows: 50 })).ok, false);
});

test("insert_columns beyond the sheet's end is rejected, as delete_columns is", () => {
  const r = validateSheetsToolCall("insert_columns", { beforeColumn: "AZ", count: 1 }, sheet({ cols: 20 }));
  assert.equal(r.ok, false);
  /* "U" is column 21 on a 20-column sheet — the append-after-last position. */
  assert.equal(validateSheetsToolCall("insert_columns", { beforeColumn: "U", count: 1 }, sheet({ cols: 20 })).ok, true);
  assert.equal(validateSheetsToolCall("insert_columns", { beforeColumn: "V", count: 1 }, sheet({ cols: 20 })).ok, false);
});

test("delete bounds are exact at the last row and column", () => {
  assert.equal(validateSheetsToolCall("delete_rows", { startRow: 50, count: 1 }, sheet({ rows: 50 })).ok, true);
  assert.equal(validateSheetsToolCall("delete_rows", { startRow: 50, count: 2 }, sheet({ rows: 50 })).ok, false);
  assert.equal(validateSheetsToolCall("delete_columns", { startColumn: "T", count: 1 }, sheet({ cols: 20 })).ok, true);
  assert.equal(validateSheetsToolCall("delete_columns", { startColumn: "T", count: 2 }, sheet({ cols: 20 })).ok, false);
});

test("fractional and hostile counts are rounded or refused, never applied raw", () => {
  const r = validateSheetsToolCall("insert_rows", { beforeRow: 1, count: 2.4 }, sheet());
  assert.equal(r.ok && r.action.tool === "insert_rows" && r.action.count, 2);
  assert.equal(validateSheetsToolCall("insert_rows", { beforeRow: 1, count: 0.4 }, sheet()).ok, false, "rounds to 0 — invalid");
  assert.equal(validateSheetsToolCall("insert_rows", { beforeRow: 1, count: Infinity }, sheet()).ok, false);
  assert.equal(validateSheetsToolCall("insert_rows", { beforeRow: 1, count: "3" }, sheet()).ok, false, "a string count is malformed, not coerced");
});

/* ── Rules that can never fire ────────────────────────────────────────────── */

test("a between rule with reversed bounds is not applied as written", () => {
  /* evalConditional tests value ≥ low AND ≤ high; with value=10/value2=2 the
     rule can never match. The module's own header says argument checking
     exists precisely "so a rule that can never match isn't applied silently" —
     reversed bounds are that same failure wearing different clothes. The
     validator swaps them, as Excel does. */
  const r = validateSheetsToolCall(
    "apply_conditional_format",
    { range: "A1:A5", kind: "between", value: 10, value2: 2 },
    sheet(),
  );
  assert.equal(r.ok, true);
  if (r.ok && r.action.tool === "apply_conditional_format") {
    assert.equal(r.action.value, 2);
    assert.equal(r.action.value2, 10);
  }
});

/* ── Wrong-range and boundary behaviour that IS correct ───────────────────── */

test("a backwards range string is normalised, not refused or misread", () => {
  const r = validateSheetsToolCall(
    "format_range",
    { range: "B5:A1", style: { bold: true } },
    sheet(),
  );
  assert.equal(r.ok, true);
  if (r.ok && r.action.tool === "format_range")
    assert.deepEqual(r.action.rect, { top: 0, left: 0, bottom: 4, right: 1 });
});

test("sort/filter columns are validated against the range, case-insensitively", () => {
  assert.equal(
    validateSheetsToolCall("sort_range", { range: "B2:D9", byColumn: "c", direction: "asc" }, sheet()).ok,
    true,
  );
  assert.equal(
    validateSheetsToolCall("sort_range", { range: "B2:D9", byColumn: "A", direction: "asc" }, sheet()).ok,
    false,
    "left of the range",
  );
  assert.equal(
    validateSheetsToolCall("filter_range", { range: "B2:D9", byColumn: "E", condition: "notEmpty" }, sheet()).ok,
    false,
    "right of the range",
  );
});

test("filter empty/notEmpty need no value; equals/contains refuse an empty one", () => {
  assert.equal(
    validateSheetsToolCall("filter_range", { range: "A1:A9", byColumn: "A", condition: "empty" }, sheet()).ok,
    true,
  );
  assert.equal(
    validateSheetsToolCall("filter_range", { range: "A1:A9", byColumn: "A", condition: "contains", value: "" }, sheet()).ok,
    false,
  );
});

test("set_cells enforces its cap exactly and validates every ref against the live sheet", () => {
  const at = (n: number) => ({
    cells: Array.from({ length: n }, (_, i) => ({ ref: `A${i + 1}`, value: "x" })),
  });
  assert.equal(validateSheetsToolCall("set_cells", at(500), sheet({ rows: 500 })).ok, true);
  assert.equal(validateSheetsToolCall("set_cells", at(501), sheet({ rows: 501 })).ok, false);
  /* One bad ref poisons the whole batch — atomic accept/refuse, no partial writes. */
  const mixed = { cells: [{ ref: "A1", value: "ok" }, { ref: "A51", value: "past the end" }] };
  assert.equal(validateSheetsToolCall("set_cells", mixed, sheet({ rows: 50 })).ok, false);
});

test("create_table fits exactly to the last row, and lowercase anchors are uppercased", () => {
  const args = { anchor: "a48", headers: ["H1", "H2"], rows: [["1", "2"], ["3", "4"]] };
  const r = validateSheetsToolCall("create_table", args, sheet({ rows: 50 }));
  assert.equal(r.ok, true, "header at row 48, data in 49–50 — exactly fits a 50-row sheet");
  if (r.ok && r.action.tool === "create_table") assert.equal(r.action.anchor, "A48");
  const tooTall = { ...args, anchor: "A49" };
  assert.equal(validateSheetsToolCall("create_table", tooTall, sheet({ rows: 50 })).ok, false);
});

test("create_table refuses ragged rows rather than padding them", () => {
  const r = validateSheetsToolCall(
    "create_table",
    { anchor: "A1", headers: ["A", "B"], rows: [["1", "2"], ["only-one"]] },
    sheet(),
  );
  assert.equal(r.ok, false);
});

test("a single-row chart range is allowed; a single cell is not", () => {
  assert.equal(
    validateSheetsToolCall("create_chart", { range: "A1:C1", chartType: "bar", title: "t" }, sheet()).ok,
    true,
  );
  assert.equal(
    validateSheetsToolCall("create_chart", { range: "B2", chartType: "bar", title: "t" }, sheet()).ok,
    false,
  );
});

test("confirmation judges overwrites against the LIVE sheet, not the proposal alone", () => {
  const empty = sheet();
  const full = sheet({
    cells: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`A${i + 1}`, "data"])),
  });
  const proposal = {
    cells: Array.from({ length: 12 }, (_, i) => ({ ref: `A${i + 1}`, value: "new" })),
  };
  const r = validateSheetsToolCall("set_cells", proposal, full);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(sheetsActionRequiresConfirmation(r.action, full), true, "12 real cells overwritten");
    assert.equal(sheetsActionRequiresConfirmation(r.action, empty), false, "same proposal onto blanks is safe");
  }
});

test("rename_sheet trims, refuses blank and over-long names", () => {
  const r = validateSheetsToolCall("rename_sheet", { title: "  Q1 Actuals  " }, sheet());
  assert.equal(r.ok && r.action.tool === "rename_sheet" && r.action.title, "Q1 Actuals");
  assert.equal(validateSheetsToolCall("rename_sheet", { title: "   " }, sheet()).ok, false);
  assert.equal(validateSheetsToolCall("rename_sheet", { title: "x".repeat(121) }, sheet()).ok, false);
});

test("an unknown tool is named in the refusal so the log is debuggable", () => {
  const r = validateSheetsToolCall("evaluate_formula", {}, sheet());
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /evaluate_formula/);
});
