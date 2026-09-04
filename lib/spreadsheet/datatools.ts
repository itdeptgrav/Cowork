/**
 * Data tools — the transforms Excel's Data tab performs on a selection.
 *
 * Pure, like the rest of the engine: each function takes a worksheet and a
 * range and returns `CellEdit[]`, so the caller applies them through the normal
 * command path and gets undo for free. Nothing here touches React or the store.
 */

import type { Rect } from "./coordinates";
import { getCellValue, type Worksheet } from "./model";
import type { CellEdit } from "./history";

/* ── Text to columns ──────────────────────────────────────────────────────── */

/** The separators the splitter offers. `space` collapses runs, the way a
    fixed-width-ish paste behaves; the others split on each occurrence. */
export type Delimiter = "comma" | "tab" | "semicolon" | "space";

const DELIMITER_RE: Record<Delimiter, RegExp> = {
  comma: /,/,
  tab: /\t/,
  semicolon: /;/,
  space: /\s+/,
};

/**
 * Split one field on a delimiter, honouring double quotes so a quoted comma
 * stays inside its field — the same rule the CSV reader follows, because the
 * text people paste into a column came from a CSV more often than not.
 */
export function splitField(text: string, delimiter: Delimiter): string[] {
  const re = DELIMITER_RE[delimiter];
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (re.test(ch)) {
      /* A run of whitespace is one separator; a run of commas is not. */
      if (delimiter === "space") {
        while (i + 1 < text.length && /\s/.test(text[i + 1])) i++;
      }
      out.push(field);
      field = "";
      continue;
    }
    field += ch;
  }
  out.push(field);
  return out;
}

/**
 * Split the selection's FIRST column across the columns to its right.
 *
 * Excel overwrites whatever is beside the column being split, and says so in a
 * dialog; this returns the edits that do it so the caller can warn first. Cells
 * that would fall outside the sheet are dropped rather than clamped, so a split
 * near the right edge writes what fits.
 */
export function textToColumnsEdits(
  ws: Worksheet,
  range: Rect,
  delimiter: Delimiter,
  colCount: number,
): CellEdit[] {
  const edits: CellEdit[] = [];
  for (let r = range.top; r <= range.bottom; r++) {
    const source = getCellValue(ws, r, range.left);
    if (source === "") continue;
    const parts = splitField(source, delimiter);
    for (let i = 0; i < parts.length; i++) {
      const col = range.left + i;
      if (col >= colCount) break;
      edits.push({ row: r, col, raw: parts[i] });
    }
  }
  return edits;
}

/** How wide a split would be — for warning about what it will overwrite. */
export function textToColumnsWidth(
  ws: Worksheet,
  range: Rect,
  delimiter: Delimiter,
): number {
  let widest = 1;
  for (let r = range.top; r <= range.bottom; r++) {
    const source = getCellValue(ws, r, range.left);
    if (source === "") continue;
    widest = Math.max(widest, splitField(source, delimiter).length);
  }
  return widest;
}

/* ── Subtotal ─────────────────────────────────────────────────────────────── */

/** One inserted subtotal: where it goes and the rows it covers. */
export interface SubtotalRow {
  /** The row the SUM is written to — the first free row after the group,
      always `to + 1`. The caller inserts a new row there, so no data row is
      overwritten and the SUM never includes its own cell. */
  row: number;
  /** The group's shared value, verbatim — "" for a run of blank cells. */
  label: string;
  /** The group's first data row (inclusive). */
  from: number;
  /** The group's last data row (inclusive). The SUM covers `from..to`. */
  to: number;
}

/**
 * Where subtotals fall when a range is grouped by a column's value.
 *
 * Excel's Subtotal assumes the data is SORTED by the grouping column: a group
 * ends when the value changes. That is deliberately not "every row with this
 * value" — it keeps the operation local and predictable, and it is why the
 * command is normally used straight after a sort. Returned as a plan rather
 * than edits so a caller can show what it is about to insert. EVERY run is
 * planned, the trailing one included: the end-of-range sentinel carries a raw
 * NUL prefix no typed cell value can contain, so a last group whose value looks
 * like a sentinel ("end", " end") still closes its run.
 */
export function subtotalPlan(
  range: Rect,
  groupCol: number,
  valueAt: (row: number, col: number) => string,
): SubtotalRow[] {
  const plan: SubtotalRow[] = [];
  let start = range.top;
  let current = valueAt(range.top, groupCol);
  for (let r = range.top + 1; r <= range.bottom + 1; r++) {
    const value = r <= range.bottom ? valueAt(r, groupCol) : "\0end";
    if (value === current) continue;
    plan.push({ row: r, label: current, from: start, to: r - 1 });
    start = r;
    current = value;
  }
  return plan;
}

/* ── Outline (row grouping) ───────────────────────────────────────────────── */

/**
 * A grouped band of rows. Collapsing one hides its rows — the same hidden-row
 * mechanism manual hiding and filtering already use, so the geometry, the
 * headers and the scrolling need to know nothing new about outlines.
 *
 * `from`/`to` are inclusive row indices.
 */
export interface RowGroup {
  from: number;
  to: number;
  collapsed?: boolean;
}

/** Whether two bands overlap at all. */
function bandsOverlap(a: RowGroup, b: { from: number; to: number }): boolean {
  return a.from <= b.to && a.to >= b.from;
}

/** Add a group over a row span, replacing any it overlaps. A span of fewer than
    two rows is not a group and is dropped. */
export function addRowGroup(
  groups: readonly RowGroup[] | undefined,
  from: number,
  to: number,
): RowGroup[] | undefined {
  if (to <= from) return groups ? [...groups] : undefined;
  const kept = (groups ?? []).filter((g) => !bandsOverlap(g, { from, to }));
  return [...kept, { from, to }];
}

/** Remove every group intersecting a span. */
export function removeRowGroup(
  groups: readonly RowGroup[] | undefined,
  from: number,
  to: number,
): RowGroup[] | undefined {
  if (!groups?.length) return groups ? [...groups] : undefined;
  const kept = groups.filter((g) => !bandsOverlap(g, { from, to }));
  return kept.length ? kept : undefined;
}

/** Flip the collapsed state of every group intersecting a span. */
export function toggleRowGroup(
  groups: readonly RowGroup[] | undefined,
  from: number,
  to: number,
  collapsed: boolean,
): RowGroup[] | undefined {
  if (!groups?.length) return groups ? [...groups] : undefined;
  return groups.map((g) =>
    bandsOverlap(g, { from, to }) ? { ...g, collapsed: collapsed || undefined } : g,
  );
}

/**
 * The rows a set of groups hides. A collapsed group hides everything it covers
 * EXCEPT its first row, which stays as the handle you re-expand from — hiding
 * the lot would leave nothing to click.
 */
export function collapsedRows(groups: readonly RowGroup[] | undefined): Record<number, true> {
  const hidden: Record<number, true> = {};
  if (!groups) return hidden;
  for (const g of groups) {
    if (!g.collapsed) continue;
    for (let r = g.from + 1; r <= g.to; r++) hidden[r] = true;
  }
  return hidden;
}

/**
 * Column outlines use the very same bands, over column indices. The helpers
 * above are index-agnostic, so a column group is a `RowGroup` kept in the
 * sheet's `colGroups`; only the reading of what is hidden gets its own name.
 */
export type ColGroup = RowGroup;

export function collapsedCols(groups: readonly RowGroup[] | undefined): Record<number, true> {
  return collapsedRows(groups);
}
