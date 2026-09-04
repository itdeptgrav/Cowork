/**
 * More statistics — order statistics, ranks and percentiles, the conditional
 * MAX/MIN, the population/sample variance pairs under their modern names,
 * two-variable regression, and the normal distribution.
 *
 * Percentiles interpolate the way PERCENTILE.INC does (Excel's default and
 * Sheets' only form), so a value between two data points is the linear mix
 * of them, not the nearer one. The normal CDF uses a rational approximation
 * good to about 1e-7 — enough that every figure a sheet shows agrees with the
 * originals to the displayed precision.
 */

import { DIV0, NA, NUM, VALUE, isError, type FormulaError } from "../errors";
import { isBlank, toNumber, type ScalarValue } from "../value";
import type { Node } from "../ast";
import type { FnContext } from "../evaluator";
import { aggregateNumbers, argCount, matchesCriteria, type Fn } from "./types";

function num(node: Node, ctx: FnContext): number | FormulaError {
  return toNumber(ctx.eval(node));
}

function mean(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0) / ns.length;
}

function variance(ns: number[], sample: boolean): number | FormulaError {
  const d = sample ? ns.length - 1 : ns.length;
  if (d <= 0) return DIV0;
  const m = mean(ns);
  return ns.reduce((a, b) => a + (b - m) ** 2, 0) / d;
}

/** Every number in the arguments, sorted ascending. */
function sortedNumbers(args: Node[], ctx: FnContext): number[] | FormulaError {
  const ns = aggregateNumbers(args, ctx);
  if (isError(ns)) return ns;
  return [...ns].sort((a, b) => a - b);
}

const LARGE: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const ns = sortedNumbers([args[0]], ctx);
  if (isError(ns)) return ns;
  const k = num(args[1], ctx);
  if (isError(k)) return k;
  const i = Math.trunc(k);
  if (i < 1 || i > ns.length) return NUM;
  return ns[ns.length - i];
};

const SMALL: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const ns = sortedNumbers([args[0]], ctx);
  if (isError(ns)) return ns;
  const k = num(args[1], ctx);
  if (isError(k)) return k;
  const i = Math.trunc(k);
  if (i < 1 || i > ns.length) return NUM;
  return ns[i - 1];
};

/** RANK(value, range, [order]): 0/omitted ranks descending (largest = 1). */
function rank(args: Node[], ctx: FnContext, average: boolean): ScalarValue {
  const bad = argCount(args, 2, 3);
  if (bad) return bad;
  const v = num(args[0], ctx);
  if (isError(v)) return v;
  const ns = aggregateNumbers([args[1]], ctx);
  if (isError(ns)) return ns;
  let ascending = false;
  if (args.length === 3) {
    const o = num(args[2], ctx);
    if (isError(o)) return o;
    ascending = o !== 0;
  }
  if (!ns.includes(v)) return NA;
  const better = ns.filter((n) => (ascending ? n < v : n > v)).length;
  const ties = ns.filter((n) => n === v).length;
  return average ? better + (ties + 1) / 2 : better + 1;
}

const RANK: Fn = (args, ctx) => rank(args, ctx, false);
const RANK_AVG: Fn = (args, ctx) => rank(args, ctx, true);

function percentileInc(sorted: number[], p: number): number | FormulaError {
  if (sorted.length === 0) return NUM;
  if (p < 0 || p > 1) return NUM;
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function percentileExc(sorted: number[], p: number): number | FormulaError {
  const n = sorted.length;
  if (n === 0) return NUM;
  const pos = p * (n + 1);
  if (pos < 1 || pos > n) return NUM;
  const lo = Math.floor(pos);
  const frac = pos - lo;
  const a = sorted[lo - 1];
  const b = sorted[Math.min(lo, n - 1)];
  return a + (b - a) * frac;
}

const PERCENTILE: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const ns = sortedNumbers([args[0]], ctx);
  if (isError(ns)) return ns;
  const p = num(args[1], ctx);
  if (isError(p)) return p;
  return percentileInc(ns, p);
};

const PERCENTILE_EXC: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const ns = sortedNumbers([args[0]], ctx);
  if (isError(ns)) return ns;
  const p = num(args[1], ctx);
  if (isError(p)) return p;
  return percentileExc(ns, p);
};

