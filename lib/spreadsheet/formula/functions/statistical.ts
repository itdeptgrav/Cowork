/**
 * Statistical functions — averages, spread, and the conditional aggregates.
 *
 * The `…IF`/`…IFS` family walks parallel ranges by position and keeps the cells
 * where every criterion matches; the criteria language (comparisons, `*`/`?`
 * wildcards) lives in `types.ts`. Ranges in one call are assumed the same shape,
 * as the spreadsheet requires; a mismatched shape is aligned by index rather
 * than erroring.
 */

import type { Node } from "../ast";
import type { FnContext } from "../evaluator";
import { DIV0, FormulaError, NA, NUM, isError } from "../errors";
import { isArray, isBlank, toNumber, type ScalarValue } from "../value";
import { aggregateNumbers, matchesCriteria, type Fn } from "./types";

const AVERAGE: Fn = (args, ctx) => {
  const nums = aggregateNumbers(args, ctx);
  if (isError(nums)) return nums;
  return nums.length === 0 ? DIV0 : nums.reduce((a, b) => a + b, 0) / nums.length;
};

/** COUNT never errors — it counts what is numeric and ignores the rest. In a
    range (or array) only numeric CELLS count; a direct argument counts when it
    coerces (TRUE, "5"), and unparseable direct text simply does not. Error
    values — direct or in a range — are ignored, not propagated (Sheets/Excel). */
const COUNT: Fn = (args, ctx) => {
  let count = 0;
  for (const arg of args) {
    if (arg.type === "range") {
      for (const v of ctx.collect(arg)) if (typeof v === "number") count += 1;
      continue;
    }
    const v = ctx.eval(arg);
    if (isArray(v)) {
      for (const x of v.flat()) if (typeof x === "number") count += 1;
      continue;
    }
    if (isError(v) || isBlank(v)) continue;
    if (!isError(toNumber(v))) count += 1;
  }
  return count;
};

/** Counts every non-blank value — errors and empty strings included. An array
    argument (UNIQUE, FILTER, …) is flattened to its elements, like the other
    aggregates. */
const COUNTA: Fn = (args, ctx) => {
  let count = 0;
  for (const arg of args) {
    for (const v of ctx.collect(arg)) if (!isBlank(v)) count += 1;
  }
  return count;
};

