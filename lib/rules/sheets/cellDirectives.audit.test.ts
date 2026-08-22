/**
 * Adversarial audit of `cellDirectives.ts` — the parsing boundary between
 * directives, formulas and values, and autosum's reach rules on hostile grids.
 * (No confirmed bugs here at the time of writing; these pin the boundary so a
 * regression cannot slip in as "just a parsing tweak".)
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { autosumRange, parseCellDirective, resolveAutosum } from "./cellDirectives.ts";
import type { SheetData } from "./grid.ts";

function sheet(cells: Record<string, string>): SheetData {
  return { cells, styles: {}, rows: 100, cols: 26 };
}

/* ── Directive parsing boundaries ─────────────────────────────────────────── */

test("prefix lookalikes are NOT directives — the =NAME? path must survive", () => {
  /* "askance" starts with "ask" but has no separating whitespace; "aids" starts
     with "ai". Treating either as natural language would hijack a real formula. */
  assert.equal(parseCellDirective("=askance(1)"), null);
  assert.equal(parseCellDirective("=aids"), null);
  assert.equal(parseCellDirective("=ai(A1)"), null, "no whitespace after ai — a function call shape");
  assert.equal(parseCellDirective("=autosummary"), null);
});

test("whitespace variants of the directives still parse", () => {
  assert.deepEqual(parseCellDirective("  =  autosum  "), { kind: "autosum" });
  assert.deepEqual(parseCellDirective("=AUTOSUM (  )"), { kind: "autosum" });
  assert.deepEqual(parseCellDirective("=ai\ttotal the column"), {
    kind: "ask",
    text: "total the column",
  });
  assert.deepEqual(parseCellDirective("=ASK   what now   "), {
    kind: "ask",
    text: "what now",
  });
});

test("autosum with arguments is not the directive — it may be a real function one day", () => {
  assert.equal(parseCellDirective("=autosum(A1:A9)"), null);
  assert.equal(parseCellDirective("=autosum x"), null);
});

test("the ask text keeps its interior punctuation and casing", () => {
  assert.deepEqual(parseCellDirective("=ai Sum B2:B9, then × 2!"), {
    kind: "ask",
    text: "Sum B2:B9, then × 2!",
  });
});

/* ── Autosum reach ────────────────────────────────────────────────────────── */

test("negative numbers, decimals and scientific notation are all summable", () => {
  const s = sheet({ B2: "-10", B3: "2.5", B4: "1e3" });
  assert.equal(autosumRange(s, "B5"), "B2:B4");
});

test("padded numbers count; padded blanks and non-numeric text stop the run", () => {
  assert.equal(autosumRange(sheet({ B3: " 5 ", B4: "7" }), "B5"), "B3:B4");
  assert.equal(autosumRange(sheet({ B2: "9", B3: "   ", B4: "7" }), "B5"), "B4:B4", "whitespace is a gap");
  assert.equal(autosumRange(sheet({ B2: "9", B3: "n/a", B4: "7" }), "B5"), "B4:B4", "text is a wall");
});

test("a directly-adjacent single number is a one-cell range, not null", () => {
  const s = sheet({ A3: "5" });
  assert.equal(autosumRange(s, "A4"), "A3:A3");
  assert.equal(resolveAutosum(s, "A4"), "=SUM(A3:A3)");
});

test("row 1 never looks upward out of the grid; column A never looks left out of it", () => {
  /* Regression guard for an off-by-one at the edges — reaching to row 0 or
     column -1 would produce refs like A0 that parseRef refuses. */
  assert.equal(autosumRange(sheet({ Z9: "1" }), "A1"), null);
  const leftEdge = sheet({ A3: "1", B3: "2" });
  assert.equal(autosumRange(leftEdge, "C3"), "A3:B3");
});

test("an invalid target ref yields null rather than a throw", () => {
  assert.equal(autosumRange(sheet({ A1: "1" }), "not-a-ref"), null);
  assert.equal(resolveAutosum(sheet({ A1: "1" }), ""), null);
});

test("formulas above are reached across even when they would evaluate to text", () => {
  /* The reach rule is raw-text based by design: any formula is summable. A
     column ending =CONCATENATE(...) still extends the run — pinned as the
     documented trade-off (the range is decided without an evaluator). */
  const s = sheet({ B2: "10", B3: '=CONCATENATE("a","b")', B4: "30" });
  assert.equal(autosumRange(s, "B5"), "B2:B4");
});
