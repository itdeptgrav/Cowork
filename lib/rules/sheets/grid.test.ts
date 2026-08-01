import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cellRef,
  chartData,
  colorScale,
  columnIndex,
  columnLabel,
  COMMON_FUNCTIONS,
  evalConditional,
  explainError,
  rangeToRect,
  displayValue,
  formatNumber,
  formulaAcceptsReference,
  formulaFunctionPrefix,
  inRect,
  summarize,
  isFormula,
  matchFunctionNames,
  MAX_ROWS,
  normalizeRange,
  offsetReferences,
  parseClipboardTable,
  parseRef,
  rangeLabel,
  readSheet,
  writeSheet,
} from "./grid.ts";

/* ── Column addressing ────────────────────────────────────────────────────── */

test("columns are bijective base-26, not ordinary base-26", () => {
  /* The usual bug here: there is no zero digit, so 26 is AA and not BA. */
  assert.equal(columnLabel(0), "A");
  assert.equal(columnLabel(25), "Z");
  assert.equal(columnLabel(26), "AA");
  assert.equal(columnLabel(27), "AB");
  assert.equal(columnLabel(51), "AZ");
  assert.equal(columnLabel(52), "BA");
});

test("column labels round-trip", () => {
  for (const i of [0, 1, 25, 26, 27, 51, 52, 700]) {
    assert.equal(columnIndex(columnLabel(i)), i, `failed at ${i}`);
  }
});

test("a non-column is refused rather than coerced", () => {
  assert.equal(columnIndex("A1"), -1);
  assert.equal(columnIndex("3"), -1);
  assert.equal(columnIndex(""), -1);
});

test("references round-trip and are case-insensitive on the way in", () => {
  assert.equal(cellRef(0, 0), "A1");
  assert.equal(cellRef(9, 26), "AA10");
  assert.deepEqual(parseRef("aa10"), { row: 9, col: 26 });
  assert.equal(parseRef("A0"), null);
  assert.equal(parseRef("1A"), null);
  assert.equal(parseRef(""), null);
});

test("a formula is what starts with =, after any leading space", () => {
  assert.equal(isFormula("=SUM(A1:A9)"), true);
  assert.equal(isFormula("  =A1+1"), true);
  assert.equal(isFormula("SUM(A1)"), false);
  assert.equal(isFormula("3"), false);
});

/* ── Storage ──────────────────────────────────────────────────────────────── */

test("cells are stored sparsely", () => {
  /* A 200×26 grid with two values must not become 5,200 entries. */
  const json = writeSheet({
    cells: { A1: "1", B2: "=A1*2" },
    styles: {},
    rows: 200,
    cols: 26,
  });
  assert.deepEqual(JSON.parse(json).cells, { A1: "1", B2: "=A1*2" });
});

test("clearing a cell shrinks the sheet rather than storing an empty", () => {
  /* Otherwise a sheet that has been filled and emptied stays as large as it
     ever was. */
  const json = writeSheet({
    cells: { A1: "", B1: "keep" },
    styles: {},
    rows: 10,
    cols: 5,
  });
  assert.deepEqual(Object.keys(JSON.parse(json).cells), ["B1"]);
});

test("an all-false style is not stored", () => {
  const json = writeSheet({
    cells: {},
    styles: { A1: { bold: false }, B1: { bold: true } },
    rows: 10,
    cols: 5,
  });
  assert.deepEqual(Object.keys(JSON.parse(json).styles), ["B1"]);
});

test("a sheet round-trips", () => {
  const data = {
    cells: { A1: "1", B1: "=A1+1" },
    styles: { A1: { bold: true } },
    rows: 50,
    cols: 10,
  };
  assert.deepEqual(readSheet(writeSheet(data)), data);
});

/* ── Reading anything ─────────────────────────────────────────────────────── */

test("unreadable JSON opens an empty sheet rather than throwing", () => {
  /* A spreadsheet that will not open is worse than one that opens blank — the
     second still lets somebody paste their data back in. */
  for (const bad of ["", "not json", "null", "[1,2,3]", '{"cells":5}']) {
    const s = readSheet(bad);
    assert.deepEqual(s.cells, {}, `threw or kept junk for: ${bad}`);
  }
});