const QUARTILE: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const ns = sortedNumbers([args[0]], ctx);
  if (isError(ns)) return ns;
  const q = num(args[1], ctx);
  if (isError(q)) return q;
  const k = Math.trunc(q);
  if (k < 0 || k > 4) return NUM;
  return percentileInc(ns, k / 4);
};

const QUARTILE_EXC: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const ns = sortedNumbers([args[0]], ctx);
  if (isError(ns)) return ns;
  const q = num(args[1], ctx);
  if (isError(q)) return q;
  const k = Math.trunc(q);
  if (k < 1 || k > 3) return NUM;
  return percentileExc(ns, k / 4);
};

/** PERCENTRANK(range, x, [significance]): where x sits, 0–1, interpolated. */
const PERCENTRANK: Fn = (args, ctx) => {
  const bad = argCount(args, 2, 3);
  if (bad) return bad;
  const ns = sortedNumbers([args[0]], ctx);
  if (isError(ns)) return ns;
  const x = num(args[1], ctx);
  if (isError(x)) return x;
  let digits = 3;
  if (args.length === 3) {
    const d = num(args[2], ctx);
    if (isError(d)) return d;
    digits = Math.trunc(d);
    if (digits < 1) return NUM;
  }
  const n = ns.length;
  if (n < 2 || x < ns[0] || x > ns[n - 1]) return NA;
  let r: number;
  const exact = ns.indexOf(x);
  if (exact !== -1) r = exact / (n - 1);
  else {
    let i = 0;
    while (ns[i + 1] < x) i++;
    r = (i + (x - ns[i]) / (ns[i + 1] - ns[i])) / (n - 1);
  }
  const f = Math.pow(10, digits);
  return Math.floor(r * f) / f;
};

/** AVERAGEA / MAXA / MINA count text as 0 and booleans as 1/0, unlike the
    plain forms which skip them. */
function allValues(args: Node[], ctx: FnContext): number[] | FormulaError {
  const out: number[] = [];
  for (const a of args) {
    for (const v of ctx.collect(a)) {
      if (isError(v)) return v;
      if (isBlank(v)) continue;
      out.push(typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : 0);
    }
  }
  return out;
}

const AVERAGEA: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  const ns = allValues(args, ctx);
  if (isError(ns)) return ns;
  return ns.length ? mean(ns) : DIV0;
};

const MAXA: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  const ns = allValues(args, ctx);
  if (isError(ns)) return ns;
  return ns.length ? Math.max(...ns) : 0;
};

const MINA: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  const ns = allValues(args, ctx);
  if (isError(ns)) return ns;
  return ns.length ? Math.min(...ns) : 0;
};

const COUNTBLANK: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  let n = 0;
  for (const a of args) for (const v of ctx.collect(a)) if (isBlank(v) || v === "") n++;
  return n;
};

const COUNTUNIQUE: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  const seen = new Set<string>();
  for (const a of args) {
    for (const v of ctx.collect(a)) {
      if (isBlank(v)) continue;
      if (isError(v)) return v;
      seen.add(typeof v === "string" ? `s:${v.toUpperCase()}` : `${typeof v}:${String(v)}`);
    }
  }
  return seen.size;
};

/** MAXIFS/MINIFS(range, criteria_range1, criterion1, …). */
function extremeIfs(args: Node[], ctx: FnContext, pick: (ns: number[]) => number): ScalarValue {
  if (args.length < 3 || args.length % 2 !== 1) return NA;
  const values = ctx.collect(args[0]);
  const mask = new Array<boolean>(values.length).fill(true);
  for (let i = 1; i < args.length; i += 2) {
    const range = ctx.collect(args[i]);
    if (range.length !== values.length) return VALUE;
    const criterion = ctx.eval(args[i + 1]);
    if (isError(criterion)) return criterion;
    for (let k = 0; k < values.length; k++) {
      if (mask[k] && !matchesCriteria(range[k], criterion)) mask[k] = false;
    }
  }
  const ns: number[] = [];
  for (let k = 0; k < values.length; k++) {
    if (!mask[k]) continue;
    const v = values[k];
    if (isError(v)) return v;
    if (typeof v === "number") ns.push(v);
  }
  return ns.length ? pick(ns) : 0;
}

const MAXIFS: Fn = (args, ctx) => extremeIfs(args, ctx, (ns) => Math.max(...ns));
const MINIFS: Fn = (args, ctx) => extremeIfs(args, ctx, (ns) => Math.min(...ns));

