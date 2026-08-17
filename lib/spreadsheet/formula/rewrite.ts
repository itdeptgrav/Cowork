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

/* ── Region shifts (Insert ▸ Cells) ───────────────────────────────────────── */

/**
 * A block of cells inserted or removed, with only the cells in its own band
 * moving — Excel's "shift cells right / down / left / up".
 *
 * The difference from `StructuralOp` is the BAND. A row insertion moves every
 * column; a cell insertion moves only the columns the block spans, so a
 * reference is rewritten only when it lies inside that band. `axis` names the
 * direction of travel: `row` shifts vertically (down on insert, up on delete),
 * `col` shifts horizontally (right, left).
 */
export interface RegionShiftOp {
  rect: { top: number; left: number; bottom: number; right: number };
  axis: StructuralAxis;
  mode: StructuralMode;
}

/** The equivalent whole-axis op, once a reference is known to be in the band. */
function lineOp(op: RegionShiftOp): StructuralOp {
  const vertical = op.axis === "row";
  return {
    axis: op.axis,
    at: vertical ? op.rect.top : op.rect.left,
    count: vertical
      ? op.rect.bottom - op.rect.top + 1
      : op.rect.right - op.rect.left + 1,
    mode: op.mode,
  };
}

/** Is a single reference inside the shifted band, across the other axis? */
function inBand(r: ParsedRef, op: RegionShiftOp): boolean {
  return op.axis === "row"
    ? r.col >= op.rect.left && r.col <= op.rect.right
    : r.row >= op.rect.top && r.row <= op.rect.bottom;
}

/**
 * Both endpoints in the band, AND the range's whole cross-axis extent inside it.
 *
 * A range straddling the band's edge covers cells that move and cells that do
 * not, so no rectangle describes where it ends up. Excel leaves such a range
 * alone rather than guessing, and so does this: a wrong reference that looks
 * right is worse than one the reader can see did not move.
 */
function rangeInBand(a: ParsedRef, b: ParsedRef, op: RegionShiftOp): boolean {
  if (op.axis === "row") {
    const lo = Math.min(a.col, b.col);
    const hi = Math.max(a.col, b.col);
    return lo >= op.rect.left && hi <= op.rect.right;
  }
  const lo = Math.min(a.row, b.row);
  const hi = Math.max(a.row, b.row);
  return lo >= op.rect.top && hi <= op.rect.bottom;
}

/** Re-emit a non-reference token exactly (re-quoting strings). */
function renderToken(token: Token): string {
  if (token.type === "string") return `"${token.value.replace(/"/g, '""')}"`;
  return token.value;
}

/**
 * How one transform answers for a reference. `null` means the target is gone
 * (`#REF!`); `undefined` means "leave this reference exactly as written".
 */
interface RefHandlers {
  single: (r: ParsedRef) => ParsedRef | null | undefined;
  range: (a: ParsedRef, b: ParsedRef) => [ParsedRef, ParsedRef] | null | undefined;
}

/**
 * Walk a formula's tokens and rewrite only its references.
 *
 * Shared by both transforms below so they cannot drift on the things that are
 * easy to get subtly different: cross-sheet qualifiers pass through untouched,
 * a range is consumed as one unit rather than two endpoints, an unparseable
 * reference is emitted verbatim, and every other token is re-emitted exactly.
 */
function transformRefs(raw: string, h: RefHandlers): string {
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
      /* A cross-sheet reference belongs to another sheet — an edit on THIS sheet
         leaves it untouched. Emit the qualifier and the ref (or range) that
         follows it verbatim. */
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
        const mapped = a && b ? h.range(a, b) : undefined;
        if (mapped === undefined) out += `${t.value}:${tokens[i + 2].value}`;
        else if (mapped === null) out += "#REF!";
        else out += `${refText(mapped[0])}:${refText(mapped[1])}`;
        i += 3;
        continue;
      }
      const mapped = a ? h.single(a) : undefined;
      if (mapped === undefined) out += t.value;
      else if (mapped === null) out += "#REF!";
      else out += refText(mapped);
      i += 1;
      continue;
    }
    out += renderToken(t);
    i += 1;
  }
  return out;
}

/**
 * Rewrite a raw formula's references for a row/column insertion or deletion.
 * A non-formula or an untokenizable string is returned untouched.
 */
export function transformStructural(raw: string, op: StructuralOp): string {
  return transformRefs(raw, {
    single: (r) => mapSingle(r, op),
    range: (a, b) => mapRange(a, b, op),
  });
}

/**
 * Rewrite a raw formula's references for a cell-block shift.
 *
 * Only references inside the shifted band move; everything else — including a
 * range that straddles the band's edge — is left exactly as written.
 */
export function transformRegionShift(raw: string, op: RegionShiftOp): string {
  const line = lineOp(op);
  return transformRefs(raw, {
    single: (r) => (inBand(r, op) ? mapSingle(r, line) : undefined),
    range: (a, b) => (rangeInBand(a, b, op) ? mapRange(a, b, line) : undefined),
  });
}
