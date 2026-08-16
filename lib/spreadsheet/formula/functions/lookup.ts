/**
 * Lookup functions.
 *
 * These need a range's SHAPE, not a flat list, so they read `ctx.matrix`.
 * Documented limits: approximate match (VLOOKUP/HLOOKUP with TRUE, MATCH types
 * ±1) assumes the data is sorted, as in any spreadsheet, and does not verify it;
 * exact lookups compare by value without wildcards EXCEPT XLOOKUP's match mode 2;
 * and XLOOKUP supports exact (0) and wildcard (2) matching plus `if_not_found` —
 * the approximate modes (−1/1) and the reverse search mode are not implemented
 * and fall back to exact.
 */

import type { Node } from "../ast";
import type { FnContext } from "../evaluator";
import { NA, REF, VALUE, isError } from "../errors";
import { ArrayValue, type ScalarValue } from "../value";
import { argCount, compareValues, valuesEqual, wildcardToRegExp, type Fn } from "./types";

/** A 1-D vector from a range/array matrix (row- or column-shaped), row-major. */
function vectorOf(matrix: ScalarValue[][]): ScalarValue[] {
  return matrix.flat();
}

/** The index (0-based) of `lookup` in `vector`, or −1. `type`: 0 exact, 1 largest
    value ≤ lookup, −1 smallest value ≥ lookup. */
function matchIndex(vector: ScalarValue[], lookup: ScalarValue, type: number): number {
  if (type === 0) {
    for (let i = 0; i < vector.length; i++) if (valuesEqual(vector[i], lookup)) return i;
    return -1;
  }
  let best = -1;
  for (let i = 0; i < vector.length; i++) {
    const c = compareValues(vector[i], lookup);
    if (type === 1 && c <= 0) {
      if (best === -1 || compareValues(vector[i], vector[best]) > 0) best = i;
    } else if (type === -1 && c >= 0) {
      if (best === -1 || compareValues(vector[i], vector[best]) < 0) best = i;
    }
  }
  return best;
}

const MATCH: Fn = (args, ctx) => {
  const bad = argCount(args, 2, 3);
  if (bad) return bad;
  const lookup = ctx.eval(args[0]);
  if (isError(lookup)) return lookup;
  const vector = vectorOf(ctx.matrix(args[1]));
  const type = args.length === 3 ? Number(ctx.eval(args[2])) : 1;
  const idx = matchIndex(vector, lookup, type === 0 ? 0 : type > 0 ? 1 : -1);
  return idx === -1 ? NA : idx + 1;
};

const INDEX: Fn = (args, ctx) => {
  const bad = argCount(args, 2, 3);
  if (bad) return bad;
  const matrix = ctx.matrix(args[0]);
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const rowArg = ctx.eval(args[1]);
  if (isError(rowArg)) return rowArg;
  const colArg = args.length === 3 ? ctx.eval(args[2]) : null;
  if (colArg !== null && isError(colArg)) return colArg;
  let r = Math.trunc(Number(rowArg));
  let c = colArg === null ? (rows === 1 ? 1 : 0) : Math.trunc(Number(colArg));
  /* A single-row/column range indexed with one number treats it as a position. */
  if (args.length === 2 && rows === 1) {
    c = r;
    r = 1;
  }
  if (r < 0 || c < 0 || r > rows || c > cols) return REF;
  /* A zero index returns the whole column (r=0) or row (c=0) as an array. */
  if (r === 0) return new ArrayValue(matrix.map((row) => [row[c - 1]]));
  if (c === 0) return new ArrayValue([matrix[r - 1]]);
  return matrix[r - 1][c - 1];
};

function tableLookup(
  args: Node[],
  ctx: FnContext,
  orientation: "v" | "h",
): ScalarValue {
  const bad = argCount(args, 3, 4);
  if (bad) return bad;
  const lookup = ctx.eval(args[0]);
  if (isError(lookup)) return lookup;
  const matrix = ctx.matrix(args[1]);
  const index = Math.trunc(Number(ctx.eval(args[2])));
  if (index < 1) return VALUE;
  const approximate = args.length === 4 ? Boolean(coerceBool(ctx.eval(args[3]))) : true;

  const keyVector =
    orientation === "v" ? matrix.map((row) => row[0]) : (matrix[0] ?? []);
  const pos = matchIndex(keyVector, lookup, approximate ? 1 : 0);
  if (pos === -1) return NA;

  if (orientation === "v") {
    if (index > (matrix[0]?.length ?? 0)) return REF;
    return matrix[pos][index - 1];
  }
  if (index > matrix.length) return REF;
  return matrix[index - 1][pos];
}

/** A soft boolean coercion for VLOOKUP's range-lookup flag. */
function coerceBool(v: ScalarValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.trim().toUpperCase() !== "FALSE" && v.trim() !== "0";
  return true;
}

const VLOOKUP: Fn = (args, ctx) => tableLookup(args, ctx, "v");
const HLOOKUP: Fn = (args, ctx) => tableLookup(args, ctx, "h");

const XLOOKUP: Fn = (args, ctx) => {
  const bad = argCount(args, 3, 6);
  if (bad) return bad;
  const lookup = ctx.eval(args[0]);
  if (isError(lookup)) return lookup;
  const lookupVector = vectorOf(ctx.matrix(args[1]));
  const returnVector = vectorOf(ctx.matrix(args[2]));
  const matchMode = args.length >= 5 ? Math.trunc(Number(ctx.eval(args[4]))) : 0;

  let pos = -1;
  if (matchMode === 2 && typeof lookup === "string") {
    const re = wildcardToRegExp(lookup);
    pos = lookupVector.findIndex((v) => typeof v === "string" && re.test(v));
  } else {
    /* Exact by default; the approximate modes fall back to exact (documented). */
    pos = matchIndex(lookupVector, lookup, 0);
  }
  if (pos === -1) return args.length >= 4 ? ctx.eval(args[3]) : NA;
  return returnVector[pos] ?? NA;
};

export const LOOKUP_FUNCTIONS: Record<string, Fn> = {
  MATCH,
  INDEX,
  VLOOKUP,
  HLOOKUP,
  XLOOKUP,
};