const MEDIAN: Fn = (args, ctx) => {
  const nums = aggregateNumbers(args, ctx);
  if (isError(nums)) return nums;
  if (nums.length === 0) return NUM; // no numeric data is #NUM!, per Sheets/Excel
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The most frequent value; #N/A when every value is unique (MODE.SNGL). */
const MODE: Fn = (args, ctx) => {
  const nums = aggregateNumbers(args, ctx);
  if (isError(nums)) return nums;
  const counts = new Map<number, number>();
  let best: number | null = null;
  let bestCount = 1;
  for (const n of nums) {
    const c = (counts.get(n) ?? 0) + 1;
    counts.set(n, c);
    if (c > bestCount) {
      bestCount = c;
      best = n;
    }
  }
  return best === null ? NA : best;
};

/** Sample variance/standard deviation (divisor n − 1); #DIV/0! below two values. */
function sampleVariance(nums: number[]): number | FormulaError {
  if (nums.length < 2) return DIV0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const ss = nums.reduce((a, b) => a + (b - mean) ** 2, 0);
  return ss / (nums.length - 1);
}

const VAR: Fn = (args, ctx) => {
  const nums = aggregateNumbers(args, ctx);
  if (isError(nums)) return nums;
  return sampleVariance(nums);
};

const STDEV: Fn = (args, ctx) => {
  const nums = aggregateNumbers(args, ctx);
  if (isError(nums)) return nums;
  const v = sampleVariance(nums);
  return isError(v) ? v : Math.sqrt(v);
};

/* ── Conditional aggregates ───────────────────────────────────────────────── */

/** The positions where a value matches a criterion. Errors propagate. */
function maskFor(range: ScalarValue[], criterion: ScalarValue): boolean[] | FormulaError {
  if (isError(criterion)) return criterion;
  return range.map((v) => matchesCriteria(v, criterion));
}

/** Combine a mask over parallel (range, criterion) pairs starting at `from`. */
function combinedMask(
  args: Node[],
  ctx: FnContext,
  from: number,
  length: number,
): boolean[] | FormulaError {
  const mask = new Array<boolean>(length).fill(true);
  for (let i = from; i + 1 < args.length; i += 2) {
    const range = ctx.collect(args[i]);
    const criterion = ctx.eval(args[i + 1]);
    const one = maskFor(range, criterion);
    if (isError(one)) return one;
    for (let k = 0; k < length; k++) mask[k] = mask[k] && (one[k] ?? false);
  }
  return mask;
}

function sumWhere(sumRange: ScalarValue[], mask: boolean[]): number | FormulaError {
  let sum = 0;
  for (let i = 0; i < sumRange.length; i++) {
    if (!mask[i]) continue;
    const v = sumRange[i];
    if (isError(v)) return v;
    if (typeof v === "number") sum += v;
  }
  return sum;
}

function countWhere(mask: boolean[]): number {
  return mask.reduce((n, m) => n + (m ? 1 : 0), 0);
}

const COUNTIF: Fn = (args, ctx) => {
  if (args.length !== 2) return NA;
  const range = ctx.collect(args[0]);
  const mask = maskFor(range, ctx.eval(args[1]));
  return isError(mask) ? mask : countWhere(mask);
};

const COUNTIFS: Fn = (args, ctx) => {
  if (args.length < 2 || args.length % 2 !== 0) return NA;
  const length = ctx.collect(args[0]).length;
  const mask = combinedMask(args, ctx, 0, length);
  return isError(mask) ? mask : countWhere(mask);
};

const SUMIF: Fn = (args, ctx) => {
  if (args.length < 2 || args.length > 3) return NA;
  const range = ctx.collect(args[0]);
  const mask = maskFor(range, ctx.eval(args[1]));
  if (isError(mask)) return mask;
  const sumRange = args.length === 3 ? ctx.collect(args[2]) : range;
  return sumWhere(sumRange, mask);
};

const SUMIFS: Fn = (args, ctx) => {
  if (args.length < 3 || args.length % 2 !== 1) return NA;
  const sumRange = ctx.collect(args[0]);
  const mask = combinedMask(args, ctx, 1, sumRange.length);
  return isError(mask) ? mask : sumWhere(sumRange, mask);
};

function averageOfMasked(sumRange: ScalarValue[], mask: boolean[]): number | FormulaError {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < sumRange.length; i++) {
    if (!mask[i]) continue;
    const v = sumRange[i];
    if (isError(v)) return v;
    if (typeof v === "number") {
      sum += v;
      count += 1;
    }
  }
  return count === 0 ? DIV0 : sum / count;
}

const AVERAGEIF: Fn = (args, ctx) => {
  if (args.length < 2 || args.length > 3) return NA;
  const range = ctx.collect(args[0]);
  const mask = maskFor(range, ctx.eval(args[1]));
  if (isError(mask)) return mask;
  const avgRange = args.length === 3 ? ctx.collect(args[2]) : range;
  return averageOfMasked(avgRange, mask);
};

const AVERAGEIFS: Fn = (args, ctx) => {
  if (args.length < 3 || args.length % 2 !== 1) return NA;
  const avgRange = ctx.collect(args[0]);
  const mask = combinedMask(args, ctx, 1, avgRange.length);
  return isError(mask) ? mask : averageOfMasked(avgRange, mask);
};

export const STATISTICAL_FUNCTIONS: Record<string, Fn> = {
  AVERAGE,
  COUNT,
  COUNTA,
  MEDIAN,
  MODE,
  VAR,
  STDEV,
  COUNTIF,
  COUNTIFS,
  SUMIF,
  SUMIFS,
  AVERAGEIF,
  AVERAGEIFS,
};
