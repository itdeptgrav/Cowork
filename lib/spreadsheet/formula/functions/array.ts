/**
 * Dynamic-array functions — UNIQUE, FILTER, SORT.
 *
 * These produce a 2-D `ArrayValue`. **Spilling is a documented non-feature:** the
 * engine stores one value per cell, so an array in a cell shows only its
 * top-left element. The functions are still useful nested — `SUM(UNIQUE(A1:A9))`,
 * `SUM(FILTER(A1:A9, B1:B9))` — because the aggregators flatten an array
 * argument. UNIQUE and FILTER keep the shape of their input (a column stays a
 * column); SORT and FILTER work over ROWS (`by_col` is not implemented).
 *
 * FILTER's `include` must be an actual range or array of booleans — a helper
 * column, or another array function. Inline array comparisons such as
 * `A1:A9>100` are NOT supported: the engine has no array broadcasting, so a
 * range inside an arithmetic/comparison expression is a #VALUE!, not a boolean
 * array.
 */

import { NA, isError } from "../errors";
import { ArrayValue, isBlank, toBoolean, type ScalarValue } from "../value";
import { argCount, compareValues, type Fn } from "./types";

const UNIQUE: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 3);
  if (bad) return bad;
  const matrix = ctx.matrix(args[0]);
  const exactlyOnce = args.length >= 3 && toBoolean(ctx.eval(args[2])) === true;

  const order: string[] = [];
  const seen = new Map<string, { row: ScalarValue[]; count: number }>();
  for (const row of matrix) {
    const key = row.map(keyOf).join("");
    const entry = seen.get(key);
    if (entry) entry.count += 1;
    else {
      seen.set(key, { row, count: 1 });
      order.push(key);
    }
  }
  const rows = order
    .map((k) => seen.get(k)!)
    .filter((e) => (exactlyOnce ? e.count === 1 : true))
    .map((e) => e.row);
  return rows.length === 0 ? NA : new ArrayValue(rows);
};

const FILTER: Fn = (args, ctx) => {
  const bad = argCount(args, 2, 3);
  if (bad) return bad;
  const matrix = ctx.matrix(args[0]);
  const include = ctx.matrix(args[1]).flat();
  const kept: ScalarValue[][] = [];
  for (let i = 0; i < matrix.length; i++) {
    const keep = toBoolean(include[i] ?? false);
    if (isError(keep)) return keep;
    if (keep) kept.push(matrix[i]);
  }
  if (kept.length === 0) return args.length === 3 ? ctx.eval(args[2]) : NA;
  return new ArrayValue(kept);
};

const SORT: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 3);
  if (bad) return bad;
  const matrix = ctx.matrix(args[0]);
  const index = args.length >= 2 ? Math.trunc(Number(ctx.eval(args[1]))) : 1;
  const order = args.length >= 3 ? Math.trunc(Number(ctx.eval(args[2]))) : 1;
  const col = Math.max(0, index - 1);
  const dir = order < 0 ? -1 : 1;
  const rows = matrix
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const c = compareValues(a.row[col] ?? blankSort, b.row[col] ?? blankSort);
      /* Stable: fall back to original position on ties. */
      return c !== 0 ? c * dir : a.i - b.i;
    })
    .map((x) => x.row);
  return new ArrayValue(rows);
};

const blankSort: ScalarValue = "";

/** A canonical key for de-duplication, agreeing with `compareValues`. */
function keyOf(v: ScalarValue): string {
  if (typeof v === "number") return `n:${v}`;
  if (typeof v === "boolean") return `b:${v}`;
  if (isBlank(v)) return "e:";
  if (isError(v)) return `x:${v.code}`;
  return `s:${String(v).toUpperCase()}`;
}

export const ARRAY_FUNCTIONS: Record<string, Fn> = {
  UNIQUE,
  FILTER,
  SORT,
};
