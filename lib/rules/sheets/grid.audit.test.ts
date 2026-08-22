/**
 * Adversarial audit of `grid.ts` — structural edits, reference handling,
 * storage canonicalisation, and the chart/conditional plumbing.
 *
 * Assertions state CORRECT behaviour (real-spreadsheet semantics, or the
 * module's own documented intent) and document what the module does under
 * hostile input. Several of these pinned real bugs when first written
 * (structural deletes leaving fully-deleted ranges alive, sort stranding
 * images and floating blanks, quoted literals rewritten by fill, orphan
 * "A01"-style keys); those are fixed, and the tests stay to keep them fixed.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deleteColumns,
  deleteRows,
  insertRows,
  mergeCells,
  mergeAt,
  normalizeBorder,
  offsetReferences,
  parseRef,
  readSheet,
  readWorkbook,
  resizeRow,
  sortRange,
  unmergeCells,
  writeSheet,
  chartData,
  evalConditional,
  MAX_ROW_HEIGHT,
  MIN_ROW_HEIGHT,
  MAX_SHEETS,
  columnLabel,
  columnIndex,
  type ChartSpec,
  type SheetData,
} from "./grid.ts";

function sheet(cells: Record<string, string>, extra: Partial<SheetData> = {}): SheetData {
  return { cells, styles: {}, rows: 20, cols: 10, ...extra };
}

const lineChart = (range: string): ChartSpec => ({ id: "c1", type: "line", range, title: "T" });

/* ── Structural deletes vs dependent ranges (charts, rules, merges) ───────── */

test("deleting the rows a chart's whole range sat on removes the chart", () => {
  /* Chart over A3:B4 (rows 2..3); those exact rows are deleted. The chart's
     data is gone, so the chart must go too (the shift helper's own doc says a
     fully-deleted range "collapses to null"). Instead the spec survives
     UNCHANGED and now charts whatever shifted up into rows 2..3. */
  const before = sheet({ A3: "1", B4: "2", A5: "unrelated" }, { charts: [lineChart("A3:B4")] });
  const after = deleteRows(before, 2, 2);
  assert.equal(after.charts, undefined, "chart whose entire data range was deleted should be dropped");
});

test("deleting the rows a conditional rule's whole range sat on removes the rule", () => {
  const before = sheet(
    { A3: "5" },
    { conditionals: [{ id: "r", range: "A3:B4", kind: "greater", value: 1 }] },
  );
  const after = deleteRows(before, 2, 2);
  assert.equal(after.conditionals, undefined, "rule whose entire range was deleted should be dropped");
});

test("deleting the rows a merge covered removes the merge", () => {
  const before = sheet({}, { mergedRanges: ["A3:B4"] });
  const after = deleteRows(before, 2, 2);
  assert.equal(after.mergedRanges, undefined, "merge whose rows were all deleted should be dropped");
});

test("a chart range straddling the top of a deleted band clips to the surviving rows", () => {
  /* Chart rows 9..15 (A10:B16); rows 8..12 deleted. Survivors are old rows
     13..15, which land at 8..10 — so the clipped range is A9:B11. */
  const before = sheet({}, { rows: 30, charts: [lineChart("A10:B16")] });
  const after = deleteRows(before, 8, 5);
  assert.equal(after.charts?.[0]?.range, "A9:B11");
});

test("a chart range that collapses on delete does not resurrect as its original self", () => {
  /* Chart rows 2..5 (A3:B6); rows 0..3 deleted. Old rows 4..5 survive at 0..1,
     so the correct clipped range is A1:B2. This doubles as the guard against
     an emptied-charts result being spread as `{}` after `...data` and quietly
     reinstating the ORIGINAL, unshifted array — shiftChartsAndConditionals
     must overwrite the field (explicit `undefined`, as `images` is handled)
     even when every entry collapsed. */
  const before = sheet({}, { charts: [lineChart("A3:B6")] });
  const after = deleteRows(before, 0, 4);
  assert.equal(after.charts?.[0]?.range, "A1:B2");
});

test("deleting the columns a chart's whole range sat on removes the chart (column twin)", () => {
  const before = sheet({}, { charts: [lineChart("C1:D5")] });
  const after = deleteColumns(before, 2, 2);
  assert.equal(after.charts, undefined);
});

/* ── Structural edits that ARE handled right, pinned so they stay right ───── */

test("inserting rows inside a chart's range grows it; above, shifts it", () => {
  const inside = insertRows(sheet({}, { charts: [lineChart("A3:B6")] }), 4, 2);
  assert.equal(inside.charts?.[0]?.range, "A3:B8", "insert inside the range grows it");
  const above = insertRows(sheet({}, { charts: [lineChart("A3:B6")] }), 0, 2);
  assert.equal(above.charts?.[0]?.range, "A5:B8", "insert above the range shifts it");
});

test("a delete straddling the bottom of a range clips it correctly", () => {
  /* Range rows 0..3; rows 1..2 deleted → survivors old rows 0 and 3 → 0..1. */
  const after = deleteRows(sheet({}, { charts: [lineChart("A1:B4")] }), 1, 2);
  assert.equal(after.charts?.[0]?.range, "A1:B2");
});

