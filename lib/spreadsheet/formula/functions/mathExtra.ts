/**
 * More math — the trigonometry, number theory, rounding and product family a
 * spreadsheet is expected to have beyond the arithmetic core in `math.ts`.
 *
 * Every function here follows the Sheets/Excel contract for its edge cases
 * (a negative SQRT is #NUM!, a zero QUOTIENT divisor is #DIV/0!, FACT of a
 * fraction truncates first), because a formula copied in from another
 * spreadsheet must give the same answer here.
 */

import { DIV0, NUM, VALUE, isError, type FormulaError } from "../errors";
import { isArray, isBlank, toNumber } from "../value";
import type { Node } from "../ast";
import type { FnContext } from "../evaluator";
import { aggregateNumbers, argCount, oneNumber, type Fn } from "./types";

/** The positional arguments as numbers, or the first error met. */
export function numbers(args: Node[], ctx: FnContext, min: number, max = min): number[] | FormulaError {
  const bad = argCount(args, min, max);
  if (bad) return bad;
  const out: number[] = [];
  for (const a of args) {
    const n = toNumber(ctx.eval(a));
    if (isError(n)) return n;
    out.push(n);
  }
  return out;
}

export function finite(n: number): number | FormulaError {
  return Number.isFinite(n) ? n : NUM;
}

const unary =
  (f: (x: number) => number, domain?: (x: number) => boolean): Fn =>
  (args, ctx) => {
    const n = oneNumber(args, ctx);
    if (isError(n)) return n;
    if (domain && !domain(n)) return NUM;
    return finite(f(n));
  };

const SQRT: Fn = unary(Math.sqrt, (x) => x >= 0);
const EXP: Fn = unary(Math.exp);
const LN: Fn = unary(Math.log, (x) => x > 0);
const LOG10: Fn = unary(Math.log10, (x) => x > 0);
const SIN: Fn = unary(Math.sin);
const COS: Fn = unary(Math.cos);
const TAN: Fn = unary(Math.tan);
const ASIN: Fn = unary(Math.asin, (x) => x >= -1 && x <= 1);
const ACOS: Fn = unary(Math.acos, (x) => x >= -1 && x <= 1);
const ATAN: Fn = unary(Math.atan);
const SINH: Fn = unary(Math.sinh);
const COSH: Fn = unary(Math.cosh);
const TANH: Fn = unary(Math.tanh);
const DEGREES: Fn = unary((x) => (x * 180) / Math.PI);
const RADIANS: Fn = unary((x) => (x * Math.PI) / 180);
const SIGN: Fn = unary((x) => Math.sign(x));
const SQRTPI: Fn = unary((x) => Math.sqrt(x * Math.PI), (x) => x >= 0);
/** EVEN/ODD round AWAY from zero to the next even/odd integer. */
const EVEN: Fn = unary((x) => {
  const n = Math.ceil(Math.abs(x));
  const e = n % 2 === 0 ? n : n + 1;
  return x < 0 ? -e : e;
});
const ODD: Fn = unary((x) => {
  const n = Math.ceil(Math.abs(x));
  const o = n % 2 === 1 ? n : n + 1;
  return x < 0 ? -o : o;
});

const LOG: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 1, 2);
  if (isError(ns)) return ns;
  const [x, base = 10] = ns;
  if (x <= 0 || base <= 0 || base === 1) return NUM;
  return finite(Math.log(x) / Math.log(base));
};

const PI: Fn = (args) => {
  const bad = argCount(args, 0);
  return bad ?? Math.PI;
};

const ATAN2: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 2);
  if (isError(ns)) return ns;
  const [x, y] = ns;
  if (x === 0 && y === 0) return DIV0;
  /* Spreadsheet order is ATAN2(x, y); JavaScript's is atan2(y, x). */
  return Math.atan2(y, x);
};

const PRODUCT: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  const ns = aggregateNumbers(args, ctx);
  if (isError(ns)) return ns;
  if (ns.length === 0) return 0;
  return finite(ns.reduce((a, b) => a * b, 1));
};

const SUMSQ: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  const ns = aggregateNumbers(args, ctx);
  if (isError(ns)) return ns;
  return finite(ns.reduce((a, b) => a + b * b, 0));
};

