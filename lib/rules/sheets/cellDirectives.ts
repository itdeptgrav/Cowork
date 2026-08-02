/**
 * Things you can type INTO a cell that aren't ordinary formulas.
 *
 * ## Why `=autosum` is not an AI feature
 *
 * `=autosum` resolves to a real `=SUM(range)` here, deterministically, with
 * no model call and no network — the same answer every time, instantly,
 * offline. It is Excel's AutoSum button expressed as something you can type,
 * and it writes straight into the cell because it is not a proposal about
 * what you might have meant: it is arithmetic over the cells directly above
 * (or beside) the one you are in. Routing it through the assistant would
 * make a deterministic operation slow, billable, and occasionally wrong.
 *
 * ## Why natural language needs an explicit prefix
 *
 * `=ai sum the revenue column` goes to the assistant as a *proposal*, never a
 * direct write — same rule as everywhere else in this feature. It requires
 * the literal `ai ` (or `ask `) prefix rather than being inferred from
 * "this doesn't look like a formula", and that restraint is the point:
 * guessing would mean somebody typing `=MYFUNC(1)` — a function this build
 * doesn't know but a future one might — gets an AI panel instead of the
 * `#NAME?` error that would actually tell them what is wrong. A wrong guess
 * here breaks real formulas; an explicit prefix never does.
 */

import { cellRef, isFormula, parseRef, type SheetData } from "./grid.ts";

export type CellDirective =
  | { kind: "autosum" }
  /** Natural language for the assistant. Never applied directly. */
  | { kind: "ask"; text: string };

/**
 * What was typed, if it is a directive rather than a formula or a value.
 * `null` means "ordinary content" — let the formula engine have it.
 */
export function parseCellDirective(raw: string): CellDirective | null {
  const text = raw.trim();
  if (!text.startsWith("=")) return null;
  const body = text.slice(1).trim();

  /* `=autosum`, `=AUTOSUM`, `=autosum()` — the trailing parens are accepted
     because people type them out of habit from every other function. */
  if (/^autosum\s*(\(\s*\))?$/i.test(body)) return { kind: "autosum" };

  const ask = /^(?:ai|ask)\s+(.*\S)$/i.exec(body);
  if (ask) return { kind: "ask", text: ask[1]! };

  return null;
}

/** Is this cell's raw content something AutoSum should reach across? */
function isSummable(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return false;
  /* A formula counts: `=B1*2` above the total is part of the column being
     totalled, and stopping at it would sum only the literals below it. */
  if (isFormula(raw)) return true;
  return Number.isFinite(Number(raw.trim()));
}

/**
 * The range `=autosum` in `ref` should total.
 *
 * Upwards first, then leftwards — the order every spreadsheet uses, because
 * a total most often sits at the foot of a column and only sometimes at the
 * end of a row. Returns `null` when there is nothing adjacent to total, and
 * the caller leaves what was typed alone rather than writing `=SUM()`.
 */
export function autosumRange(sheet: SheetData, ref: string): string | null {
  const pos = parseRef(ref);
  if (!pos) return null;

  /* Upwards. */
  let top = pos.row;
  while (top - 1 >= 0 && isSummable(sheet.cells[cellRef(top - 1, pos.col)])) top--;
  if (top < pos.row) {
    return `${cellRef(top, pos.col)}:${cellRef(pos.row - 1, pos.col)}`;
  }

  /* Leftwards. */
  let left = pos.col;
  while (left - 1 >= 0 && isSummable(sheet.cells[cellRef(pos.row, left - 1)])) left--;
  if (left < pos.col) {
    return `${cellRef(pos.row, left)}:${cellRef(pos.row, pos.col - 1)}`;
  }

  return null;
}

/**
 * `=autosum` resolved against a sheet — the formula to actually store, or
 * `null` when there is nothing adjacent to total.
 */
export function resolveAutosum(sheet: SheetData, ref: string): string | null {
  const range = autosumRange(sheet, ref);
  return range ? `=SUM(${range})` : null;
}
