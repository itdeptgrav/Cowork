/**
 * Reference adjustment — the arithmetic that rewrites a formula when it moves.
 *
 * Copying `=A1*2` from B1 to B2 must yield `=A2*2`, and dragging a fill down a
 * column must walk its relative references with it. Both are the same operation:
 * shift every RELATIVE reference in a formula by a (row, col) delta, while a `$`
 * anchor holds that component still. Requirement 8's four shapes fall straight
 * out of the two independent flags:
 *
 *   A1    → both shift          $A$1  → neither shifts
 *   A$1   → column shifts, row held    $A1   → row shifts, column held
 *
 * It works at the TOKEN level rather than parse → serialise, so everything that
 * is not a reference — operators, numbers, function names, strings — is emitted
 * back exactly as written and only the references change. That keeps the output
 * faithful (`=A2*2`, not a re-parenthesised equivalent) and sidesteps having to
 * reproduce precedence when printing an AST back out.
 */

import { columnIndex, columnLabel } from "../coordinates";
import { renderSheetPrefix } from "./sheets";
import { tokenize, type Token } from "./tokenizer";

/** The shape of a reference token: optional `$`, letters, optional `$`, digits. */
const REF_SHAPE = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/;

/**
 * Shift one reference's raw text by a delta, honouring its `$` anchors. A
 * relative component that would move before the sheet edge is clamped to the
 * first row/column rather than becoming an invalid negative reference.
 */
export function shiftReference(ref: string, dRow: number, dCol: number): string {
  const m = REF_SHAPE.exec(ref);
  if (!m) return ref;
  const absCol = m[1] === "$";
  const absRow = m[3] === "$";
  let col = columnIndex(m[2]);
  let row = Number.parseInt(m[4], 10) - 1;
  if (!absCol) col = Math.max(0, col + dCol);
  if (!absRow) row = Math.max(0, row + dRow);
  return `${absCol ? "$" : ""}${columnLabel(col)}${absRow ? "$" : ""}${row + 1}`;
}

/** Re-emit a single token as source text, shifting it if it is a reference.
    A cross-sheet reference's row/column shift like any other (a copied
    `=Sheet2!A1` becomes `=Sheet2!A2` a row down) — only its sheet stays. */
function renderToken(token: Token, dRow: number, dCol: number): string {
  switch (token.type) {
    case "ref":
      return shiftReference(token.value, dRow, dCol);
    case "sheet":
      return renderSheetPrefix(token.value);
    case "string":
      /* Re-quote, doubling any embedded quote — the inverse of the tokenizer. */
      return `"${token.value.replace(/"/g, '""')}"`;
    default:
      return token.value;
  }
}

/**
 * Adjust every relative reference in a raw formula by a (row, col) delta.
 *
 * A non-formula, a zero delta, or anything that will not tokenize is returned
 * untouched — a broken formula stays exactly as the person wrote it rather than
 * being silently rewritten.
 */
export function adjustFormula(raw: string, dRow: number, dCol: number): string {
  if (!raw.startsWith("=")) return raw;
  if (dRow === 0 && dCol === 0) return raw;
  let tokens: Token[];
  try {
    tokens = tokenize(raw.slice(1));
  } catch {
    return raw;
  }
  let out = "=";
  for (const token of tokens) out += renderToken(token, dRow, dCol);
  return out;
}
