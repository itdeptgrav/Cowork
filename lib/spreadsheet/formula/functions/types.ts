/**
 * Shared machinery for the function library.
 *
 * A function takes its argument NODES (not pre-evaluated) plus a context, so it
 * controls its own evaluation — IF takes only one branch, aggregators expand a
 * range, and an array-returning argument (from FILTER/UNIQUE/SORT) flattens into
 * an aggregate. Everything a category module needs — arity checks, numeric
 * aggregation, criteria matching, value comparison, date serials — lives here so
 * no single module grows into the old monolith.
 */

import type { Node } from "../ast";
import type { FnContext } from "../evaluator";
import { FormulaError, VALUE, isError } from "../errors";
import { formatNumber, isArray, isBlank, toNumber, type ScalarValue } from "../value";

export type Fn = (args: Node[], ctx: FnContext) => ScalarValue;

/** A #VALUE! when the argument count is outside `[min, max]`. */
export function argCount(args: Node[], min: number, max = min): FormulaError | null {
  return args.length < min || args.length > max ? VALUE : null;
}

/**
 * The numbers an aggregate sees. A RANGE (or an array-returning argument)
 * contributes only its numeric cells — text, booleans and blanks are ignored,
 * the spreadsheet rule. A direct scalar is coerced (TRUE → 1, "2" → 2, blank
 * skipped, non-numeric text → #VALUE!). The first error short-circuits.
 */
export function aggregateNumbers(args: Node[], ctx: FnContext): number[] | FormulaError {
  const nums: number[] = [];
  const fromRange = (values: ScalarValue[]): FormulaError | null => {
    for (const v of values) {
      if (isError(v)) return v;
      if (typeof v === "number") nums.push(v);
    }
    return null;
  };
  for (const arg of args) {
    if (arg.type === "range") {
      const err = fromRange(ctx.collect(arg));
      if (err) return err;
      continue;
    }
    const v = ctx.eval(arg);
    if (isError(v)) return v;
    if (isArray(v)) {
      const err = fromRange(v.flat());
      if (err) return err;
      continue;
    }
    if (isBlank(v)) continue;
    const n = toNumber(v);
    if (isError(n)) return n;
    nums.push(n);
  }
  return nums;
}

/** A single required numeric argument, coerced. */
export function oneNumber(args: Node[], ctx: FnContext): number | FormulaError {
  const bad = argCount(args, 1);
  if (bad) return bad;
  return toNumber(ctx.eval(args[0]));
}

/** Every value an argument yields, flat — a range's cells, an array's elements,
    or a single value. */
export function values(arg: Node, ctx: FnContext): ScalarValue[] {
  return ctx.collect(arg);
}

/* ── Comparison (the spreadsheet's cross-type order) ──────────────────────── */

function rank(v: ScalarValue): number {
  if (typeof v === "number") return 0;
  if (typeof v === "string") return 1;
  if (typeof v === "boolean") return 2;
  return 3; // blank/other sort last
}

/**
 * Order two values the way a spreadsheet does: numbers before text before
 * booleans, text case-insensitively. Used by MATCH and SORT.
 */
export function compareValues(a: ScalarValue, b: ScalarValue): number {
  if (rank(a) !== rank(b)) return rank(a) < rank(b) ? -1 : 1;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "boolean" && typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);
  const sa = String(a).toUpperCase();
  const sb = String(b).toUpperCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Value equality for exact lookups — case-insensitive for text. */
export function valuesEqual(a: ScalarValue, b: ScalarValue): boolean {
  return compareValues(a, b) === 0;
}

/* ── Criteria (COUNTIF/SUMIF/…) ───────────────────────────────────────────── */

/** A value as the text a criterion compares against. */
function asText(v: ScalarValue): string {
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return formatNumber(v);
  return "";
}

/** A `*`/`?` wildcard pattern to a RegExp (case-insensitive). `~` escapes the
    next wildcard. Regular expressions are NOT supported — only these two. */
export function wildcardToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "~" && (pattern[i + 1] === "*" || pattern[i + 1] === "?")) {
      out += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    } else if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

/**
 * Whether a value satisfies a criterion, the COUNTIF/SUMIF language:
 *  · a bare number or text is an equality test (text is case-insensitive and may
 *    use `*` and `?` wildcards — which match TEXT cells only, never a
 *    stringified number or boolean);
 *  · a leading `>`, `<`, `>=`, `<=`, `=`, `<>` is a comparison. A NUMERIC
 *    right-hand side compares against numeric cells only — text and boolean
 *    cells simply never match (no lexicographic fallback), the Sheets/Excel
 *    rule that keeps `">5"` from counting "apple".
 *
 * Regular expressions are not supported; only the two wildcards are.
 */
export function matchesCriteria(value: ScalarValue, criterion: ScalarValue): boolean {
  if (isError(value)) return false;
  const text = asText(criterion).trim();
  const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(text)!;
  const op = m[1] ?? "";
  const rhs = m[2];

  const rhsNum = rhs.trim() !== "" && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(rhs.trim())
    ? Number(rhs.trim())
    : null;

  if (op === "" || op === "=" || op === "<>") {
    const equal =
      rhsNum !== null && typeof value === "number"
        ? value === rhsNum
        : /[*?]/.test(rhs)
          ? typeof value === "string" && wildcardToRegExp(rhs).test(value)
          : asText(value).toUpperCase() === rhs.toUpperCase();
    return op === "<>" ? !equal : equal;
  }

  /* An ordered comparison. A numeric criterion sees only numbers; a text one
     compares case-insensitive text order. */
  let c: number;
  if (rhsNum !== null) {
    if (typeof value !== "number") return false;
    c = value < rhsNum ? -1 : value > rhsNum ? 1 : 0;
  } else {
    const a = asText(value).toUpperCase();
    const b = rhs.toUpperCase();
    c = a < b ? -1 : a > b ? 1 : 0;
  }
  return op === ">" ? c > 0 : op === "<" ? c < 0 : op === ">=" ? c >= 0 : c <= 0;
}

/* ── Date serials ─────────────────────────────────────────────────────────── */

/** Serial 25569 = 1970-01-01, the convention `format.ts` reads and writes. */
export const EPOCH_OFFSET = 25569;
const DAY_MS = 86_400_000;

export function serialToDate(serial: number): Date {
  return new Date(Math.round((serial - EPOCH_OFFSET) * DAY_MS));
}

/** A UTC date to its serial (whole days + fraction of a day). */
export function dateToSerial(ms: number): number {
  return ms / DAY_MS + EPOCH_OFFSET;
}
