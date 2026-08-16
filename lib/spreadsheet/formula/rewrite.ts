/**
 * Structural reference rewriting — what a formula's references become when rows
 * or columns are inserted or deleted around them.
 *
 * This is a DIFFERENT transform from copy/fill adjustment (`references.ts`):
 *
 *  · Copy shifts only RELATIVE references; a `$`-anchor holds still, because the
 *    formula moved but the sheet did not.
 *  · A structural edit moves the SHEET, so every reference to the moved data
 *    follows it — absolute or relative alike. Inserting a row above row 1 turns
 *    `A1` into `A2` AND `$A$1` into `$A$2`, so both keep pointing at the same
 *    value (the spec's worked example).
 *
 * Deleting is where `#REF!` appears: a reference to a deleted cell has nothing
 * left to point at, and a range that loses cells contracts — unless it loses all
 * of them, when it too becomes `#REF!`. That error is now a first-class literal
 * the engine parses and evaluates, so the broken formula survives as a formula
 * that reports the error rather than silently mis-evaluating.
 *
 * Like `references.ts` this works at the token level, so only references change
 * and everything else is re-emitted verbatim.
 */

import { columnIndex, columnLabel } from "../coordinates";
import { renderSheetPrefix } from "./sheets";
import { tokenize, type Token } from "./tokenizer";

export type StructuralAxis = "row" | "col";
export type StructuralMode = "insert" | "delete";

export interface StructuralOp {
  axis: StructuralAxis;
  /** The 0-based index the insertion/deletion begins at. */
  at: number;
  count: number;
  mode: StructuralMode;
}

const REF_SHAPE = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/;

interface ParsedRef {
  absCol: boolean;
  col: number;
  absRow: boolean;
  row: number;
}

function parseRef(text: string): ParsedRef | null {
  const m = REF_SHAPE.exec(text);
  if (!m) return null;
  return {
    absCol: m[1] === "$",
    col: columnIndex(m[2]),
    absRow: m[3] === "$",
    row: Number.parseInt(m[4], 10) - 1,
  };
}

function refText(r: ParsedRef): string {
  return `${r.absCol ? "$" : ""}${columnLabel(r.col)}${r.absRow ? "$" : ""}${r.row + 1}`;
}

/** The index a single line maps to, or "deleted" when it is removed. */
function mapIndex(index: number, op: StructuralOp): number | "deleted" {
  if (op.mode === "insert") return index >= op.at ? index + op.count : index;
  if (index < op.at) return index;
  if (index < op.at + op.count) return "deleted";
  return index - op.count;
}

function lineOf(r: ParsedRef, axis: StructuralAxis): number {
  return axis === "row" ? r.row : r.col;
}

function withLine(r: ParsedRef, axis: StructuralAxis, line: number): ParsedRef {
  return axis === "row" ? { ...r, row: line } : { ...r, col: line };
}

/** Map a single reference; null means it fell inside a deletion (`#REF!`). */
function mapSingle(r: ParsedRef, op: StructuralOp): ParsedRef | null {
  const mapped = mapIndex(lineOf(r, op.axis), op);
  if (mapped === "deleted") return null;
  return withLine(r, op.axis, mapped);
}

/**
 * Map a range's endpoints. A deletion contracts the range: a deleted lower edge
 * clamps to the first surviving line, a deleted upper edge to the last, and if
 * nothing survives the range is gone (`null` → `#REF!`). Endpoint orientation
 * and each endpoint's `$` flags are preserved.
 */
function mapRange(a: ParsedRef, b: ParsedRef, op: StructuralOp): [ParsedRef, ParsedRef] | null {
  if (op.mode === "insert") {
    return [mapSingle(a, op)!, mapSingle(b, op)!];
  }
  const la = lineOf(a, op.axis);
  const lb = lineOf(b, op.axis);
  const lo = Math.min(la, lb);
  const hi = Math.max(la, lb);
  const { at, count } = op;
  const end = at + count;
  const newLo = lo < at ? lo : lo >= end ? lo - count : at;
  const newHi = hi < at ? hi : hi >= end ? hi - count : at - 1;
  if (newLo > newHi) return null;
  const aIsLo = la <= lb;
  return [
    withLine(a, op.axis, aIsLo ? newLo : newHi),
    withLine(b, op.axis, aIsLo ? newHi : newLo),
  ];
}

/** Re-emit a non-reference token exactly (re-quoting strings). */
function renderToken(token: Token): string {
  if (token.type === "string") return `"${token.value.replace(/"/g, '""')}"`;
  return token.value;
}

/**
 * Rewrite a raw formula's references for a row/column insertion or deletion.
 * A non-formula or an untokenizable string is returned untouched.
 */
export function transformStructural(raw: string, op: StructuralOp): string {
  if (!raw.startsWith("=")) return raw;
  let tokens: Token[];
  try {
    tokens = tokenize(raw.slice(1));
  } catch {
    return raw;
  }
  let out = "=";
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === "sheet") {
      /* A cross-sheet reference belongs to another sheet — a structural edit on
         THIS sheet leaves it untouched. Emit the qualifier and the ref (or
         range) that follows it verbatim. */
      out += renderSheetPrefix(t.value);
      i += 1;
      if (tokens[i]?.type === "ref") {
        out += tokens[i].value;
        i += 1;
        if (tokens[i]?.type === "colon" && tokens[i + 1]?.type === "ref") {
          out += `:${tokens[i + 1].value}`;
          i += 2;
        }
      }
      continue;
    }
    if (t.type === "ref") {
      const isRange = tokens[i + 1]?.type === "colon" && tokens[i + 2]?.type === "ref";
      const a = parseRef(t.value);
      if (isRange) {
        const b = parseRef(tokens[i + 2].value);
        if (a && b) {
          const mapped = mapRange(a, b, op);
          out += mapped ? `${refText(mapped[0])}:${refText(mapped[1])}` : "#REF!";
        } else {
          out += `${t.value}:${tokens[i + 2].value}`;
        }
        i += 3;
        continue;
      }
      if (a) {
        const mapped = mapSingle(a, op);
        out += mapped ? refText(mapped) : "#REF!";
      } else {
        out += t.value;
      }
      i += 1;
      continue;
    }
    out += renderToken(t);
    i += 1;
  }
  return out;
}
