/**
 * Search/replace audit — displayed vs raw matching, case handling, stepping
 * order and wrap-around, and replacement inside formulas vs literals.
 *
 * Assertions state CORRECT behaviour; failures are tagged `// BUG(...)`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCellRef } from "@/lib/spreadsheet/coordinates";
import { createWorksheet, getCellValue, setCellValue, type Worksheet } from "@/lib/spreadsheet/model";
import { applyChanges, buildCommand } from "@/lib/spreadsheet/history";
import {
  findMatches,
  replaceAllEdits,
  replaceCellRaw,
  replaceInText,
  stepMatch,
  type SearchOptions,
} from "@/lib/spreadsheet/search";

function build(cells: Record<string, string>): Worksheet {
  let ws = createWorksheet("s", "Sheet1");
  for (const [ref, value] of Object.entries(cells)) {
    const p = parseCellRef(ref)!;
    ws = setCellValue(ws, p.row, p.col, value);
  }
  return ws;
}

/** Display accessor: formulas display the given result, literals display raw. */
function displayFor(ws: Worksheet, results: Record<string, string>) {
  return (row: number, col: number): string => {
    for (const [ref, shown] of Object.entries(results)) {
      const p = parseCellRef(ref)!;
      if (p.row === row && p.col === col) return shown;
    }
    return getCellValue(ws, row, col);
  };
}

const opts = (o: Partial<SearchOptions> = {}): SearchOptions => ({
  matchCase: false,
  inFormulas: false,
  ...o,
});

test("AUDIT: matches come back in strict reading order regardless of insertion order", () => {
  const ws = build({ C3: "hit", A1: "hit", B2: "hit", A3: "hit", C1: "hit" });
  const matches = findMatches(ws, "hit", opts(), displayFor(ws, {}));
  assert.deepEqual(matches, [
    { row: 0, col: 0 }, // A1
    { row: 0, col: 2 }, // C1
    { row: 1, col: 1 }, // B2
    { row: 2, col: 0 }, // A3
    { row: 2, col: 2 }, // C3
  ]);
});

test("AUDIT: displayed search sees results; raw search sees formula text — never both", () => {
  const ws = build({ A1: "=SUM(B1:B9)", B1: "SUM total" });
  const display = displayFor(ws, { A1: "45" });
  // Displayed: "SUM" appears only in B1's literal text.
  assert.deepEqual(findMatches(ws, "SUM", opts(), display), [{ row: 0, col: 1 }]);
  // Raw: "SUM" appears in the formula and the literal.
  assert.deepEqual(findMatches(ws, "SUM", opts({ inFormulas: true }), display), [
    { row: 0, col: 0 },
    { row: 0, col: 1 },
  ]);
  // Displayed: the computed "45" is findable even though no cell contains it raw.
  assert.deepEqual(findMatches(ws, "45", opts(), display), [{ row: 0, col: 0 }]);
});

test("AUDIT: case-sensitive and insensitive find on unicode text", () => {
  const ws = build({ A1: "Café", A2: "café", A3: "CAFÉ" });
  const display = displayFor(ws, {});
  assert.equal(findMatches(ws, "café", opts(), display).length, 3, "insensitive matches all three");
  assert.deepEqual(findMatches(ws, "café", opts({ matchCase: true }), display), [{ row: 1, col: 0 }]);
});

test("AUDIT: stepMatch wraps both directions and survives a shrunken match list", () => {
  assert.equal(stepMatch(5, 4, true), 0, "forward off the end wraps to the first");
  assert.equal(stepMatch(5, 0, false), 4, "backward off the start wraps to the last");
  assert.equal(stepMatch(3, 7, true), 2, "a stale index past the end still lands in range");
  assert.equal(stepMatch(1, 0, true), 0, "a single match cycles onto itself");
  assert.equal(stepMatch(0, 0, true), -1, "no matches → no index");
});

test("AUDIT: replaceAll edits every occurrence in a cell, not just the first", () => {
  const ws = build({ A1: "red red red" });
  const edits = replaceAllEdits(ws, "red", "blue", opts(), displayFor(ws, {}));
  assert.equal(edits.length, 1);
  assert.equal(edits[0].raw, "blue blue blue");
});

test("AUDIT: case-insensitive replace preserves the UNMATCHED text's casing exactly", () => {
  assert.equal(replaceInText("Red RED red rEd", "red", "blue", false), "blue blue blue blue");
  assert.equal(replaceInText("KeepCase RED KeepCase", "red", "x", false), "KeepCase x KeepCase");
});

test("AUDIT: replacement that would no-op returns null so no command is recorded", () => {
  // The query matches the DISPLAY but not the RAW (thousands separator).
  assert.equal(replaceCellRaw("1000", "1,000", "1,0", "2,0", opts()), null);
  // Case-sensitive: raw contains only the other casing.
  assert.equal(replaceCellRaw("RED", "RED", "red", "blue", opts({ matchCase: true })), null);
});

test("AUDIT: replace-all in formula mode rewrites references inside formulas as one step", () => {
  const ws = build({ A1: "=B1+B2", A2: "=SUM(B1:B3)", A3: "B1 as text" });
  const display = displayFor(ws, { A1: "0", A2: "0" });
  const edits = replaceAllEdits(ws, "B1", "C1", opts({ inFormulas: true }), display);
  assert.equal(edits.length, 3, "formulas AND the literal that contains the text");
  const next = applyChanges(ws, buildCommand("Replace", ws, edits).changes);
  assert.equal(getCellValue(next, 0, 0), "=C1+B2", "only the B1 references changed");
  assert.equal(getCellValue(next, 1, 0), "=SUM(C1:B3)");
  assert.equal(getCellValue(next, 2, 0), "C1 as text");
});

test("AUDIT: replace-all in displayed mode skips formulas even when their RESULT matches", () => {
  const ws = build({ A1: "=1+1", A2: "2 apples" });
  const display = displayFor(ws, { A1: "2" });
  const edits = replaceAllEdits(ws, "2", "3", opts(), display);
  assert.equal(edits.length, 1, "the formula whose result shows '2' is found but not rewritten");
  assert.deepEqual(edits[0], { row: 1, col: 0, raw: "3 apples" });
});

test("AUDIT: replacing a cell's entire content with the empty string clears the cell", () => {
  const ws = build({ A1: "gone" });
  const edits = replaceAllEdits(ws, "gone", "", opts(), displayFor(ws, {}));
  const next = applyChanges(ws, buildCommand("Replace", ws, edits).changes);
  assert.equal(getCellValue(next, 0, 0), "");
  assert.equal(next.cells["A1"], undefined, "an emptied cell leaves the sparse store");
});

test("AUDIT: the empty query matches nothing and edits nothing", () => {
  const ws = build({ A1: "anything" });
  assert.deepEqual(findMatches(ws, "", opts(), displayFor(ws, {})), []);
  assert.deepEqual(replaceAllEdits(ws, "", "x", opts(), displayFor(ws, {})), []);
});

test("AUDIT: overlapping matches replace left-to-right without re-scanning the output", () => {
  assert.equal(replaceInText("aaa", "aa", "b", true), "ba");
  assert.equal(replaceInText("aaa", "aa", "b", false), "ba", "both code paths agree");
  // The replacement containing the query must not loop or double-replace.
  assert.equal(replaceInText("ab", "ab", "abab", true), "abab");
  assert.equal(replaceInText("ab", "ab", "abab", false), "abab");
});
