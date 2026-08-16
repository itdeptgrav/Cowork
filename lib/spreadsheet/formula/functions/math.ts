/**
 * Math functions — the arithmetic library.
 *
 * SUM/MIN/MAX are here (they are "math" in the spreadsheet's own grouping);
 * AVERAGE, COUNT and the conditional aggregates live under `statistical`. RAND
 * and RANDBETWEEN are non-deterministic and are only recomputed when a
 * dependency changes, not continuously — the standard volatile-function caveat.
 */

import { DIV0, NUM, isError } from "../errors";
import { toNumber } from "../value";
import { aggregateNumbers, argCount, oneNumber, type Fn } from "./types";

const ABS: Fn = (args, ctx) => {
  const n = oneNumber(args, ctx);
  return isError(n) ? n : Math.abs(n);
};

function rounded(args: Parameters<Fn>[0], ctx: Parameters<Fn>[1], mode: "half" | "up" | "down") {
  const bad = argCount(args, 1, 2);
  if (bad) return bad;
  const x = toNumber(ctx.eval(args[0]));
  if (isError(x)) return x;
  const digits = args.length === 2 ? toNumber(ctx.eval(args[1])) : 0;
  if (isError(digits)) return digits;
  const factor = Math.pow(10, Math.trunc(digits));
  const scaled = Math.abs(x) * factor;
  const op = mode === "half" ? Math.round : mode === "up" ? Math.ceil : Math.floor;
  return (Math.sign(x) * op(scaled)) / factor;
}

const ROUND: Fn = (args, ctx) => rounded(args, ctx, "half");
const ROUNDUP: Fn = (args, ctx) => rounded(args, ctx, "up");
const ROUNDDOWN: Fn = (args, ctx) => rounded(args, ctx, "down");

const MOD: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const a = toNumber(ctx.eval(args[0]));
  if (isError(a)) return a;
  const b = toNumber(ctx.eval(args[1]));
  if (isError(b)) return b;
  if (b === 0) return DIV0;
  /* Result takes the sign of the divisor, as the spreadsheet MOD does. */
  return a - b * Math.floor(a / b);
};

const POWER: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const a = toNumber(ctx.eval(args[0]));
  if (isError(a)) return a;
  const b = toNumber(ctx.eval(args[1]));
  if (isError(b)) return b;
  const r = Math.pow(a, b);
  return Number.isFinite(r) ? r : NUM;
};

/** Round away from zero to a multiple of `significance` (default 1). */
const CEILING: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 2);
  if (bad) return bad;
  const x = toNumber(ctx.eval(args[0]));
  if (isError(x)) return x;
  const sig = args.length === 2 ? toNumber(ctx.eval(args[1])) : 1;
  if (isError(sig)) return sig;
  if (sig === 0) return 0;
  return Math.ceil(x / sig) * sig;
};

/** Round toward zero to a multiple of `significance` (default 1). */
const FLOOR: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 2);
  if (bad) return bad;
  const x = toNumber(ctx.eval(args[0]));
  if (isError(x)) return x;
  const sig = args.length === 2 ? toNumber(ctx.eval(args[1])) : 1;
  if (isError(sig)) return sig;
  if (sig === 0) return DIV0;
  return Math.floor(x / sig) * sig;
};

/** The integer part, rounding DOWN (toward −∞): INT(-2.5) = -3. */
const INT: Fn = (args, ctx) => {
  const n = oneNumber(args, ctx);
  return isError(n) ? n : Math.floor(n);
};

/** Truncate toward zero to `digits` decimals (default 0): TRUNC(-2.7) = -2. */
const TRUNC: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 2);
  if (bad) return bad;
  const x = toNumber(ctx.eval(args[0]));
  if (isError(x)) return x;
  const digits = args.length === 2 ? toNumber(ctx.eval(args[1])) : 0;
  if (isError(digits)) return digits;
  const factor = Math.pow(10, Math.trunc(digits));
  return Math.trunc(x * factor) / factor;
};

const RAND: Fn = (args) => {
  const bad = argCount(args, 0);
  if (bad) return bad;
  return Math.random();
};

/** An integer in [min, max] inclusive. */
const RANDBETWEEN: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const lo = toNumber(ctx.eval(args[0]));
  if (isError(lo)) return lo;
  const hi = toNumber(ctx.eval(args[1]));
  if (isError(hi)) return hi;
  const a = Math.ceil(lo);
  const b = Math.floor(hi);
  if (b < a) return NUM;
  return a + Math.floor(Math.random() * (b - a + 1));
};

const SUM: Fn = (args, ctx) => {
  const nums = aggregateNumbers(args, ctx);
  if (isError(nums)) return nums;
  return nums.reduce((a, b) => a + b, 0);
};

const MIN: Fn = (args, ctx) => {
  const nums = aggregateNumbers(args, ctx);
  if (isError(nums)) return nums;
  return nums.length === 0 ? 0 : Math.min(...nums);
};

const MAX: Fn = (args, ctx) => {
  const nums = aggregateNumbers(args, ctx);
  if (isError(nums)) return nums;
  return nums.length === 0 ? 0 : Math.max(...nums);
};

export const MATH_FUNCTIONS: Record<string, Fn> = {
  ABS,
  ROUND,
  ROUNDUP,
  ROUNDDOWN,
  MOD,
  POWER,
  CEILING,
  FLOOR,
  INT,
  TRUNC,
  RAND,
  RANDBETWEEN,
  SUM,
  MIN,
  MAX,
};