const spread =
  (sample: boolean, root: boolean): Fn =>
  (args, ctx) => {
    if (args.length === 0) return VALUE;
    const ns = aggregateNumbers(args, ctx);
    if (isError(ns)) return ns;
    const v = variance(ns, sample);
    if (isError(v)) return v;
    return root ? Math.sqrt(v) : v;
  };

const STDEV_S = spread(true, true);
const STDEV_P = spread(false, true);
const VAR_S = spread(true, false);
const VAR_P = spread(false, false);

const GEOMEAN: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  const ns = aggregateNumbers(args, ctx);
  if (isError(ns)) return ns;
  if (ns.length === 0 || ns.some((n) => n <= 0)) return NUM;
  return Math.exp(ns.reduce((a, b) => a + Math.log(b), 0) / ns.length);
};

const HARMEAN: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  const ns = aggregateNumbers(args, ctx);
  if (isError(ns)) return ns;
  if (ns.length === 0 || ns.some((n) => n <= 0)) return NUM;
  return ns.length / ns.reduce((a, b) => a + 1 / b, 0);
};

const DEVSQ: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  const ns = aggregateNumbers(args, ctx);
  if (isError(ns)) return ns;
  if (ns.length === 0) return 0;
  const m = mean(ns);
  return ns.reduce((a, b) => a + (b - m) ** 2, 0);
};

const AVEDEV: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  const ns = aggregateNumbers(args, ctx);
  if (isError(ns)) return ns;
  if (ns.length === 0) return NUM;
  const m = mean(ns);
  return ns.reduce((a, b) => a + Math.abs(b - m), 0) / ns.length;
};

/** Paired numeric samples: only rows where BOTH are numbers, as the originals. */
function pairs(args: Node[], ctx: FnContext): { x: number[]; y: number[] } | FormulaError {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const a = ctx.collect(args[0]);
  const b = ctx.collect(args[1]);
  if (a.length !== b.length) return NA;
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (isError(a[i])) return a[i] as FormulaError;
    if (isError(b[i])) return b[i] as FormulaError;
    if (typeof a[i] === "number" && typeof b[i] === "number") {
      x.push(a[i] as number);
      y.push(b[i] as number);
    }
  }
  return { x, y };
}

function covariance(x: number[], y: number[], sample: boolean): number | FormulaError {
  const d = sample ? x.length - 1 : x.length;
  if (d <= 0) return DIV0;
  const mx = mean(x);
  const my = mean(y);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] - mx) * (y[i] - my);
  return s / d;
}

function correlation(x: number[], y: number[]): number | FormulaError {
  if (x.length < 2) return DIV0;
  const cov = covariance(x, y, false);
  const vx = variance(x, false);
  const vy = variance(y, false);
  if (isError(cov) || isError(vx) || isError(vy)) return DIV0;
  if (vx === 0 || vy === 0) return DIV0;
  return cov / Math.sqrt(vx * vy);
}

/** CORREL/PEARSON(y_range, x_range) — order is symmetric here. */
const CORREL: Fn = (args, ctx) => {
  const p = pairs(args, ctx);
  if (isError(p)) return p;
  return correlation(p.x, p.y);
};

const COVARIANCE_P: Fn = (args, ctx) => {
  const p = pairs(args, ctx);
  if (isError(p)) return p;
  return covariance(p.x, p.y, false);
};

const COVARIANCE_S: Fn = (args, ctx) => {
  const p = pairs(args, ctx);
  if (isError(p)) return p;
  return covariance(p.x, p.y, true);
};

/** SLOPE/INTERCEPT/RSQ(known_y, known_x) — the least-squares line. */
function line(args: Node[], ctx: FnContext): { m: number; b: number; r2: number } | FormulaError {
  const p = pairs(args, ctx);
  if (isError(p)) return p;
  const ys = p.x;
  const xs = p.y;
  if (xs.length < 2) return DIV0;
  const vx = variance(xs, false);
  if (isError(vx)) return vx;
  if (vx === 0) return DIV0;
  const cov = covariance(xs, ys, false);
  if (isError(cov)) return cov;
  const m = cov / vx;
  const b = mean(ys) - m * mean(xs);
  const r = correlation(xs, ys);
  return { m, b, r2: isError(r) ? 0 : r * r };
}

const SLOPE: Fn = (args, ctx) => {
  const l = line(args, ctx);
  return isError(l) ? l : l.m;
};

const INTERCEPT: Fn = (args, ctx) => {
  const l = line(args, ctx);
  return isError(l) ? l : l.b;
};

