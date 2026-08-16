/**
 * Conditional formatting — a style shown when a cell meets a condition, WITHOUT
 * changing the cell's own style.
 *
 * A rule names a range, a condition, and a style id (in the registry). The
 * rendering layer computes the EFFECTIVE style for each cell: the base cell
 * style, with each matching rule's style layered on top (later rules win). The
 * stored `cellStyles` entry is never touched — clearing the rule reveals exactly
 * the style that was always underneath (requirement).
 *
 * `duplicateValues` needs to know a cell's neighbours, so the caller precomputes
 * the set of repeated displayed values in each rule's range; `customFormula`
 * needs the engine, so the caller binds a per-cell evaluator. Everything else is
 * decided from the cell's own value here.
 */

import type { Rect } from "./coordinates";
import { isError } from "./formula/errors";
import { toBoolean, type ScalarValue } from "./formula/value";

export interface GreaterThan {
  type: "greaterThan";
  value: number;
}
export interface LessThan {
  type: "lessThan";
  value: number;
}
export interface EqualTo {
  type: "equalTo";
  value: number | string;
}
export interface Between {
  type: "between";
  a: number;
  b: number;
}
export interface TextContains {
  type: "textContains";
  value: string;
}
export interface DuplicateValues {
  type: "duplicateValues";
}
export interface CustomFormula {
  type: "customFormula";
  formula: string;
}
export type CondCondition =
  | GreaterThan
  | LessThan
  | EqualTo
  | Between
  | TextContains
  | DuplicateValues
  | CustomFormula;

export interface ConditionalFormat {
  range: Rect;
  condition: CondCondition;
  /** The style id layered on top of the base cell style when the condition holds. */
  styleId: number;
}

/** What a rule is tested against for one cell. */
export interface CondContext {
  /** The cell's computed value — numbers/dates as numbers, text as strings. */
  value: ScalarValue;
  /** The displayed text — for text matching and duplicate keying. */
  display: string;
  /** Whether this cell's value repeats in the rule's range (precomputed). */
  isDuplicate: boolean;
  /** Evaluate the rule's custom formula for this cell (bound by the caller). */
  evalCustom: () => ScalarValue;
}

export function conditionMatches(cond: CondCondition, ctx: CondContext): boolean {
  switch (cond.type) {
    case "greaterThan":
      return typeof ctx.value === "number" && ctx.value > cond.value;
    case "lessThan":
      return typeof ctx.value === "number" && ctx.value < cond.value;
    case "between":
      return typeof ctx.value === "number" && ctx.value >= cond.a && ctx.value <= cond.b;
    case "equalTo":
      return typeof cond.value === "number"
        ? typeof ctx.value === "number" && ctx.value === cond.value
        : ctx.display.toLowerCase() === String(cond.value).toLowerCase();
    case "textContains":
      return ctx.display.toLowerCase().includes(cond.value.toLowerCase());
    case "duplicateValues":
      return ctx.isDuplicate;
    case "customFormula": {
      const b = toBoolean(ctx.evalCustom());
      return !isError(b) && b === true;
    }
  }
}

/** Whether a rule's range contains a cell. */
export function rangeContains(range: Rect, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

/**
 * The displayed values that appear more than once (non-blank) in a range — the
 * lookup a `duplicateValues` rule needs, computed once per rule.
 */
export function duplicateValueSet(
  range: Rect,
  displayAt: (row: number, col: number) => string,
): Set<string> {
  const counts = new Map<string, number>();
  for (let r = range.top; r <= range.bottom; r++) {
    for (let c = range.left; c <= range.right; c++) {
      const v = displayAt(r, c);
      if (v === "") continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  const dups = new Set<string>();
  for (const [v, n] of counts) if (n > 1) dups.add(v);
  return dups;
}
