/**
 * Runtime values — what a formula computes, and how types coerce.
 *
 * A scalar is a number, a string, a boolean, an error, or a BLANK (an empty
 * cell — distinct from the empty string, because it is 0 in arithmetic but is
 * not counted). Coercion follows spreadsheet rules: arithmetic wants numbers,
 * `&`-style text wants strings, and an error short-circuits everything.
 */

import { FormulaError, VALUE, isError } from "./errors";

/** An empty cell's value — 0 in arithmetic, "" as text, uncounted by COUNT. */
export class Blank {
  readonly kind = "blank" as const;
}
export const BLANK = new Blank();

/**
 * A 2-D array of values — what a dynamic-array function (UNIQUE, FILTER, SORT)
 * produces.
 *
 * The engine stores ONE value per cell and does not spill, so an array that
 * lands in a cell shows only its top-left element (`first`) — the multi-cell
 * spill of a real spreadsheet is a documented non-feature. Where an array is
 * CONSUMED by another function (`SUM(UNIQUE(A1:A9))`), the aggregators flatten
 * it, so nesting still works.
 */
export class ArrayValue {
  readonly kind = "array" as const;
  readonly rows: ScalarValue[][];
  constructor(rows: ScalarValue[][]) {
    this.rows = rows;
  }
  /** The top-left cell — what a non-spilling cell displays, and how an array
      coerces in a scalar context. */
  get first(): ScalarValue {
    return this.rows[0]?.[0] ?? BLANK;
  }
  /** Every element, row-major — for aggregation. */
  flat(): ScalarValue[] {
    return this.rows.flat();
  }
}

/**
 * A picture in a cell — what SPARKLINE and IMAGE return. The grid draws it;
 * every other reader sees an empty cell: it has no number, and its text is "".
 */
export type RichPayload =
  | { type: "sparkline"; chart: "line" | "bar" | "column" | "winloss"; values: number[]; color?: string; min?: number; max?: number }
  | { type: "image"; url: string; mode: 1 | 2 | 3 };

export class RichValue {
  readonly kind = "rich" as const;
  readonly rich: RichPayload;
  constructor(rich: RichPayload) {
    this.rich = rich;
  }
}

export function isRich(value: unknown): value is RichValue {
  return value instanceof RichValue;
}

export type ScalarValue = number | string | boolean | FormulaError | Blank | ArrayValue | RichValue;

export function isBlank(value: ScalarValue): value is Blank {
  return value instanceof Blank;
}

export function isArray(value: ScalarValue): value is ArrayValue {
  return value instanceof ArrayValue;
}

const NUMERIC = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** Coerce to a number, or a #VALUE! error when text cannot be read as one.
    A BLANK (empty cell) is 0, but the empty STRING is not numeric text and is
    #VALUE! — the Sheets/Excel distinction (`=A1+1` is 1 when A1 is empty,
    `=""+1` is #VALUE!). Errors pass straight through; an array coerces via its
    top-left element. */
export function toNumber(value: ScalarValue): number | FormulaError {
  if (isError(value)) return value;
  if (isRich(value)) return VALUE;
  if (isArray(value)) return toNumber(value.first);
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (isBlank(value)) return 0;
  const text = value.trim();
  return NUMERIC.test(text) ? Number(text) : VALUE;
}

/** Coerce to text. Errors pass through; an array uses its top-left element. */
export function toText(value: ScalarValue): string | FormulaError {
  if (isError(value)) return value;
  if (isRich(value)) return "";
  if (isArray(value)) return toText(value.first);
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (isBlank(value)) return "";
  return formatNumber(value);
}

/** Coerce to a boolean, or #VALUE! for text that is not TRUE/FALSE. */
export function toBoolean(value: ScalarValue): boolean | FormulaError {
  if (isError(value)) return value;
  if (isRich(value)) return VALUE;
  if (isArray(value)) return toBoolean(value.first);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (isBlank(value)) return false;
  const upper = value.trim().toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  return VALUE;
}

/** A number as a spreadsheet shows it — no exponent for ordinary magnitudes,
    trailing zeros trimmed. Formatting proper (currency, decimals) is a later
    phase; this is the General-format default. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "#NUM!";
  if (Number.isInteger(n)) return String(n);
  /* Trim floating-point noise to ~15 significant digits, then drop trailing
     zeros — 0.1 + 0.2 shows "0.3", not "0.30000000000000004". */
  return String(Number(n.toPrecision(15)));
}
