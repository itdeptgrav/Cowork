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
  textContains,
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

/** A display accessor that echoes the raw value except for a couple of formula
    cells, so tests can tell "search formulas" from "search displayed values". */
function displayer(map: Record<string, string>): (row: number, col: number) => string {
  return (row, col) => {
    for (const [ref, shown] of Object.entries(map)) {
      const p = parseCellRef(ref)!;
      if (p.row === row && p.col === col) return shown;
    }
    return "";
  };
}

const opts = (o: Partial<SearchOptions> = {}): SearchOptions => ({
  matchCase: false,
  inFormulas: false,
  ...o,
});

test("textContains honours case sensitivity", () => {
  assert.equal(textContains("Hello", "hello", false), true);
  assert.equal(textContains("Hello", "hello", true), false);
  assert.equal(textContains("Hello", "", false), false);
});

test("findMatches returns matching cells in reading order", () => {
  const ws = build({ A1: "apple", C1: "grape", A2: "apricot", B3: "plum" });
  const display = displayer({ A1: "apple", C1: "grape", A2: "apricot", B3: "plum" });
  const matches = findMatches(ws, "ap", opts(), display);
  // "ap" is in apple, gr-AP-e and apricot — reading order is row-major.
  assert.deepEqual(matches, [
    { row: 0, col: 0 }, // A1 apple
    { row: 0, col: 2 }, // C1 grape
    { row: 1, col: 0 }, // A2 apricot
  ]);
});

test("search over displayed values matches a formula's result; over formulas matches its text", () => {
  const ws = build({ A1: "=1+1", A2: "text 2" });
  const display = displayer({ A1: "2", A2: "text 2" });
  // Displayed: "2" appears in A1's result and A2's text.
  assert.deepEqual(findMatches(ws, "2", opts({ inFormulas: false }), display), [
    { row: 0, col: 0 },
    { row: 1, col: 0 },
  ]);
  // Formulas: the text "1+1" appears in A1's raw formula, not in A2's literal.
  assert.deepEqual(findMatches(ws, "1+1", opts({ inFormulas: true }), display), [{ row: 0, col: 0 }]);
});

test("case-sensitive find distinguishes casing", () => {
  const ws = build({ A1: "Cat", A2: "cat" });
  const display = displayer({ A1: "Cat", A2: "cat" });
  assert.deepEqual(findMatches(ws, "cat", opts({ matchCase: true }), display), [{ row: 1, col: 0 }]);
});

test("stepMatch cycles forward and backward and wraps", () => {
  assert.equal(stepMatch(3, -1, true), 0);
  assert.equal(stepMatch(3, 2, true), 0); // wrap
  assert.equal(stepMatch(3, 0, false), 2); // wrap backward
  assert.equal(stepMatch(0, -1, true), -1); // nothing to step to
});

test("replaceInText swaps every occurrence, case-insensitively preserving surroundings", () => {
  assert.equal(replaceInText("a-a-a", "a", "b", true), "b-b-b");
  assert.equal(replaceInText("Cat cat CAT", "cat", "dog", false), "dog dog dog");
  assert.equal(replaceInText("Cat cat", "cat", "dog", true), "Cat dog");
});

test("replaceCellRaw rewrites literals, and refuses a formula when searching displayed values", () => {
  // Literal cell, displayed search: rewrite raw ("h" + "ipp" + "o").
  assert.equal(replaceCellRaw("hello", "hello", "ell", "ipp", opts()), "hippo");
  // Formula cell, displayed search: cannot rewrite a result.
  assert.equal(replaceCellRaw("=1+1", "2", "2", "3", opts({ inFormulas: false })), null);
  // Formula cell, formula search: rewrite the formula text (display is unused here).
  assert.equal(replaceCellRaw("=A1+1", "2", "A1", "B1", opts({ inFormulas: true })), "=B1+1");
});

test("replaceAllEdits produces one edit per changed cell and applies cleanly", () => {
  const ws = build({ A1: "red car", A2: "red bike", A3: "blue car", A4: "=RED" });
  const display = displayer({ A1: "red car", A2: "red bike", A3: "blue car", A4: "0" });
  const edits = replaceAllEdits(ws, "red", "green", opts({ inFormulas: false }), display);
  // A1, A2 change; A3 has no "red"; A4 is a formula (skipped for displayed search).
  assert.equal(edits.length, 2);
  const next = applyChanges(ws, buildCommand("Replace", ws, edits).changes);
  assert.equal(getCellValue(next, 0, 0), "green car");
  assert.equal(getCellValue(next, 1, 0), "green bike");
  assert.equal(getCellValue(next, 3, 0), "=RED"); // untouched
});