test("keys that are not references are dropped", () => {
  const s = readSheet('{"cells":{"A1":"ok","nonsense":"x","3":"y"}}');
  assert.deepEqual(s.cells, { A1: "ok" });
});

test("a non-string value is dropped, not passed to the engine", () => {
  const s = readSheet('{"cells":{"A1":{"nested":true},"B1":"fine"}}');
  assert.deepEqual(s.cells, { B1: "fine" });
});

test("absurd dimensions are clamped", () => {
  /* A corrupt stored sheet must not ask the grid for a billion cells. */
  const s = readSheet('{"cells":{},"rows":999999,"cols":9999}');
  assert.equal(s.rows, MAX_ROWS);
  assert.ok(s.cols <= 52);
});

/* ── Display ──────────────────────────────────────────────────────────────── */

test("an error shows its CODE, never blank or [object Object]", () => {
  /* The code is what tells somebody which formula to fix. */
  assert.equal(displayValue({ type: "DIV_BY_ZERO", value: "#DIV/0!" }), "#DIV/0!");
  assert.equal(displayValue({ type: "REF" }), "#REF");
  assert.equal(displayValue({}), "#ERROR!");
});

test("numbers, booleans and blanks read as a spreadsheet shows them", () => {
  assert.equal(displayValue(3), "3");
  assert.equal(displayValue(2.5), "2.5");
  assert.equal(displayValue(true), "TRUE");
  assert.equal(displayValue(null), "");
  /* Floating point noise is trimmed — 0.1+0.2 must not read 0.30000000000000004. */
  assert.equal(displayValue(0.1 + 0.2), "0.3");
});

/* ── Clipboard paste ──────────────────────────────────────────────────────── */

test("a single copied value is a 1x1 table", () => {
  assert.deepEqual(parseClipboardTable("42"), [["42"]]);
  assert.deepEqual(parseClipboardTable("=SUM(A1:A9)"), [["=SUM(A1:A9)"]]);
});

test("an Excel block splits on tabs and newlines", () => {
  assert.deepEqual(parseClipboardTable("a\tb\nc\td"), [
    ["a", "b"],
    ["c", "d"],
  ]);
});

test("the trailing newline Excel appends does not add a phantom row", () => {
  /* Excel/Sheets end a copied block with a newline; keeping it would clear the
     row just below the paste. Interior blank rows, however, are preserved. */
  assert.deepEqual(parseClipboardTable("a\nb\n"), [["a"], ["b"]]);
  assert.deepEqual(parseClipboardTable("a\n\nb"), [["a"], [""], ["b"]]);
});

test("Windows CRLF is normalised so no stray carriage returns land in cells", () => {
  assert.deepEqual(parseClipboardTable("a\tb\r\nc\td"), [
    ["a", "b"],
    ["c", "d"],
  ]);
});

test("an empty clipboard is nothing to paste", () => {
  assert.deepEqual(parseClipboardTable(""), []);
});

/* ── Number formats ───────────────────────────────────────────────────────── */

test("currency, percent and comma format a number without changing it", () => {
  assert.equal(formatNumber(1234.5, "currency"), "₹1,234.50");
  assert.equal(formatNumber(0.5, "percent"), "50%");
  assert.equal(formatNumber(1234, "comma"), "1,234");
  /* plain and absent both fall to the shortest honest form. */
  assert.equal(formatNumber(0.1 + 0.2, "plain"), "0.3");
  assert.equal(formatNumber(42, undefined), "42");
});

test("fixed decimals pin both bounds, on a format or a plain number", () => {
  assert.equal(formatNumber(1.2, "currency", 3), "₹1.200");
  assert.equal(formatNumber(5, undefined, 2), "5.00");
  assert.equal(formatNumber(5, undefined, 0), "5");
  /* Bounded so a runaway value cannot ask for a thousand places. */
  assert.equal(formatNumber(1, undefined, 99).length <= 20, true);
});

/* ── Selection summary ────────────────────────────────────────────────────── */

test("the summary counts only numbers and reports sum, average and bounds", () => {
  const s = summarize([2, 4, 6]);
  assert.deepEqual(s, { count: 3, sum: 12, avg: 4, min: 2, max: 6 });
});