const RSQ: Fn = (args, ctx) => {
  const l = line(args, ctx);
  return isError(l) ? l : l.r2;
};

/** FORECAST(x, known_y, known_x): the line's value at x. */
const FORECAST: Fn = (args, ctx) => {
  const bad = argCount(args, 3);
  if (bad) return bad;
  const x = num(args[0], ctx);
  if (isError(x)) return x;
  const l = line(args.slice(1), ctx);
  if (isError(l)) return l;
  return l.b + l.m * x;
};

/* ── The normal distribution ───────────────────────────────────────────── */

/** erf, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return sign * y;
}

export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/** Inverse normal CDF — Acklam's rational approximation with one Newton step. */
export function normalInv(p: number): number | FormulaError {
  if (p <= 0 || p >= 1) return NUM;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  let x: number;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - plow) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/** NORM.DIST(x, mean, sd, cumulative). */
const NORM_DIST: Fn = (args, ctx) => {
  const bad = argCount(args, 4);
  if (bad) return bad;
  const x = num(args[0], ctx);
  if (isError(x)) return x;
  const m = num(args[1], ctx);
  if (isError(m)) return m;
  const sd = num(args[2], ctx);
  if (isError(sd)) return sd;
  const cum = num(args[3], ctx);
  if (isError(cum)) return cum;
  if (sd <= 0) return NUM;
  const z = (x - m) / sd;
  return cum !== 0 ? normalCdf(z) : normalPdf(z) / sd;
};

const NORM_S_DIST: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 2);
  if (bad) return bad;
  const z = num(args[0], ctx);
  if (isError(z)) return z;
  let cum = 1;
  if (args.length === 2) {
    const c = num(args[1], ctx);
    if (isError(c)) return c;
    cum = c;
  }
  return cum !== 0 ? normalCdf(z) : normalPdf(z);
};

const NORM_INV: Fn = (args, ctx) => {
  const bad = argCount(args, 3);
  if (bad) return bad;
  const p = num(args[0], ctx);
  if (isError(p)) return p;
  const m = num(args[1], ctx);
  if (isError(m)) return m;
  const sd = num(args[2], ctx);
  if (isError(sd)) return sd;
  if (sd <= 0) return NUM;
  const z = normalInv(p);
  return isError(z) ? z : m + z * sd;
};

const NORM_S_INV: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const p = num(args[0], ctx);
  if (isError(p)) return p;
  return normalInv(p);
};

const STANDARDIZE: Fn = (args, ctx) => {
  const bad = argCount(args, 3);
  if (bad) return bad;
  const x = num(args[0], ctx);
  if (isError(x)) return x;
  const m = num(args[1], ctx);
  if (isError(m)) return m;
  const sd = num(args[2], ctx);
  if (isError(sd)) return sd;
  if (sd <= 0) return NUM;
  return (x - m) / sd;
};

/** CONFIDENCE.NORM(alpha, sd, size): half the width of the interval. */
const CONFIDENCE_NORM: Fn = (args, ctx) => {
  const bad = argCount(args, 3);
  if (bad) return bad;
  const alpha = num(args[0], ctx);
  if (isError(alpha)) return alpha;
  const sd = num(args[1], ctx);
  if (isError(sd)) return sd;
  const n = num(args[2], ctx);
  if (isError(n)) return n;
  if (alpha <= 0 || alpha >= 1 || sd <= 0 || n < 1) return NUM;
  const z = normalInv(1 - alpha / 2);
  return isError(z) ? z : (z * sd) / Math.sqrt(Math.trunc(n));
};

const SKEW: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  const ns = aggregateNumbers(args, ctx);
  if (isError(ns)) return ns;
  const n = ns.length;
  if (n < 3) return DIV0;
  const m = mean(ns);
  const sd = Math.sqrt(variance(ns, true) as number);
  if (sd === 0) return DIV0;
  return (n / ((n - 1) * (n - 2))) * ns.reduce((a, b) => a + ((b - m) / sd) ** 3, 0);
};

const KURT: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  const ns = aggregateNumbers(args, ctx);
  if (isError(ns)) return ns;
  const n = ns.length;
  if (n < 4) return DIV0;
  const m = mean(ns);
  const sd = Math.sqrt(variance(ns, true) as number);
  if (sd === 0) return DIV0;
  const s4 = ns.reduce((a, b) => a + ((b - m) / sd) ** 4, 0);
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * s4 - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
};

