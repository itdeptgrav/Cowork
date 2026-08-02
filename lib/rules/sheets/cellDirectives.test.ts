import assert from "node:assert/strict";
import { test } from "node:test";
import { autosumRange, parseCellDirective, resolveAutosum } from "./cellDirectives.ts";
import type { SheetData } from "./grid.ts";

function sheet(cells: Record<string, string>): SheetData {
  return { cells, styles: {}, rows: 100, cols: 26 };
}

test("=autosum is recognised, with or without parens, in any case", () => {
  for (const input of ["=autosum", "=AUTOSUM", "=AutoSum()", "=autosum ( )"]) {
    assert.deepEqual(parseCellDirective(input), { kind: "autosum" }, input);
  }
});

test("=ai and =ask carry their text through", () => {
  assert.deepEqual(parseCellDirective("=ai sum the revenue column"), {
    kind: "ask",
    text: "sum the revenue column",
  });
  assert.deepEqual(parseCellDirective("=ask what is the average here"), {
    kind: "ask",
    text: "what is the average here",
  });
});

test("an ordinary formula is NOT a directive — including an unknown function", () => {
  /* The load-bearing case: guessing that this is natural language would
     replace a real `#NAME?` error with an AI panel nobody asked for. */
  assert.equal(parseCellDirective("=SUM(A1:A9)"), null);
  assert.equal(parseCellDirective("=MYCUSTOMFUNC(1)"), null);
  assert.equal(parseCellDirective("=A1*2"), null);
});

test("plain values are never directives", () => {
  assert.equal(parseCellDirective("autosum"), null);
  assert.equal(parseCellDirective("42"), null);
  assert.equal(parseCellDirective(""), null);
});

test("=ai with no text after it is not a directive", () => {
  assert.equal(parseCellDirective("=ai"), null);
  assert.equal(parseCellDirective("=ai   "), null);
});

test("autosum totals the contiguous numbers directly above", () => {
  const s = sheet({ B2: "10", B3: "20", B4: "30" });
  assert.equal(autosumRange(s, "B5"), "B2:B4");
  assert.equal(resolveAutosum(s, "B5"), "=SUM(B2:B4)");
});

test("autosum stops at a gap rather than reaching past it", () => {
  const s = sheet({ B1: "99", B3: "20", B4: "30" });
  assert.equal(autosumRange(s, "B5"), "B3:B4", "B2 is empty, so B1 is not part of this block");
});

test("autosum reaches across a formula, not just literals", () => {
  /* A subtotal above the grand total is part of the column being totalled;
     stopping at it would sum only the literals below it. */
  const s = sheet({ B2: "10", B3: "=B2*2", B4: "30" });
  assert.equal(autosumRange(s, "B5"), "B2:B4");
});

test("with nothing above, autosum totals leftwards instead", () => {
  const s = sheet({ B3: "10", C3: "20", D3: "30" });
  assert.equal(autosumRange(s, "E3"), "B3:D3");
});

test("upwards wins when both directions have numbers", () => {
  const s = sheet({ C1: "1", C2: "2", A3: "9", B3: "9" });
  assert.equal(autosumRange(s, "C3"), "C1:C2");
});

test("nothing adjacent means no range, and no `=SUM()` is written", () => {
  const s = sheet({ Z9: "1" });
  assert.equal(autosumRange(s, "B5"), null);
  assert.equal(resolveAutosum(s, "B5"), null);
});

test("text directly above is not summable and stops the run", () => {
  const s = sheet({ B2: "Revenue", B3: "10", B4: "20" });
  assert.equal(autosumRange(s, "B5"), "B3:B4", "the header is excluded");
});

test("autosum at the top-left corner has nowhere to reach", () => {
  assert.equal(autosumRange(sheet({}), "A1"), null);
});