test("an empty or all-text selection summarises to nothing, not to zero average", () => {
  const s = summarize([]);
  assert.equal(s.count, 0);
  assert.equal(s.avg, null);
  assert.equal(s.min, null);
});

/* ── Charts ───────────────────────────────────────────────────────────────── */

test("rangeToRect reads a range or a single cell", () => {
  assert.deepEqual(rangeToRect("A1:B3"), { top: 0, left: 0, bottom: 2, right: 1 });
  assert.deepEqual(rangeToRect("C2"), { top: 1, left: 2, bottom: 1, right: 2 });
  assert.equal(rangeToRect("nonsense"), null);
});

const asCell =
  (grid: Record<string, { text: string; number: number | null }>) =>
  (r: number, c: number) => grid[`${r},${c}`] ?? { text: "", number: null };

test("a chart takes labels from the first column and a named series from a header", () => {
  const m = chartData(
    "A1:B3",
    asCell({
      "0,0": { text: "Month", number: null },
      "0,1": { text: "Sales", number: null },
      "1,0": { text: "Jan", number: null },
      "1,1": { text: "10", number: 10 },
      "2,0": { text: "Feb", number: null },
      "2,1": { text: "20", number: 20 },
    }),
  );
  assert.deepEqual(m.labels, ["Jan", "Feb"]);
  assert.equal(m.series.length, 1);
  assert.equal(m.series[0].name, "Sales");
  assert.deepEqual(m.series[0].values, [10, 20]);
});

test("a single column charts its own values, indexed, named by its header", () => {
  const m = chartData(
    "A1:A3",
    asCell({
      "0,0": { text: "Qty", number: null },
      "1,0": { text: "5", number: 5 },
      "2,0": { text: "8", number: 8 },
    }),
  );
  assert.equal(m.series[0].name, "Qty");
  assert.deepEqual(m.series[0].values, [5, 8]);
  assert.deepEqual(m.labels, ["1", "2"]);
});

/* ── Conditional formatting ───────────────────────────────────────────────── */

/** A RuleStats with sensible defaults, so a test names only what it cares about. */
const cfStats = (o: Partial<import("./grid.ts").RuleStats> = {}) => ({
  min: 0,
  max: 0,
  mean: 0,
  count: 0,
  sortedDesc: [] as number[],
  textCounts: new Map<string, number>(),
  ...o,
});
const cell = (value: number | null, text = value === null ? "" : String(value)) => ({
  value,
  text,
});

test("a greater-than rule fires above its threshold and nowhere else", () => {
  const rule = {
    id: "r",
    range: "A1:A3",
    kind: "greater" as const,
    value: 10,
    color: "#f00",
  };
  const stats = cfStats({ min: 0, max: 100 });
  assert.deepEqual(evalConditional(rule, cell(20), stats), { bg: "#f00" });
  assert.equal(evalConditional(rule, cell(5), stats), null);
  assert.equal(
    evalConditional(rule, cell(null), stats),
    null,
    "blanks are not formatted",
  );
});

test("a colour scale maps low to red and high to green", () => {
  const rule = { id: "r", range: "A1:A3", kind: "colorScale" as const };
  const s = cfStats({ min: 0, max: 10 });
  assert.equal(evalConditional(rule, cell(0), s)?.bg, colorScale(0));
  assert.equal(evalConditional(rule, cell(10), s)?.bg, colorScale(1));
  assert.equal(colorScale(0), "rgb(248, 105, 107)");
  assert.equal(colorScale(1), "rgb(99, 190, 123)");
});

test("a data bar fills proportional to the range's max", () => {
  const rule = { id: "r", range: "A1:A3", kind: "dataBar" as const };
  const s = cfStats({ min: 0, max: 10 });
  assert.equal(evalConditional(rule, cell(5), s)?.bar?.pct, 0.5);
  assert.equal(evalConditional(rule, cell(10), s)?.bar?.pct, 1);
});

