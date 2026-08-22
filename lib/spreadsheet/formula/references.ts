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
 * is not a reference — operators, numbers, function names, strings, and the
 * spacing between them — is emitted back exactly as written (from each token's
 * source slice) and only the references change. That keeps the output faithful
 * (`=A2*2`, not a re-parenthesised equivalent) and sidesteps having to
 * reproduce precedence when printing an AST back out.
 */

import { columnIndex, columnLabel } from "../coordinates";
import { tokenizeSpanned, type SpannedToken } from "./tokenizer";

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

/**
 * Adjust every relative reference in a raw formula by a (row, col) delta. A
 * cross-sheet reference's row/column shift like any other (a copied
 * `=Sheet2!A1` becomes `=Sheet2!A2` a row down) — only its sheet stays.
 *
 * A non-formula, a zero delta, or anything that will not tokenize is returned
 * untouched — a broken formula stays exactly as the person wrote it rather than
 * being silently rewritten. Everything that is not a shifted reference is
 * re-emitted from its source slice, so spacing and spellings survive.
 */
export function adjustFormula(raw: string, dRow: number, dCol: number): string {
  if (!raw.startsWith("=")) return raw;
  if (dRow === 0 && dCol === 0) return raw;
  const body = raw.slice(1);
  let tokens: SpannedToken[];
  try {
    tokens = tokenizeSpanned(body);
  } catch {
    return raw;
  }
  let out = "=";
  let pos = 0;
  for (const token of tokens) {
    if (token.type !== "ref") continue;
    const shifted = shiftReference(token.value, dRow, dCol);
    if (shifted === token.value) continue; // clamped or anchored — verbatim
    out += body.slice(pos, token.start) + shifted;
    pos = token.end;
  }
  out += body.slice(pos);
  return out;
}