/** SUMPRODUCT(range1, range2, …): the sum of the element-wise products. Every
    argument must have the same shape; text and blanks count as 0. */
const SUMPRODUCT: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  const grids = args.map((a) => ctx.matrix(a));
  const rows = grids[0].length;
  const cols = grids[0][0]?.length ?? 0;
  for (const g of grids) {
    if (g.length !== rows || (g[0]?.length ?? 0) !== cols) return VALUE;
  }
  let sum = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let p = 1;
      for (const g of grids) {
        const v = g[r][c];
        if (isError(v)) return v;
        p *= typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : 0;
      }
      sum += p;
    }
  }
  return finite(sum);
};

const QUOTIENT: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 2);
  if (isError(ns)) return ns;
  if (ns[1] === 0) return DIV0;
  return Math.trunc(ns[0] / ns[1]);
};

function gcd2(a: number, b: number): number {
  a = Math.abs(Math.trunc(a));
  b = Math.abs(Math.trunc(b));
  while (b) [a, b] = [b, a % b];
  return a;
}

const GCD: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  const ns = aggregateNumbers(args, ctx);
  if (isError(ns)) return ns;
  if (ns.some((n) => n < 0)) return NUM;
  return ns.reduce((a, b) => gcd2(a, b), 0);
};

const LCM: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  const ns = aggregateNumbers(args, ctx);
  if (isError(ns)) return ns;
  if (ns.some((n) => n < 0)) return NUM;
  return finite(
    ns.reduce((a, b) => {
      const x = Math.trunc(a);
      const y = Math.trunc(b);
      if (x === 0 || y === 0) return 0;
      return (x * y) / gcd2(x, y);
    }, 1),
  );
};

/** MROUND rounds to the nearest multiple; value and multiple must share a sign. */
const MROUND: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 2);
  if (isError(ns)) return ns;
  const [x, m] = ns;
  if (m === 0) return 0;
  if ((x > 0 && m < 0) || (x < 0 && m > 0)) return NUM;
  return Math.round(x / m) * m;
};

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

const FACT: Fn = (args, ctx) => {
  const n = oneNumber(args, ctx);
  if (isError(n)) return n;
  if (n < 0) return NUM;
  return finite(factorial(Math.trunc(n)));
};

const FACTDOUBLE: Fn = (args, ctx) => {
  const n = oneNumber(args, ctx);
  if (isError(n)) return n;
  if (n < -1) return NUM;
  let f = 1;
  for (let i = Math.trunc(n); i > 1; i -= 2) f *= i;
  return finite(f);
};

const COMBIN: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 2);
  if (isError(ns)) return ns;
  const n = Math.trunc(ns[0]);
  const k = Math.trunc(ns[1]);
  if (n < 0 || k < 0 || k > n) return NUM;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return finite(Math.round(r));
};

const PERMUT: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 2);
  if (isError(ns)) return ns;
  const n = Math.trunc(ns[0]);
  const k = Math.trunc(ns[1]);
  if (n < 0 || k < 0 || k > n) return NUM;
  let r = 1;
  for (let i = 0; i < k; i++) r *= n - i;
  return finite(r);
};

/** CEILING.MATH / FLOOR.MATH: the modern forms, which accept any sign and take
    an optional `mode` that, when non-zero, rounds negatives away from zero. */
const CEILING_MATH: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 1, 3);
  if (isError(ns)) return ns;
  const [x, sigIn = 1, mode = 0] = ns;
  const sig = Math.abs(sigIn);
  if (sig === 0) return 0;
  if (x < 0 && mode !== 0) return -Math.ceil(Math.abs(x) / sig) * sig;
  return Math.ceil(x / sig) * sig;
};

const FLOOR_MATH: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 1, 3);
  if (isError(ns)) return ns;
  const [x, sigIn = 1, mode = 0] = ns;
  const sig = Math.abs(sigIn);
  if (sig === 0) return 0;
  if (x < 0 && mode !== 0) return -Math.floor(Math.abs(x) / sig) * sig;
  return Math.floor(x / sig) * sig;
};

const ROMAN_TABLE: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

const ROMAN: Fn = (args, ctx) => {
  const n = oneNumber(args, ctx);
  if (isError(n)) return n;
  let v = Math.trunc(n);
  if (v < 0 || v > 3999) return VALUE;
  let out = "";
  for (const [num, sym] of ROMAN_TABLE) {
    while (v >= num) {
      out += sym;
      v -= num;
    }
  }
  return out;
};