test("a rich style beats the legacy colour and carries text/bold/border", () => {
  const rule = {
    id: "r",
    range: "A1:A3",
    kind: "greater" as const,
    value: 0,
    color: "#f00",
    style: { bg: "#0f0", textColor: "#00f", bold: true, border: true },
  };
  assert.deepEqual(evalConditional(rule, cell(5), cfStats()), {
    bg: "#0f0",
    textColor: "#00f",
    bold: true,
    border: true,
  });
  /* A style with only a text colour applies no fill (not the default). */
  const textOnly = { ...rule, color: undefined, style: { textColor: "#123456" } };
  assert.deepEqual(evalConditional(textOnly, cell(5), cfStats()), {
    textColor: "#123456",
  });
});

test("top-N, above-average and duplicate rules use the range summary", () => {
  const stats = cfStats({
    min: 10,
    max: 50,
    mean: 30,
    count: 5,
    sortedDesc: [50, 40, 30, 20, 10],
  });
  const top2 = { id: "t", range: "A1:A5", kind: "top" as const, value: 2 };
  assert.ok(evalConditional(top2, cell(40), stats), "40 is in the top 2");
  assert.equal(evalConditional(top2, cell(30), stats), null, "30 is not");

  const bottom2 = { id: "b", range: "A1:A5", kind: "bottom" as const, value: 2 };
  assert.ok(evalConditional(bottom2, cell(20), stats), "20 is in the bottom 2");
  assert.equal(evalConditional(bottom2, cell(30), stats), null);

  const above = { id: "a", range: "A1:A5", kind: "aboveAvg" as const };
  assert.ok(evalConditional(above, cell(31), stats));
  assert.equal(evalConditional(above, cell(30), stats), null, "equal to mean is not above");

  const dup = {
    id: "d",
    range: "A1:A5",
    kind: "duplicate" as const,
  };
  const dupStats = cfStats({ textCounts: new Map([["x", 2], ["y", 1]]) });
  assert.ok(evalConditional(dup, cell(null, "x"), dupStats));
  assert.equal(evalConditional(dup, cell(null, "y"), dupStats), null);
});

test("text, blank and error rules read the shown text", () => {
  const contains = {
    id: "c",
    range: "A1:A3",
    kind: "textContains" as const,
    text: "raf",
  };
  assert.ok(evalConditional(contains, cell(null, "Draft"), cfStats()), "case-insensitive");
  assert.equal(evalConditional(contains, cell(null, "final"), cfStats()), null);

  const blank = { id: "b", range: "A1:A3", kind: "blank" as const };
  assert.ok(evalConditional(blank, cell(null, ""), cfStats()));
  assert.equal(evalConditional(blank, cell(null, "x"), cfStats()), null);

  const err = { id: "e", range: "A1:A3", kind: "error" as const };
  assert.ok(evalConditional(err, cell(null, "#REF!"), cfStats()));
  assert.equal(evalConditional(err, cell(null, "12"), cfStats()), null);
});

test("an icon-set rule buckets the value into thirds", () => {
  const rule = { id: "i", range: "A1:A3", kind: "iconSet" as const };
  const s = cfStats({ min: 0, max: 9 });
  assert.equal(evalConditional(rule, cell(1), s)?.icon?.ch, "▼", "low third");
  assert.equal(evalConditional(rule, cell(5), s)?.icon?.ch, "▶", "middle third");
  assert.equal(evalConditional(rule, cell(9), s)?.icon?.ch, "▲", "top third");
});

test("a redesigned rule round-trips every field, legacy rules still read", () => {
  const rule = {
    id: "r1",
    range: "A1:B4",
    kind: "top" as const,
    value: 3,
    text: "n/a",
    enabled: false,
    order: 2,
    stopIfTrue: true,
    style: { bg: "#112233", textColor: "#445566", bold: true, italic: true, border: true },
    iconSet: "traffic" as const,
    minColor: "#ff0000",
    midColor: "#ffff00",
    maxColor: "#00ff00",
  };
  const back = readSheet(
    writeSheet({ cells: {}, styles: {}, rows: 8, cols: 5, conditionals: [rule] }),
  );
  assert.deepEqual(back.conditionals?.[0], rule);

  const legacy = readSheet(
    JSON.stringify({
      cells: {},
      styles: {},
      rows: 8,
      cols: 5,
      conditionals: [
        { id: "old", range: "A1:A3", kind: "greater", value: 5, color: "#f00" },
      ],
    }),
  );
  assert.deepEqual(legacy.conditionals?.[0], {
    id: "old",
    range: "A1:A3",
    kind: "greater",
    value: 5,
    color: "#f00",
  });
});