test("hidden rows, row heights and images all move with a row delete", () => {
  const before = sheet(
    { A5: "x" },
    {
      hidden: [1, 4],
      rowHeights: { 1: 99, 4: 77 },
      images: { A2: { fileId: null, url: "u", name: "n" }, A5: { fileId: null, url: "v", name: "m" } },
    },
  );
  /* Delete row index 1: hidden 1 and height 1 and image A2 die with it; the
     entries at index 4 / A5 shift up to 3 / A4. */
  const after = deleteRows(before, 1, 1);
  assert.deepEqual(after.hidden, [3]);
  assert.deepEqual(after.rowHeights, { 3: 77 });
  assert.deepEqual(Object.keys(after.images ?? {}), ["A4"]);
  assert.equal(after.cells.A4, "x");
});

/* ── sortRange ────────────────────────────────────────────────────────────── */

test("sorting rows carries each row's image along with its values", () => {
  /* A1 holds "b" with an image; A2 holds "a". Ascending sort moves "b" to row 2 —
     the image is part of that record and must move with it. */
  const before = sheet(
    { A1: "b", A2: "a" },
    { images: { A1: { fileId: null, url: "u", name: "pic" } } },
  );
  const after = sortRange(before, { top: 0, left: 0, bottom: 1, right: 0 }, 0, "asc", false);
  assert.equal(after.cells.A1, "a");
  assert.equal(after.cells.A2, "b");
  assert.equal(after.images?.A2?.name, "pic", "the image should travel with its row");
});

test("ascending sort keeps blank rows at the bottom, as every spreadsheet does", () => {
  const before = sheet({ A1: "b", A3: "a" });
  const after = sortRange(before, { top: 0, left: 0, bottom: 2, right: 0 }, 0, "asc", false);
  assert.equal(after.cells.A1, "a");
  assert.equal(after.cells.A2, "b");
  assert.equal(after.cells.A3, undefined);
});

test("descending numeric sort is numeric, and styles travel with values", () => {
  const before: SheetData = {
    cells: { A1: "2", A2: "10" },
    styles: { A2: { bold: true } },
    rows: 20,
    cols: 10,
  };
  const after = sortRange(before, { top: 0, left: 0, bottom: 1, right: 0 }, 0, "desc", false);
  assert.deepEqual([after.cells.A1, after.cells.A2], ["10", "2"]);
  assert.deepEqual(after.styles.A1, { bold: true }, "the bold style follows its value");
  assert.equal(after.styles.A2, undefined);
});

/* ── offsetReferences ─────────────────────────────────────────────────────── */

test("filling a formula leaves quoted string literals alone", () => {
  /* Text that merely LOOKS like a reference inside quotes is the user's
     literal data — real spreadsheets never rewrite quoted text on fill. */
  assert.equal(
    offsetReferences('=CONCATENATE("A1",B2)', 1, 1),
    '=CONCATENATE("A1",C3)',
  );
});

test("offsetReferences keeps anchors, clamps at edges, skips function names", () => {
  assert.equal(offsetReferences("=$A$1+A1", 3, 3), "=$A$1+D4");
  assert.equal(offsetReferences("=A1", -9, -9), "=A1", "clamped at the top-left");
  assert.equal(offsetReferences("=LOG10(C3)", 1, 0), "=LOG10(C4)", "LOG10 is a function, not a cell");
  assert.equal(offsetReferences("=SUM(A1:B2)*2", 1, 1), "=SUM(B2:C3)*2");
  assert.equal(offsetReferences("plain A1 text", 5, 5), "plain A1 text", "non-formulas untouched");
});

/* ── Storage canonicalisation ─────────────────────────────────────────────── */

test("a stored ref with leading zeros lands on the cell it names", () => {
  /* parseRef("A01") is {row:0,col:0} — the same cell as "A1" — so parseSheet
     must re-encode the key through cellRef(parseRef(…)): a key kept as "A01"
     is an address the grid never looks up (every lookup goes through cellRef,
     which writes "A1"), invisible on screen yet surviving every save. */
  const s = readSheet('{"cells":{"A01":"7"},"styles":{"B02":{"bold":true}},"rows":10,"cols":5}');
  assert.equal(s.cells.A1, "7", '"A01" should canonicalise to A1');
  assert.equal("A01" in s.cells, false);
  assert.deepEqual(s.styles.B2, { bold: true }, '"B02" style should canonicalise to B2');
});

test("overlapping stored merges are resolved deterministically, out-of-bounds ones dropped", () => {
  const s = readSheet(
    JSON.stringify({
      cells: {},
      styles: {},
      rows: 10,
      cols: 5,
      mergedRanges: ["A1:B2", "B2:C3", "A9:B12", "D4:D4"],
    }),
  );
  /* First claim wins; the overlap, the out-of-bounds merge and the 1×1 all go. */
  assert.deepEqual(s.mergedRanges, ["A1:B2"]);
});