const ROMAN_VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

const ARABIC: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const v = ctx.eval(args[0]);
  if (isError(v)) return v;
  const text = String(isBlank(v) ? "" : isArray(v) ? v.first : v).trim().toUpperCase();
  if (text === "") return 0;
  const neg = text.startsWith("-");
  const body = neg ? text.slice(1) : text;
  if (!/^[IVXLCDM]+$/.test(body)) return VALUE;
  let total = 0;
  for (let i = 0; i < body.length; i++) {
    const cur = ROMAN_VALUES[body[i]];
    const next = ROMAN_VALUES[body[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return neg ? -total : total;
};

/**
 * SUBTOTAL(code, range, …): one of the aggregates by number — 1 AVERAGE,
 * 2 COUNT, 3 COUNTA, 4 MAX, 5 MIN, 6 PRODUCT, 7 STDEV, 8 STDEVP, 9 SUM,
 * 10 VAR, 11 VARP. The 101–111 forms (ignore hidden rows) act the same here.
 */
const SUBTOTAL: Fn = (args, ctx) => {
  if (args.length < 2) return VALUE;
  const codeV = toNumber(ctx.eval(args[0]));
  if (isError(codeV)) return codeV;
  const code = Math.trunc(codeV) % 100;
  const rest = args.slice(1);
  if (code === 3) {
    let n = 0;
    for (const a of rest) for (const v of ctx.collect(a)) if (!isBlank(v)) n++;
    return n;
  }
  const ns = aggregateNumbers(rest, ctx);
  if (isError(ns)) return ns;
  const mean = ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;
  const variance = (sample: boolean): number | FormulaError => {
    const d = sample ? ns.length - 1 : ns.length;
    if (d <= 0) return DIV0;
    return ns.reduce((a, b) => a + (b - mean) ** 2, 0) / d;
  };
  switch (code) {
    case 1:
      return ns.length ? mean : DIV0;
    case 2:
      return ns.length;
    case 4:
      return ns.length ? Math.max(...ns) : 0;
    case 5:
      return ns.length ? Math.min(...ns) : 0;
    case 6:
      return finite(ns.reduce((a, b) => a * b, 1));
    case 7: {
      const v = variance(true);
      return isError(v) ? v : Math.sqrt(v);
    }
    case 8: {
      const v = variance(false);
      return isError(v) ? v : Math.sqrt(v);
    }
    case 9:
      return finite(ns.reduce((a, b) => a + b, 0));
    case 10:
      return variance(true);
    case 11:
      return variance(false);
    default:
      return VALUE;
  }
};

/** BASE(number, radix, [min_length]) / DECIMAL(text, radix). */
const BASE: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 2, 3);
  if (isError(ns)) return ns;
  const [n, radix, minLen = 0] = ns;
  if (n < 0 || radix < 2 || radix > 36) return NUM;
  return Math.trunc(n).toString(Math.trunc(radix)).toUpperCase().padStart(Math.trunc(minLen), "0");
};

const DECIMAL: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const t = ctx.eval(args[0]);
  if (isError(t)) return t;
  const radix = toNumber(ctx.eval(args[1]));
  if (isError(radix)) return radix;
  if (radix < 2 || radix > 36) return NUM;
  const text = String(isBlank(t) ? "0" : isArray(t) ? t.first : t).trim();
  const n = parseInt(text, Math.trunc(radix));
  if (Number.isNaN(n)) return NUM;
  return n;
};

export const MATH_EXTRA_FUNCTIONS: Record<string, Fn> = {
  SQRT, EXP, LN, LOG, LOG10, PI, SIGN, SIN, COS, TAN, ASIN, ACOS, ATAN, ATAN2, SINH, COSH, TANH,
  DEGREES, RADIANS, SQRTPI, EVEN, ODD, PRODUCT, SUMSQ, SUMPRODUCT, QUOTIENT, GCD, LCM, MROUND,
  FACT, FACTDOUBLE, COMBIN, PERMUT, "CEILING.MATH": CEILING_MATH, "FLOOR.MATH": FLOOR_MATH,
  ROMAN, ARABIC, SUBTOTAL, BASE, DECIMAL,
};