test("non-numbers in a series read as gaps, not omissions", () => {
  const m = chartData(
    "A1:B2",
    asCell({
      "0,0": { text: "x", number: null },
      "0,1": { text: "", number: null },
      "1,0": { text: "y", number: null },
      "1,1": { text: "3", number: 3 },
    }),
  );
  /* No header (top series cell is blank, not text), so both rows are data. */
  assert.deepEqual(m.series[0].values, [0, 3]);
});

/* ── Selection ────────────────────────────────────────────────────────────── */

test("a range normalises whichever way it was dragged", () => {
  const forward = normalizeRange({ row: 1, col: 1 }, { row: 3, col: 4 });
  const backward = normalizeRange({ row: 3, col: 4 }, { row: 1, col: 1 });
  assert.deepEqual(forward, { top: 1, left: 1, bottom: 3, right: 4 });
  assert.deepEqual(backward, forward, "drag direction must not matter");
});

test("inRect includes the edges and excludes the outside", () => {
  const r = normalizeRange({ row: 1, col: 1 }, { row: 2, col: 2 });
  assert.equal(inRect(1, 1, r), true);
  assert.equal(inRect(2, 2, r), true);
  assert.equal(inRect(0, 1, r), false);
  assert.equal(inRect(3, 2, r), false);
});

test("a range reads as A1 or A1:C3", () => {
  assert.equal(rangeLabel({ top: 0, left: 0, bottom: 0, right: 0 }), "A1");
  assert.equal(rangeLabel({ top: 0, left: 0, bottom: 2, right: 2 }), "A1:C3");
});

/* ── Formula completion ───────────────────────────────────────────────────── */

test("a formula being typed offers the function under the caret", () => {
  assert.equal(formulaFunctionPrefix("=SU"), "SU");
  assert.equal(formulaFunctionPrefix("=sum(a1)+av"), "AV");
});

test("filling a formula shifts relative refs and keeps absolute ones", () => {
  assert.equal(offsetReferences("=A1+$B$1", 1, 0), "=A2+$B$1");
  assert.equal(offsetReferences("=SUM(A1:A3)", 2, 0), "=SUM(A3:A5)");
  assert.equal(offsetReferences("=B2", 0, 1), "=C2");
  /* A function name that ends in digits is not a reference. */
  assert.equal(offsetReferences("=LOG10(A1)", 1, 0), "=LOG10(A2)");
  /* Not a formula, and edge-clamped so nothing goes negative. */
  assert.equal(offsetReferences("plain", 1, 0), "plain");
  assert.equal(offsetReferences("=A1", -5, 0), "=A1");
});

test("a value, a bare =, and a cell reference offer nothing", () => {
  assert.equal(formulaFunctionPrefix("42"), null, "not a formula");
  assert.equal(formulaFunctionPrefix("=123"), null, "a number, not a name");
  assert.equal(formulaFunctionPrefix("=A1"), null, "the tail of a reference");
});

test("a formula waiting for a reference is one ending in = ( , or an operator", () => {
  for (const t of ["=", "=SUM(", "=A1+", "=SUM(A1,", "=SUM(A1:", "=A1*2+"]) {
    assert.equal(formulaAcceptsReference(t), true, `${t} should accept a ref`);
  }
  for (const t of ["=A1", "=SUM(A1:B2)", "42", "hello", "=SUM(A1)"]) {
    assert.equal(formulaAcceptsReference(t), false, `${t} should not`);
  }
});

test("name matching is prefix, sorted, and capped", () => {
  const m = matchFunctionNames("SU");
  assert.ok(m.includes("SUM") && m.includes("SUMIF"));
  assert.ok(m.every((n) => n.startsWith("SU")));
  assert.deepEqual(
    matchFunctionNames("s", ["SUM", "SUMIF", "SIN"], 2),
    ["SIN", "SUM"],
    "sorted and limited",
  );
  assert.deepEqual(matchFunctionNames(""), [], "no prefix, no menu");
  assert.ok(COMMON_FUNCTIONS.includes("VLOOKUP"));
});

