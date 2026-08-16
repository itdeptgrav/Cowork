/**
 * A tiny evaluation harness shared by the function test files (not a test file
 * itself). It sets input cells, evaluates a formula in an out-of-the-way cell,
 * and returns the displayed text.
 */

import { parseCellRef } from "@/lib/spreadsheet/coordinates";
import { FormulaEngine } from "@/lib/spreadsheet/formula/engine";

const SHEET = "s";
/** Where the formula under test lives — far from any input cell a test sets. */
const RESULT = "ZZ900";

export function sheetOf(cells: Record<string, string>): FormulaEngine {
  const engine = new FormulaEngine();
  for (const [ref, raw] of Object.entries(cells)) {
    const p = parseCellRef(ref)!;
    engine.setCell(SHEET, p.row, p.col, raw);
  }
  return engine;
}

/** Evaluate a formula (with a leading `=`) over some input cells; return the
    displayed result text. */
export function evalWith(formula: string, cells: Record<string, string> = {}): string {
  const engine = sheetOf(cells);
  const p = parseCellRef(RESULT)!;
  engine.setCell(SHEET, p.row, p.col, formula);
  return engine.display(SHEET, p.row, p.col).text;
}

/** Evaluate a bare formula with no input cells. */
export function evalFormula(formula: string): string {
  return evalWith(formula);
}
