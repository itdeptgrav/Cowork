/**
 * Data validation — what a cell is allowed to hold.
 *
 * A validation names a range and a rule; the rule is checked when a value is
 * entered, and an invalid one is REJECTED (the cell keeps its previous value).
 * Two rules are also input MECHANISMS: a `list` cell offers a dropdown, and a
 * `checkbox` cell toggles TRUE/FALSE — so they can only ever hold a valid value.
 *
 * A blank is always allowed (clearing a cell is never an error). `custom` runs a
 * formula against the candidate value; the caller binds the evaluator to the
 * cell being validated. Dates are checked as serial numbers, so a date must be
 * entered as a serial or via DATE() — free-form date text is a documented gap.
 */

import type { Rect } from "./coordinates";
import { isError } from "./formula/errors";
import { isBlank, toBoolean, type ScalarValue } from "./formula/value";

export type CompareOp = ">" | "<" | ">=" | "<=" | "=" | "<>" | "between" | "notBetween" | "any";
export type TextMatch =
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "startsWith"
  | "notStartsWith"
  | "endsWith"
  | "notEndsWith";

export interface ListRule {
  kind: "list";
  values: string[];
}
export interface CheckboxRule {
  kind: "checkbox";
}
export interface NumberRule {
  kind: "number";
  op: CompareOp;
  a?: number;
  b?: number;
}
export interface DateRule {
  kind: "date";
  op: CompareOp;
  a?: number;
  b?: number;
}
export interface TextRule {
  kind: "text";
  op: TextMatch;
  value: string;
}

/* ── The pattern-shaped rules ─────────────────────────────────────────────────
   Each is a predicate over the cell's TEXT. They are deliberately separate
   kinds rather than presets over `pattern`, because the name is what a person
   picks from a list — "Email" is a choice, `^[^@]+@[^@]+$` is not. */

/** Length of the text, compared like a number. */
export interface TextLengthRule {
  kind: "textLength";
  op: CompareOp;
  a?: number;
  b?: number;
}
/** A regular expression the text must (or must not) match. */
export interface PatternRule {
  kind: "pattern";
  source: string;
  /** `false` inverts it — "does not match". */
  match?: boolean;
  flags?: string;
}
/** The named text shapes. One kind, so adding another is one list entry. */
export type TextShape =
  | "email"
  | "url"
  | "phone"
  | "ipv4"
  | "ipv6"
  | "alphanumeric"
  | "letters"
  | "digits";
export interface ShapeRule {
  kind: "shape";
  shape: TextShape;
}
/** Numeric shapes that are a constraint rather than a comparison. */
export type NumberShape = "integer" | "positive" | "negative" | "nonNegative" | "percentage";
export interface NumberShapeRule {
  kind: "numberShape";
  shape: NumberShape;
}
/** Emptiness, asserted rather than ignored. */
export interface BlankRule {
  kind: "blank";
  /** `true` demands a value; `false` demands the cell stay empty. */
  mustHaveValue: boolean;
}
/**
 * Uniqueness within the validated range.
 *
 * Needs to see the range's other values, which `validateValue` cannot read on
 * its own — the caller supplies them. When it cannot (no accessor passed), the
 * rule PASSES rather than failing closed: refusing every entry because context
 * is missing would be worse than not enforcing it.
 */
export interface UniqueRule {
  kind: "unique";
  /** `false` inverts it: the value must already appear elsewhere. */
  unique?: boolean;
}