test("the offered functions include the requested Excel set the engine evaluates", () => {
  for (const fn of [
    "IFS", "AND", "OR", "XLOOKUP", "VLOOKUP", "INDEX", "MATCH", "SUMIF",
    "SUMIFS", "COUNTIF", "COUNTIFS", "FILTER", "SWITCH", "TEXTJOIN",
  ]) {
    assert.ok(COMMON_FUNCTIONS.includes(fn), `${fn} should be offered`);
  }
  /* Sorted and de-duplicated, so the menu is stable and never repeats a name. */
  const sorted = [...COMMON_FUNCTIONS].sort((a, b) => a.localeCompare(b));
  assert.deepEqual([...COMMON_FUNCTIONS], sorted, "kept in sorted order");
  assert.equal(
    new Set(COMMON_FUNCTIONS).size,
    COMMON_FUNCTIONS.length,
    "no duplicates",
  );
});

/* ── Embedded charts ──────────────────────────────────────────────────────── */

test("a chart round-trips its embedded placement and config", () => {
  const spec = {
    id: "c1",
    type: "doughnut" as const,
    range: "A1:B4",
    title: "Split",
    x: 120,
    y: 40,
    w: 360,
    h: 220,
    z: 3,
    legend: false,
    axes: true,
    orientation: "rows" as const,
    stacked: true,
  };
  const back = readSheet(
    writeSheet({ cells: {}, styles: {}, rows: 10, cols: 5, charts: [spec] }),
  );
  assert.deepEqual(back.charts?.[0], spec);
  /* A legacy bare chart still reads; the new fields are simply absent. */
  const legacy = readSheet(
    JSON.stringify({
      cells: {},
      styles: {},
      rows: 10,
      cols: 5,
      charts: [{ id: "c2", type: "pie", range: "A1:A3", title: "T" }],
    }),
  );
  assert.deepEqual(legacy.charts?.[0], {
    id: "c2",
    type: "pie",
    range: "A1:A3",
    title: "T",
  });
});

test("a chart reads series from rows when the orientation says so", () => {
  const g: Record<string, { text: string; number: number | null }> = {
    "0,0": { text: "", number: null },
    "0,1": { text: "Q1", number: null },
    "0,2": { text: "Q2", number: null },
    "1,0": { text: "Sales", number: null },
    "1,1": { text: "10", number: 10 },
    "1,2": { text: "20", number: 20 },
    "2,0": { text: "Cost", number: null },
    "2,1": { text: "3", number: 3 },
    "2,2": { text: "4", number: 4 },
  };
  const cell = (r: number, c: number) =>
    g[`${r},${c}`] ?? { text: "", number: null };

  const rows = chartData("A1:C3", cell, "rows");
  assert.deepEqual(rows.labels, ["Q1", "Q2"]);
  assert.deepEqual(rows.series, [
    { name: "Sales", values: [10, 20] },
    { name: "Cost", values: [3, 4] },
  ]);

  /* The same block, read by columns (the default), transposes the reading. */
  const cols = chartData("A1:C3", cell);
  assert.deepEqual(
    cols.series.map((s) => s.name),
    ["Q1", "Q2"],
  );
});

/* ── Error explanations ───────────────────────────────────────────────────── */

test("error codes read back as plain English, ordinary values do not", () => {
  assert.match(explainError("#DIV/0!") ?? "", /zero/i);
  assert.match(explainError("#REF!") ?? "", /no longer exists/i);
  assert.match(explainError("#NAME?") ?? "", /unrecognised|spelling/i);
  assert.match(explainError("#N/A") ?? "", /no match/i);
  /* An unknown # code still explains, generically. */
  assert.equal(typeof explainError("#WHAT!"), "string");
  /* Not an error → null, so a normal cell gets no tooltip. */
  assert.equal(explainError("42"), null);
  assert.equal(explainError("hello"), null);
  assert.equal(explainError(""), null);
});
