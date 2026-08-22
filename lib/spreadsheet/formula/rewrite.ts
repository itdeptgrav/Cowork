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
 * Which references move is decided by the optional CONTEXT naming the sheet the
 * edit is on. A sheet-qualified reference whose name matches the edited sheet
 * (case-insensitively) is rewritten exactly like a bare one — `=Sheet1!A5`
 * written ON Sheet1 names the same cell as `=A5`, and a formula on ANOTHER
 * sheet saying `=Sheet1!A5` follows Sheet1's rows too. Bare references are
 * rewritten only when the formula lives on the edited sheet (`onEditedSheet`),
 * because a bare ref points at the formula's OWN sheet. Without a context the
 * legacy behaviour holds: bare refs move, qualified refs do not.
 *
 * Like `references.ts` this works at the token level over source slices, so
 * only the rewritten references change and everything else — spacing included —
 * is re-emitted exactly as the author wrote it.
 */

import { columnIndex, columnLabel } from "../coordinates";
import { tokenizeSpanned, type SpannedToken } from "./tokenizer";

export type StructuralAxis = "row" | "col";
export type StructuralMode = "insert" | "delete";

export interface StructuralOp {
  axis: StructuralAxis;
  /** The 0-based index the insertion/deletion begins at. */
  at: number;
  count: number;
  mode: StructuralMode;
}

/** Which sheet a structural rewrite is FOR — see the module header. */
export interface RewriteContext {
  /** The name of the sheet the structural edit is happening on. A qualified
      reference naming it (case-insensitively) is rewritten like a bare one. */
  editedSheet: string;
  /** Whether the formula being rewritten lives ON the edited sheet (default
      true). When false — the formula is on another sheet — its bare references
      point at that other sheet and are left untouched. */
  onEditedSheet?: boolean;
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
 * easy to get subtly different: which sheet-qualified references move (see the
 * module header), a range consumed as one unit rather than two endpoints, an
 * unparseable reference emitted verbatim, and everything untouched re-emitted
 * from its source slice — spacing and spellings exactly as written.
 */
function transformRefs(raw: string, h: RefHandlers, ctx?: RewriteContext): string {
  if (!raw.startsWith("=")) return raw;
  const body = raw.slice(1);
  let tokens: SpannedToken[];
  try {
    tokens = tokenizeSpanned(body);
  } catch {
    return raw;
  }
  const rewriteBare = !ctx || ctx.onEditedSheet !== false;
  const editedSheet = ctx?.editedSheet.toLowerCase();

  let out = "=";
  let pos = 0; // everything in body[pos..] not yet emitted flows out verbatim

  /** Replace body[from..to) with `text`, emitting the verbatim gap before it. */
  const replace = (from: number, to: number, text: string): void => {
    out += body.slice(pos, from) + text;
    pos = to;
  };

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];

    if (t.type === "sheet") {
      /* A qualified reference. It follows this edit only when it names the
         edited sheet; any other sheet's cells did not move, so it is left
         exactly as written. */
      i += 1;
      if (tokens[i]?.type !== "ref") continue; // stray qualifier — verbatim
      const startTok = tokens[i];
      const isRange = tokens[i + 1]?.type === "colon" && tokens[i + 2]?.type === "ref";
      const endTok = isRange ? tokens[i + 2] : startTok;
      const matches = editedSheet !== undefined && t.value.toLowerCase() === editedSheet;
      if (matches) {
        const a = parseRef(startTok.value);
        if (isRange) {
          const b = parseRef(endTok.value);
          const mapped = a && b ? h.range(a, b) : undefined;
          /* A dead target loses its qualifier too — `Sheet1!#REF!` would not
             parse, and there is nothing left on that sheet to point at. */
          if (mapped === null) replace(t.start, endTok.end, "#REF!");
          else if (mapped !== undefined) {
            replace(startTok.start, endTok.end, `${refText(mapped[0])}:${refText(mapped[1])}`);
          }
        } else {
          const mapped = a ? h.single(a) : undefined;
          if (mapped === null) replace(t.start, endTok.end, "#REF!");
          else if (mapped !== undefined) replace(startTok.start, endTok.end, refText(mapped));
        }
      }
      i += isRange ? 3 : 1;
      continue;
    }

    if (t.type === "ref" && rewriteBare) {
      const isRange = tokens[i + 1]?.type === "colon" && tokens[i + 2]?.type === "ref";
      if (isRange) {
        const endTok = tokens[i + 2];
        const a = parseRef(t.value);
        const b = parseRef(endTok.value);
        const mapped = a && b ? h.range(a, b) : undefined;
        if (mapped === null) replace(t.start, endTok.end, "#REF!");
        else if (mapped !== undefined) {
          replace(t.start, endTok.end, `${refText(mapped[0])}:${refText(mapped[1])}`);
        }
        i += 3;
        continue;
      }
      const a = parseRef(t.value);
      const mapped = a ? h.single(a) : undefined;
      if (mapped === null) replace(t.start, t.end, "#REF!");
      else if (mapped !== undefined) replace(t.start, t.end, refText(mapped));
      i += 1;
      continue;
    }

    i += 1;
  }
  out += body.slice(pos);
  return out;
}

/**
 * Rewrite a raw formula's references for a row/column insertion or deletion.
 * `ctx` names the sheet the edit is on (and whether this formula lives there),
 * deciding which qualified/bare references move — see the module header. A
 * non-formula or an untokenizable string is returned untouched.
 */
export function transformStructural(raw: string, op: StructuralOp, ctx?: RewriteContext): string {
  return transformRefs(
    raw,
    {
      single: (r) => mapSingle(r, op),
      range: (a, b) => mapRange(a, b, op),
    },
    ctx,
  );
}

/**
 * Rewrite a raw formula's references for a cell-block shift.
 *
 * Only references inside the shifted band move; everything else — including a
 * range that straddles the band's edge — is left exactly as written. `ctx`
 * plays the same role as in `transformStructural`.
 */
export function transformRegionShift(raw: string, op: RegionShiftOp, ctx?: RewriteContext): string {
  const line = lineOp(op);
  return transformRefs(
    raw,
    {
      single: (r) => (inBand(r, op) ? mapSingle(r, line) : undefined),
      range: (a, b) => (rangeInBand(a, b, op) ? mapRange(a, b, line) : undefined),
    },
    ctx,
  );
}