/** TRIMMEAN(range, fraction): the mean after dropping that fraction of the
    data, half from each end. */
const TRIMMEAN: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const ns = sortedNumbers([args[0]], ctx);
  if (isError(ns)) return ns;
  const f = num(args[1], ctx);
  if (isError(f)) return f;
  if (f < 0 || f >= 1) return NUM;
  if (ns.length === 0) return NUM;
  const drop = Math.floor((ns.length * f) / 2);
  const kept = ns.slice(drop, ns.length - drop);
  return mean(kept);
};

/** BINOM.DIST(successes, trials, p, cumulative). */
const BINOM_DIST: Fn = (args, ctx) => {
  const bad = argCount(args, 4);
  if (bad) return bad;
  const k0 = num(args[0], ctx);
  if (isError(k0)) return k0;
  const n0 = num(args[1], ctx);
  if (isError(n0)) return n0;
  const p = num(args[2], ctx);
  if (isError(p)) return p;
  const cum = num(args[3], ctx);
  if (isError(cum)) return cum;
  const k = Math.trunc(k0);
  const n = Math.trunc(n0);
  if (k < 0 || k > n || p < 0 || p > 1) return NUM;
  const pmf = (i: number) => {
    let c = 1;
    for (let j = 1; j <= i; j++) c = (c * (n - i + j)) / j;
    return c * Math.pow(p, i) * Math.pow(1 - p, n - i);
  };
  if (cum === 0) return pmf(k);
  let total = 0;
  for (let i = 0; i <= k; i++) total += pmf(i);
  return total;
};

/** POISSON.DIST(x, mean, cumulative). */
const POISSON_DIST: Fn = (args, ctx) => {
  const bad = argCount(args, 3);
  if (bad) return bad;
  const x0 = num(args[0], ctx);
  if (isError(x0)) return x0;
  const m = num(args[1], ctx);
  if (isError(m)) return m;
  const cum = num(args[2], ctx);
  if (isError(cum)) return cum;
  const x = Math.trunc(x0);
  if (x < 0 || m < 0) return NUM;
  const pmf = (i: number) => {
    let f = 1;
    for (let j = 2; j <= i; j++) f *= j;
    return (Math.exp(-m) * Math.pow(m, i)) / f;
  };
  if (cum === 0) return pmf(x);
  let total = 0;
  for (let i = 0; i <= x; i++) total += pmf(i);
  return total;
};

export const STATISTICAL_EXTRA_FUNCTIONS: Record<string, Fn> = {
  LARGE, SMALL, RANK, "RANK.EQ": RANK, "RANK.AVG": RANK_AVG,
  PERCENTILE, "PERCENTILE.INC": PERCENTILE, "PERCENTILE.EXC": PERCENTILE_EXC,
  QUARTILE, "QUARTILE.INC": QUARTILE, "QUARTILE.EXC": QUARTILE_EXC, PERCENTRANK, "PERCENTRANK.INC": PERCENTRANK,
  AVERAGEA, MAXA, MINA, COUNTBLANK, COUNTUNIQUE, MAXIFS, MINIFS,
  "STDEV.S": STDEV_S, "STDEV.P": STDEV_P, STDEVP: STDEV_P, "VAR.S": VAR_S, "VAR.P": VAR_P, VARP: VAR_P,
  GEOMEAN, HARMEAN, DEVSQ, AVEDEV, CORREL, PEARSON: CORREL, COVAR: COVARIANCE_P,
  "COVARIANCE.P": COVARIANCE_P, "COVARIANCE.S": COVARIANCE_S, SLOPE, INTERCEPT, RSQ, FORECAST, "FORECAST.LINEAR": FORECAST,
  "NORM.DIST": NORM_DIST, NORMDIST: NORM_DIST, "NORM.S.DIST": NORM_S_DIST, NORMSDIST: NORM_S_DIST,
  "NORM.INV": NORM_INV, NORMINV: NORM_INV, "NORM.S.INV": NORM_S_INV, NORMSINV: NORM_S_INV,
  STANDARDIZE, "CONFIDENCE.NORM": CONFIDENCE_NORM, CONFIDENCE: CONFIDENCE_NORM, SKEW, KURT, TRIMMEAN,
  "BINOM.DIST": BINOM_DIST, BINOMDIST: BINOM_DIST, "POISSON.DIST": POISSON_DIST, POISSON: POISSON_DIST,
};
