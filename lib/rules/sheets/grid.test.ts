import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cellRef,
  columnIndex,
  columnLabel,
  COMMON_FUNCTIONS,
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
