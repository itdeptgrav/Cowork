/**
 * Data-tools audit — text to columns and subtotals, against Excel semantics.
 *
 * Text to Columns splits the selection's first column rightwards, overwriting
 * what is beside it (the UI says so) but leaving cells beyond a row's own parts
 * alone. Subtotal groups are RUNS of equal values — the plan must name every
 * run, including the last one, whatever its value happens to be.
 *
 * Failing assertions are kept deliberately, tagged BUG(<id>).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCellRef, type Rect } from "@/lib/spreadsheet/coordinates";
import { applyCellWrites, createWorksheet, getCellValue, type Worksheet } from "@/lib/spreadsheet/model";
import { applyChanges, buildCommand } from "@/lib/spreadsheet/history";
import { splitField, subtotalPlan, textToColumnsEdits } from "@/lib/spreadsheet/datatools";

const rect = (t: number, l: number, b: number, r: number): Rect => ({ top: t, left: l, bottom: b, right: r });

function build(cells: Record<string, string>): Worksheet {
  const ws = createWorksheet("s", "Sheet1");
  return applyCellWrites(
    ws,
    Object.entries(cells).map(([ref, value]) => {
      const p = parseCellRef(ref)!;
      return { row: p.row, col: p.col, value };
    }),
  );
}

/* ── splitField ───────────────────────────────────────────────────────────── */

test("AUDIT: consecutive semicolons and tabs keep their empty fields; spaces collapse", () => {
  assert.deepEqual(splitField("x;;y", "semicolon"), ["x", "", "y"]);
  assert.deepEqual(splitField("x\t\ty", "tab"), ["x", "", "y"]);
  assert.deepEqual(splitField("x \t y", "space"), ["x", "y"], "a mixed whitespace run is one separator");
});

test("AUDIT: leading and trailing delimiters produce empty edge fields", () => {
  assert.deepEqual(splitField(",x,", "comma"), ["", "x", ""]);
  assert.deepEqual(splitField(";", "semicolon"), ["", ""]);
});

test("AUDIT: quoting protects any delimiter kind, not just commas", () => {
  assert.deepEqual(splitField('"a;b";c', "semicolon"), ["a;b", "c"]);
  assert.deepEqual(splitField('a "b c" d', "space"), ["a", "b c", "d"]);
  assert.deepEqual(splitField('"x\ty"\tz', "tab"), ["x\ty", "z"]);
});

/* ── textToColumnsEdits ───────────────────────────────────────────────────── */

test("AUDIT: the split overwrites occupied cells to the right (as the UI warns)", () => {
  const ws = build({ A1: "a,b", B1: "OLD" });
  const edits = textToColumnsEdits(ws, rect(0, 0, 0, 0), "comma", 100);
  const next = applyChanges(ws, buildCommand("Split", ws, edits).changes);
  assert.equal(getCellValue(next, 0, 1), "b", "B1's previous content is replaced by the part");
});

test("AUDIT: a row with fewer parts leaves cells beyond its own parts alone", () => {
  const ws = build({ A1: "a,b,c", A2: "x", B2: "keep" });
  const edits = textToColumnsEdits(ws, rect(0, 0, 1, 0), "comma", 100);
  const next = applyChanges(ws, buildCommand("Split", ws, edits).changes);
  assert.deepEqual(
    [getCellValue(next, 0, 0), getCellValue(next, 0, 1), getCellValue(next, 0, 2)],
    ["a", "b", "c"],
  );
  assert.equal(getCellValue(next, 1, 0), "x");
  assert.equal(getCellValue(next, 1, 1), "keep", "no part reached B2, so it survives");
});

test("AUDIT: an empty middle part clears the cell it lands on", () => {
  const ws = build({ A1: "p,,q", B1: "OLD" });
  const edits = textToColumnsEdits(ws, rect(0, 0, 0, 0), "comma", 100);
  const next = applyChanges(ws, buildCommand("Split", ws, edits).changes);
  assert.equal(getCellValue(next, 0, 1), "", "the empty field between the commas wins over OLD");
  assert.equal(getCellValue(next, 0, 2), "q");
});

/* ── subtotalPlan ─────────────────────────────────────────────────────────── */

test("AUDIT: each subtotal's row is the first row AFTER its run (the module's contract)", () => {
  const values = ["North", "North", "South"];
  const at = (r: number) => values[r] ?? "";
  const plan = subtotalPlan(rect(0, 0, 2, 0), 0, at);
  assert.deepEqual(
    plan.map((p) => [p.label, p.from, p.to, p.row]),
    [
      ["North", 0, 1, 2],
      ["South", 2, 2, 3],
    ],
    "SubtotalRow.row documents 'the first free row after the group'",
  );
});

test("AUDIT: a single-row run gets its own subtotal", () => {
  const values = ["A", "B", "B"];
  const at = (r: number) => values[r] ?? "";
  const plan = subtotalPlan(rect(0, 0, 2, 0), 0, at);
  assert.deepEqual(
    plan.map((p) => [p.label, p.from, p.to]),
    [["A", 0, 0], ["B", 1, 2]],
  );
});

test("AUDIT: a run of blank group values is still a run", () => {
  const values = ["A", "", ""];
  const at = (r: number) => values[r] ?? "";
  const plan = subtotalPlan(rect(0, 0, 2, 0), 0, at);
  assert.deepEqual(plan.map((p) => [p.label, p.from, p.to]), [["A", 0, 0], ["", 1, 2]]);
});

test("AUDIT: the last group is planned whatever its value is — even 'end' or ' end'", () => {
  // subtotalPlan's end-of-range sentinel is "\0end" (a raw NUL prefix), which
  // no typed cell value can equal — so ordinary values that LOOK like the
  // sentinel must still close their run. (A display string containing a real
  // NUL would collide, but no input path produces one.)
  for (const last of ["end", " end"]) {
    const values = ["x", last, last];
    const at = (r: number) => values[r] ?? "";
    const plan = subtotalPlan(rect(0, 0, 2, 0), 0, at);
    assert.deepEqual(
      plan.map((p) => [p.label, p.from, p.to]),
      [
        ["x", 0, 0],
        [last, 1, 2],
      ],
      `trailing run of '${last}' must be planned`,
    );
  }
});