const SHAPE_RE: Record<TextShape, RegExp> = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  url: /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i,
  /* Digits, with optional country code, and the separators people actually
     type. Deliberately permissive: a strict phone regex rejects real numbers. */
  phone: /^\+?[0-9][0-9\s().-]{5,}$/,
  ipv4: /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
  ipv6: /^(([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,7}:|::([0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})$/i,
  alphanumeric: /^[a-z0-9]+$/i,
  letters: /^[a-z]+$/i,
  digits: /^[0-9]+$/,
};

/** Whether text has a named shape. */
export function hasShape(text: string, shape: TextShape): boolean {
  return SHAPE_RE[shape].test(text.trim());
}

/** Whether a number has a named shape. */
export function hasNumberShape(n: number, shape: NumberShape): boolean {
  switch (shape) {
    case "integer": return Number.isInteger(n);
    case "positive": return n > 0;
    case "negative": return n < 0;
    case "nonNegative": return n >= 0;
    case "percentage": return n >= 0 && n <= 1;
  }
}
export interface CustomRule {
  kind: "custom";
  formula: string;
}
export type ValidationRule =
  | TextLengthRule
  | PatternRule
  | ShapeRule
  | NumberShapeRule
  | BlankRule
  | UniqueRule
  | ListRule
  | CheckboxRule
  | NumberRule
  | DateRule
  | TextRule
  | CustomRule;

/**
 * How a rule behaves when it is broken, and what it tells the person.
 *
 * `errorStyle` is the part that changes BEHAVIOUR rather than wording: `stop`
 * refuses the entry, while `warning` and `information` let it through and only
 * say something. That distinction is why rejection is derived from the style
 * rather than being a second, independently-settable flag that could contradict
 * it.
 */
export type ErrorStyle = "stop" | "warning" | "information";

export interface Validation {
  range: Rect;
  rule: ValidationRule;
  /** Whether an empty cell passes. Default true — Excel's "Ignore blank". */
  allowBlank?: boolean;
  /** Shown while the cell is selected, before anything is typed. */
  inputTitle?: string;
  inputMessage?: string;
  /** Shown when the rule is broken. */
  errorTitle?: string;
  errorMessage?: string;
  /** Defaults to `stop`. */
  errorStyle?: ErrorStyle;
}

/** Whether a broken rule REFUSES the entry, or merely comments on it. */
export function rejectsInvalid(v: Validation): boolean {
  return (v.errorStyle ?? "stop") === "stop";
}

/**
 * How close two numbers must be to count as equal.
 *
 * IEEE-754 cannot represent 0.1 or 0.2 exactly, so `0.1 + 0.2` is
 * 0.30000000000000004 and a strict `===` against 0.3 says no. Somebody who adds
 * two cells and validates "equal to 0.3" means yes, so equality and the
 * inclusive comparisons work to a RELATIVE tolerance — scaled by magnitude, so
 * it holds for 0.3 and for 1e9 alike, and small enough that genuinely different
 * values (1 vs 1.0000001) still differ.
 */
const EPSILON = 1e-9;

function nearlyEqual(x: number, y: number): boolean {
  if (x === y) return true; // covers Infinity, and the exact case
  const scale = Math.max(Math.abs(x), Math.abs(y), 1);
  return Math.abs(x - y) <= EPSILON * scale;
}

function comparePasses(op: CompareOp, n: number, a = 0, b?: number): boolean {
  switch (op) {
    case "any": return true;
    case ">": return n > a;
    case "<": return n < a;
    /* The INCLUSIVE forms admit the tolerance; the strict ones must not, or
       "greater than 10" would accept 10. */
    case ">=": return n >= a || nearlyEqual(n, a);
    case "<=": return n <= a || nearlyEqual(n, a);
    case "=": return nearlyEqual(n, a);
    case "<>": return !nearlyEqual(n, a);
    case "between": {
      const hi = b ?? a;
      return (n >= a || nearlyEqual(n, a)) && (n <= hi || nearlyEqual(n, hi));
    }
    case "notBetween": {
      const hi = b ?? a;
      return !((n >= a || nearlyEqual(n, a)) && (n <= hi || nearlyEqual(n, hi)));
    }
  }
}

function textPasses(op: TextMatch, text: string, value: string): boolean {
  const hay = text.toLowerCase();
  const needle = value.toLowerCase();
  switch (op) {
    case "contains": return hay.includes(needle);
    case "notContains": return !hay.includes(needle);
    case "equals": return hay === needle;
    case "notEquals": return hay !== needle;
    case "startsWith": return hay.startsWith(needle);
    case "notStartsWith": return !hay.startsWith(needle);
    case "endsWith": return hay.endsWith(needle);
    case "notEndsWith": return !hay.endsWith(needle);
  }
}

/**
 * Whether `rawValue` satisfies a rule. `interpret` reads the raw string as a
 * value (number/boolean/text/blank); `evalCustom` runs a custom rule's formula,
 * already bound by the caller to the validated cell and the candidate value.
 */
export function validateValue(
  rule: ValidationRule,
  rawValue: string,
  interpret: (raw: string) => ScalarValue,
  evalCustom: (formula: string) => ScalarValue,
  opts: {
    /** Whether an empty cell passes. Excel's "Ignore blank", on by default. */
    allowBlank?: boolean;
    /** The other values in the validated range — only `unique` needs them. */
    others?: () => readonly string[];
  } = {},
): boolean {
  const { allowBlank = true, others } = opts;
  const value = interpret(rawValue);
  const empty = isBlank(value) || rawValue.trim() === "";
  /* Blankness is the one thing every rule must answer before its own logic:
     `blank` asserts it, and everything else ignores it (Excel's default) unless
     the caller turned "allow blank" off. */
  if (rule.kind === "blank") return rule.mustHaveValue ? !empty : empty;
  if (empty) return allowBlank;

  switch (rule.kind) {
    case "list":
      /* Compared the way text rules compare: trimmed and case-insensitive. A
         value pasted with a stray space, or typed in another case, is the same
         choice as far as the person picking it is concerned — and matching it
         strictly here while `text` rules matched loosely was an inconsistency
         between two rules that look the same on screen. */
      return rule.values.some((v) => v.trim().toLowerCase() === rawValue.trim().toLowerCase());
    case "checkbox": {
      const up = rawValue.trim().toUpperCase();
      return up === "TRUE" || up === "FALSE";
    }
    case "number":
      return typeof value === "number" && comparePasses(rule.op, value, rule.a, rule.b);
    case "date": {
      return typeof value === "number" && comparePasses(rule.op, value, rule.a, rule.b);
    }
    case "text":
      /* Judged on the RAW entry, not the interpreted value: "123" interprets to
         the number 123, and a `typeof value === "string"` guard silently
         skipped every numeric entry — a text rule could never match digits. */
      return textPasses(rule.op, rawValue, rule.value);
    case "custom": {
      const result = evalCustom(rule.formula);
      if (isError(result)) return false;
      const b = toBoolean(result);
      return !isError(b) && b === true;
    }
    case "textLength":
      return comparePasses(rule.op, rawValue.length, rule.a, rule.b);
    case "pattern": {
      /* An unparseable expression must not throw into the edit path; a rule
         nobody can satisfy is reported as a failure, not a crash. */
      let re: RegExp;
      try {
        re = new RegExp(rule.source, rule.flags ?? "");
      } catch {
        return false;
      }
      return re.test(rawValue) === (rule.match ?? true);
    }
    case "shape":
      return hasShape(rawValue, rule.shape);
    case "numberShape":
      return typeof value === "number" && hasNumberShape(value, rule.shape);
    case "unique": {
      if (!others) return true; // no context to judge by — see UniqueRule
      const seen = others().filter((v) => v.trim() === rawValue.trim()).length;
      return (rule.unique ?? true) ? seen === 0 : seen > 0;
    }
  }
}

/** The validation covering a cell, or null. Later rules win on overlap. */
export function validationAt(
  validations: readonly Validation[] | undefined,
  row: number,
  col: number,
): Validation | null {
  if (!validations) return null;
  for (let i = validations.length - 1; i >= 0; i--) {
    const { range } = validations[i];
    if (row >= range.top && row <= range.bottom && col >= range.left && col <= range.right) {
      return validations[i];
    }
  }
  return null;
}