test("merge, unmerge and mergeAt agree with one another", () => {
  const merged = mergeCells(sheet({}), { top: 1, left: 1, bottom: 2, right: 2 });
  assert.deepEqual(merged.mergedRanges, ["B2:C3"]);
  assert.deepEqual(mergeAt(merged, 2, 2), { top: 1, left: 1, bottom: 2, right: 2 });
  assert.equal(mergeAt(merged, 0, 0), null);
  /* Merging an overlapping rect eats the old merge rather than double-claiming. */
  const remerged = mergeCells(merged, { top: 2, left: 2, bottom: 3, right: 3 });
  assert.deepEqual(remerged.mergedRanges, ["C3:D4"]);
  const cleared = unmergeCells(remerged, { top: 0, left: 0, bottom: 9, right: 9 });
  assert.equal(cleared.mergedRanges, undefined);
  /* A 1×1 merge is a no-op, not a stored range. */
  assert.equal(mergeCells(sheet({}), { top: 0, left: 0, bottom: 0, right: 0 }).mergedRanges, undefined);
});

test("legacy border strings still read; junk borders do not", () => {
  assert.deepEqual(normalizeBorder("all"), { top: true, right: true, bottom: true, left: true });
  assert.deepEqual(normalizeBorder("bottom"), { bottom: true });
  assert.equal(normalizeBorder("diagonal"), undefined);
  assert.equal(normalizeBorder({ top: false }), undefined, "an all-false object is no border");
  assert.equal(normalizeBorder(42), undefined);
});

test("resizeRow clamps a hostile height instead of storing it", () => {
  assert.equal(resizeRow(sheet({}), 0, 99999).rowHeights?.[0], MAX_ROW_HEIGHT);
  assert.equal(resizeRow(sheet({}), 0, -50).rowHeights?.[0], MIN_ROW_HEIGHT);
  assert.equal(resizeRow(sheet({}), 0, Number.NaN).rowHeights?.[0], MIN_ROW_HEIGHT);
});

test("a workbook with too many tabs is capped, not read whole", () => {
  const sheets = Array.from({ length: 40 }, (_, i) => ({
    id: `s${i}`,
    name: `S${i}`,
    cells: {},
    styles: {},
    rows: 10,
    cols: 5,
  }));
  const wb = readWorkbook(JSON.stringify({ sheets }));
  assert.equal(wb.sheets.length, MAX_SHEETS);
});

test("bijective base-26 round-trips at every carry boundary", () => {
  for (const [i, label] of [
    [25, "Z"],
    [26, "AA"],
    [51, "AZ"],
    [52, "BA"],
    [701, "ZZ"],
    [702, "AAA"],
  ] as const) {
    assert.equal(columnLabel(i), label);
    assert.equal(columnIndex(label), i);
  }
});

test("writeSheet drops empty charts/conditionals arrays rather than storing []", () => {
  const json = writeSheet(sheet({}, { charts: [], conditionals: [], mergedRanges: [] }));
  const raw = JSON.parse(json);
  assert.equal("charts" in raw, false);
  assert.equal("conditionals" in raw, false);
  assert.equal("mergedRanges" in raw, false);
});

/* ── chartData & conditionals on degenerate input ─────────────────────────── */

test("chartData on an unparsable or empty range charts nothing, not garbage", () => {
  const empty = () => ({ text: "", number: null });
  assert.deepEqual(chartData("nonsense", empty), { labels: [], series: [] });
  const blank = chartData("A1:B3", empty);
  /* An all-blank block: no header detected, series of zeros — flat but sane. */
  assert.equal(blank.series.length, 1);
  assert.deepEqual(blank.series[0].values, [0, 0, 0]);
});

test("a colour scale over identical values sits at the neutral midpoint", () => {
  const rule = { id: "r", range: "A1:A3", kind: "colorScale" as const };
  const stats = {
    min: 5, max: 5, mean: 5, count: 3, sortedDesc: [5, 5, 5],
    textCounts: new Map<string, number>(),
  };
  const res = evalConditional(rule, { value: 5, text: "5" }, stats);
  assert.equal(res?.bg, "rgb(255, 235, 132)", "min==max maps to t=0.5, the yellow middle stop");
});

test("a data bar clamps negatives to an empty bar rather than a negative width", () => {
  const rule = { id: "r", range: "A1:A3", kind: "dataBar" as const };
  const stats = {
    min: -10, max: 10, mean: 0, count: 3, sortedDesc: [10, 0, -10],
    textCounts: new Map<string, number>(),
  };
  assert.equal(evalConditional(rule, { value: -10, text: "-10" }, stats)?.bar?.pct, 0);
  assert.equal(evalConditional(rule, { value: 10, text: "10" }, stats)?.bar?.pct, 1);
});

test("parseRef refuses what only looks like a reference", () => {
  assert.equal(parseRef("A1:B2"), null, "a range is not a single ref");
  assert.deepEqual(parseRef(" A1 "), { row: 0, col: 0 }, "surrounding whitespace is trimmed");
  assert.equal(parseRef("$A$1"), null, "anchors are formula syntax, not storage keys");
  assert.equal(parseRef("A-1"), null);
});
