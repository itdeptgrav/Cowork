/**
 * Filters — hiding rows that do not match, WITHOUT touching the data.
 *
 * A filter is a definition, not an edit: it names a range (its first row is the
 * header) and, per column, what passes — a set of allowed displayed values ("by
 * value"), and/or a condition ("by number/text/date"). From that, this computes
 * which data rows to HIDE. The underlying cells are never deleted or moved
 * (requirement); clearing the filter simply recomputes with nothing to hide, and
 * every value is exactly where it was.
 *
 * The hiding is layered onto the same zero-height mechanism manual hiding uses,
 * so a filtered sheet still scrolls and prints the visible rows and nothing else.
 */

import type { Rect } from "./coordinates";

export type NumberOp = ">" | "<" | ">=" | "<=" | "=" | "<>" | "between";
export type TextOp = "contains" | "notContains" | "equals" | "notEquals" | "startsWith" | "endsWith";

export interface NumberCondition {
  type: "number";
  op: NumberOp;
  a: number;
  b?: number;
}
export interface DateCondition {
  type: "date";
  op: NumberOp;
  /** Serial numbers, on the display layer's date scale. */
  a: number;
  b?: number;
}
export interface TextCondition {
  type: "text";
  op: TextOp;
  value: string;
}
export type FilterCondition = NumberCondition | DateCondition | TextCondition;

export interface ColumnFilter {
  /** If present, only these DISPLAYED values pass (the "filter by value" list). */
  values?: string[];
  /** An extra condition a row must also satisfy. */
  condition?: FilterCondition;
}

export interface SheetFilter {
  /** The whole filter block; `range.top` is the header row, the rest is data. */
  range: Rect;
  /** Per absolute column index. A column with no entry filters nothing. */
  columns: Record<number, ColumnFilter>;
}

function numberPasses(cond: NumberCondition | DateCondition, n: number | null): boolean {
  if (n === null) return false;
  switch (cond.op) {
    case ">": return n > cond.a;
    case "<": return n < cond.a;
    case ">=": return n >= cond.a;
    case "<=": return n <= cond.a;
    case "=": return n === cond.a;
    case "<>": return n !== cond.a;
    case "between": return n >= cond.a && n <= (cond.b ?? cond.a);
  }
}

function textPasses(cond: TextCondition, text: string): boolean {
  const hay = text.toLowerCase();
  const needle = cond.value.toLowerCase();
  switch (cond.op) {
    case "contains": return hay.includes(needle);
    case "notContains": return !hay.includes(needle);
    case "equals": return hay === needle;
    case "notEquals": return hay !== needle;
    case "startsWith": return hay.startsWith(needle);
    case "endsWith": return hay.endsWith(needle);
  }
}

export function conditionPasses(
  cond: FilterCondition,
  display: string,
  num: number | null,
): boolean {
  return cond.type === "text" ? textPasses(cond, display) : numberPasses(cond, num);
}

function columnPasses(cf: ColumnFilter, display: string, num: number | null): boolean {
  if (cf.values && !cf.values.includes(display)) return false;
  if (cf.condition && !conditionPasses(cf.condition, display, num)) return false;
  return true;
}

/**
 * The data rows a filter hides — those failing any column's criteria. Reads the
 * DISPLAYED text (for value/text matching) and the numeric value (for
 * number/date conditions); writes nothing.
 */
export function computeFilterHidden(
  filter: SheetFilter,
  displayAt: (row: number, col: number) => string,
  numberAt: (row: number, col: number) => number | null,
): Record<number, true> {
  const hidden: Record<number, true> = {};
  for (let r = filter.range.top + 1; r <= filter.range.bottom; r++) {
    for (const key of Object.keys(filter.columns)) {
      const col = Number(key);
      if (!columnPasses(filter.columns[col], displayAt(r, col), numberAt(r, col))) {
        hidden[r] = true;
        break;
      }
    }
  }
  return hidden;
}

/** The distinct displayed values in a filter column's data — for the value list. */
export function columnValues(
  range: Rect,
  col: number,
  displayAt: (row: number, col: number) => string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let r = range.top + 1; r <= range.bottom; r++) {
    const v = displayAt(r, col);
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}
