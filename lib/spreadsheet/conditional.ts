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
export interface NotEqualTo {
  type: "notEqualTo";
  value: number | string;
}
export interface GreaterOrEqual {
  type: "greaterOrEqual";
  value: number;
}
export interface LessOrEqual {
  type: "lessOrEqual";
  value: number;
}
export interface TextStartsWith {
  type: "textStartsWith";
  value: string;
}
export interface TextEndsWith {
  type: "textEndsWith";
  value: string;
}
export interface IsEmpty {
  type: "isEmpty";
}
export interface IsNotEmpty {
  type: "isNotEmpty";
}
/**
 * A colour scale: every numeric cell in the range takes a colour between
 * `min` and `max` (through `mid` when set) by where its value sits in the
 * range's own spread. Drawn by the grid from the range statistics; `styleId`
 * is unused.
 */
export interface ColorScale {
  type: "colorScale";
  min: string;
  mid?: string;
  max: string;
}
/** A data bar: a bar from the cell's left edge, as long as the value's
    share of the range's maximum. */
export interface DataBar {
  type: "dataBar";
  color: string;
}
export type CondCondition =
  | GreaterThan
  | LessThan
  | EqualTo
  | Between
  | TextContains
  | DuplicateValues
  | CustomFormula
  | NotEqualTo
  | GreaterOrEqual
  | LessOrEqual
  | TextStartsWith
  | TextEndsWith
  | IsEmpty
  | IsNotEmpty
  | ColorScale
  | DataBar;

/** Rules that paint from the range's numbers rather than a style. */
export function isVisualCondition(cond: CondCondition): cond is ColorScale | DataBar {
  return cond.type === "colorScale" || cond.type === "dataBar";
}

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
    case "notEqualTo":
      return typeof cond.value === "number"
        ? !(typeof ctx.value === "number" && ctx.value === cond.value)
        : ctx.display.toLowerCase() !== String(cond.value).toLowerCase();
    case "greaterOrEqual":
      return typeof ctx.value === "number" && ctx.value >= cond.value;
    case "lessOrEqual":
      return typeof ctx.value === "number" && ctx.value <= cond.value;
    case "textStartsWith":
      return cond.value !== "" && ctx.display.toLowerCase().startsWith(cond.value.toLowerCase());
    case "textEndsWith":
      return cond.value !== "" && ctx.display.toLowerCase().endsWith(cond.value.toLowerCase());
    case "isEmpty":
      return ctx.display === "";
    case "isNotEmpty":
      return ctx.display !== "";
    case "colorScale":
    case "dataBar":
      /* Painted from the range statistics by the grid, never a style match. */
      return false;
  }
}

/** Whether a rule's range contains a cell. */
export function rangeContains(range: Rect, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

/**
 * The displayed values that appear more than once (non-blank) in a range — the
 * lookup a `duplicateValues` rule needs, computed once per rule.
 *
 * Counted CASE-INSENSITIVELY (the key is lowercased), the way every other text
 * comparison in this module reads — "Apple" and "apple" are the same value, as
 * Excel's Duplicate Values rule flags them. The returned set holds every
 * original casing that appeared, so a caller's `set.has(display)` membership
 * test is already case-insensitive without lowering anything itself.
 */
export function duplicateValueSet(
  range: Rect,
  displayAt: (row: number, col: number) => string,
): Set<string> {
  const counts = new Map<string, { count: number; variants: Set<string> }>();
  for (let r = range.top; r <= range.bottom; r++) {
    for (let c = range.left; c <= range.right; c++) {
      const v = displayAt(r, c);
      if (v === "") continue;
      const key = v.toLowerCase();
      const entry = counts.get(key);
      if (entry) {
        entry.count += 1;
        entry.variants.add(v);
      } else {
        counts.set(key, { count: 1, variants: new Set([v]) });
      }
    }
  }
  const dups = new Set<string>();
  for (const { count, variants } of counts.values()) {
    if (count > 1) for (const v of variants) dups.add(v);
  }
  return dups;
}
