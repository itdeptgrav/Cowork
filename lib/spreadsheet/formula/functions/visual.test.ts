import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCellRef } from "@/lib/spreadsheet/coordinates";
import { isRich } from "@/lib/spreadsheet/formula/value";
import { evalFormula, evalWith, sheetOf } from "./_harness";

function richOf(formula: string, cells: Record<string, string> = {}) {
  const engine = sheetOf(cells);
  const p = parseCellRef("ZZ900")!;
  engine.setCell("s", p.row, p.col, formula);
  const v = engine.getValue("s", p.row, p.col);
  return isRich(v) ? v.rich : v;
}

test("SPARKLINE returns a picture the grid draws and other readers see as empty", () => {
  const cells = { A1: "3", A2: "x", A3: "-1", A4: "TRUE" };
  const rich = richOf("=SPARKLINE(A1:A4)", cells);
  assert.deepEqual(rich, { type: "sparkline", chart: "line", values: [3, -1, 1] });
  assert.equal(evalWith("=SPARKLINE(A1:A4)", cells), "", "its text is empty");
  assert.equal(evalWith("=SPARKLINE(A1:A4) + 1", cells), "#VALUE!", "it is not a number");
  assert.deepEqual(richOf('=SPARKLINE(A1:A3, "column", "#c0392b", 0, 10)', cells), {
    type: "sparkline",
    chart: "column",
    values: [3, -1],
    color: "#c0392b",
    min: 0,
    max: 10,
  });
  assert.equal(evalFormula('=SPARKLINE(1, "pie")'), "#VALUE!");
  assert.equal(evalFormula('=SPARKLINE(1, "line", "url(x)")'), "#VALUE!");
  assert.equal(evalFormula('=SPARKLINE(1, "line", , 5, 2)'), "#VALUE!", "max must exceed min");
});

test("IMAGE takes an https address and a fit mode", () => {
  assert.deepEqual(richOf('=IMAGE("https://example.com/a.png")'), { type: "image", url: "https://example.com/a.png", mode: 1 });
  assert.deepEqual(richOf('=IMAGE("https://example.com/a.png", 3)'), { type: "image", url: "https://example.com/a.png", mode: 3 });
  assert.equal(evalFormula('=IMAGE("http://example.com/a.png")'), "#VALUE!", "only https");
  assert.equal(evalFormula('=IMAGE("javascript:alert(1)")'), "#VALUE!");
  assert.equal(evalFormula('=IMAGE("https://example.com/a.png", 4)'), "#VALUE!");
});
