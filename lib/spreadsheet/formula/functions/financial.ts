/**
 * Financial functions — the time-value-of-money family every spreadsheet has.
 *
 * Sign convention is the spreadsheet's: money paid OUT is negative, money
 * received is positive, so `=PMT(5%/12, 60, 20000)` is a negative payment.
 * Rates are per period; the caller divides an annual rate by 12 for monthly
 * payments, exactly as in Sheets and Excel. RATE and IRR are solved
 * numerically (Newton's method with a bisection fallback) and give up with
 * #NUM! when no rate converges, which is what the originals do.
 */

import { DIV0, NUM, VALUE, isError, type FormulaError } from "../errors";
import { isBlank, toNumber } from "../value";
import type { Node } from "../ast";
import type { FnContext } from "../evaluator";
import { aggregateNumbers, argCount, type Fn } from "./types";
import { finite, numbers } from "./mathExtra";

/** Positional numeric arguments where missing trailing ones default to 0. */
function padded(args: Node[], ctx: FnContext, min: number, max: number): number[] | FormulaError {
  const bad = argCount(args, min, max);
  if (bad) return bad;
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    if (i >= args.length) {
      out.push(0);
      continue;
    }
    const v = ctx.eval(args[i]);
    if (isBlank(v)) {
      out.push(0);
      continue;
    }
    const n = toNumber(v);
    if (isError(n)) return n;
    out.push(n);
  }
  return out;
}

/** The payment for a loan/annuity: the closed form the others build on. */
function pmt(rate: number, nper: number, pv: number, fv: number, type: number): number {
  if (nper === 0) return NaN;
  if (rate === 0) return -(pv + fv) / nper;
  const f = Math.pow(1 + rate, nper);
  return -(rate * (pv * f + fv)) / ((1 + rate * (type ? 1 : 0)) * (f - 1));
}

const PMT: Fn = (args, ctx) => {
  const ns = padded(args, ctx, 3, 5);
  if (isError(ns)) return ns;
  const [rate, nper, pv, fv, type] = ns;
  if (nper === 0) return DIV0;
  return finite(pmt(rate, nper, pv, fv, type));
};

const FV: Fn = (args, ctx) => {
  const ns = padded(args, ctx, 3, 5);
  if (isError(ns)) return ns;
  const [rate, nper, pmtV, pv, type] = ns;
  if (rate === 0) return finite(-(pv + pmtV * nper));
  const f = Math.pow(1 + rate, nper);
  return finite(-(pv * f + (pmtV * (1 + rate * (type ? 1 : 0)) * (f - 1)) / rate));
};

const PV: Fn = (args, ctx) => {
  const ns = padded(args, ctx, 3, 5);
  if (isError(ns)) return ns;
  const [rate, nper, pmtV, fv, type] = ns;
  if (rate === 0) return finite(-(fv + pmtV * nper));
  const f = Math.pow(1 + rate, nper);
  return finite(-(fv + (pmtV * (1 + rate * (type ? 1 : 0)) * (f - 1)) / rate) / f);
};

const NPER: Fn = (args, ctx) => {
  const ns = padded(args, ctx, 3, 5);
  if (isError(ns)) return ns;
  const [rate, pmtV, pv, fv, type] = ns;
  if (rate === 0) {
    if (pmtV === 0) return DIV0;
    return finite(-(pv + fv) / pmtV);
  }
  const t = pmtV * (1 + rate * (type ? 1 : 0));
  const num = t - fv * rate;
  const den = pv * rate + t;
  if (num / den <= 0) return NUM;
  return finite(Math.log(num / den) / Math.log(1 + rate));
};

/** RATE(nper, pmt, pv, [fv], [type], [guess]) — solved numerically. */
const RATE: Fn = (args, ctx) => {
  const ns = padded(args, ctx, 3, 6);
  if (isError(ns)) return ns;
  const [nper, pmtV, pv, fv, type] = ns;
  const guess = args.length >= 6 && ns[5] !== 0 ? ns[5] : 0.1;
  const f = (r: number): number => {
    if (r === 0) return pv + pmtV * nper + fv;
    const g = Math.pow(1 + r, nper);
    return pv * g + (pmtV * (1 + r * (type ? 1 : 0)) * (g - 1)) / r + fv;
  };
  let r = guess;
  for (let i = 0; i < 100; i++) {
    const y = f(r);
    const dy = (f(r + 1e-6) - y) / 1e-6;
    if (dy === 0) break;
    const next = r - y / dy;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - r) < 1e-10) return finite(next);
    r = next;
  }
  /* Bisection between -0.99 and 10 as the fallback. */
  let lo = -0.99;
  let hi = 10;
  let flo = f(lo);
  if (Math.sign(flo) === Math.sign(f(hi))) return NUM;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 1e-10) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return finite((lo + hi) / 2);
};

/** Interest and principal portions of a given period's payment. */
function ipmt(rate: number, per: number, nper: number, pv: number, fv: number, type: number): number {
  const p = pmt(rate, nper, pv, fv, type);
  let balance = pv;
  let interest = 0;
  for (let k = 1; k <= per; k++) {
    interest = type && k === 1 ? 0 : -balance * rate;
    const principal = p - interest;
    balance += principal;
    if (type && k === 1) balance = pv + p;
  }
  return interest;
}

const IPMT: Fn = (args, ctx) => {
  const ns = padded(args, ctx, 4, 6);
  if (isError(ns)) return ns;
  const [rate, per, nper, pv, fv, type] = ns;
  if (per < 1 || per > nper || nper === 0) return NUM;
  return finite(ipmt(rate, Math.trunc(per), nper, pv, fv, type));
};

const PPMT: Fn = (args, ctx) => {
  const ns = padded(args, ctx, 4, 6);
  if (isError(ns)) return ns;
  const [rate, per, nper, pv, fv, type] = ns;
  if (per < 1 || per > nper || nper === 0) return NUM;
  return finite(pmt(rate, nper, pv, fv, type) - ipmt(rate, Math.trunc(per), nper, pv, fv, type));
};

const CUMIPMT: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 6);
  if (isError(ns)) return ns;
  const [rate, nper, pv, start, end, type] = ns;
  if (rate <= 0 || nper <= 0 || pv <= 0 || start < 1 || end < start || end > nper) return NUM;
  let total = 0;
  for (let k = Math.trunc(start); k <= Math.trunc(end); k++) total += ipmt(rate, k, nper, pv, 0, type);
  return finite(total);
};

const CUMPRINC: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 6);
  if (isError(ns)) return ns;
  const [rate, nper, pv, start, end, type] = ns;
  if (rate <= 0 || nper <= 0 || pv <= 0 || start < 1 || end < start || end > nper) return NUM;
  const p = pmt(rate, nper, pv, 0, type);
  let total = 0;
  for (let k = Math.trunc(start); k <= Math.trunc(end); k++) total += p - ipmt(rate, k, nper, pv, 0, type);
  return finite(total);
};

/** NPV(rate, value1, …): cash flows at the END of each period. */
const NPV: Fn = (args, ctx) => {
  if (args.length < 2) return VALUE;
  const rate = toNumber(ctx.eval(args[0]));
  if (isError(rate)) return rate;
  const flows = aggregateNumbers(args.slice(1), ctx);
  if (isError(flows)) return flows;
  if (rate <= -1) return NUM;
  let total = 0;
  flows.forEach((cf, i) => {
    total += cf / Math.pow(1 + rate, i + 1);
  });
  return finite(total);
};

function irrOf(flows: number[], guess: number): number | null {
  const npv = (r: number) => flows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + r, i), 0);
  let r = guess;
  for (let i = 0; i < 100; i++) {
    const y = npv(r);
    const dy = (npv(r + 1e-7) - y) / 1e-7;
    if (dy === 0) break;
    const next = r - y / dy;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }
  let lo = -0.9999;
  let hi = 100;
  let flo = npv(lo);
  if (Math.sign(flo) === Math.sign(npv(hi))) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-9) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

const IRR: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 2);
  if (bad) return bad;
  const flows = aggregateNumbers([args[0]], ctx);
  if (isError(flows)) return flows;
  if (!flows.some((f) => f > 0) || !flows.some((f) => f < 0)) return NUM;
  let guess = 0.1;
  if (args.length === 2) {
    const g = toNumber(ctx.eval(args[1]));
    if (isError(g)) return g;
    guess = g;
  }
  const r = irrOf(flows, guess);
  return r === null ? NUM : finite(r);
};

/** MIRR(values, finance_rate, reinvest_rate). */
const MIRR: Fn = (args, ctx) => {
  const bad = argCount(args, 3);
  if (bad) return bad;
  const flows = aggregateNumbers([args[0]], ctx);
  if (isError(flows)) return flows;
  const fr = toNumber(ctx.eval(args[1]));
  if (isError(fr)) return fr;
  const rr = toNumber(ctx.eval(args[2]));
  if (isError(rr)) return rr;
  const n = flows.length;
  if (!flows.some((f) => f > 0) || !flows.some((f) => f < 0)) return DIV0;
  /* NPV in the spreadsheet sense: the first flow is already one period out. */
  const npvPos = flows.reduce((acc, cf, i) => (cf > 0 ? acc + cf / Math.pow(1 + rr, i + 1) : acc), 0);
  const npvNeg = flows.reduce((acc, cf, i) => (cf < 0 ? acc + cf / Math.pow(1 + fr, i + 1) : acc), 0);
  return finite(Math.pow((-npvPos * Math.pow(1 + rr, n)) / (npvNeg * (1 + fr)), 1 / (n - 1)) - 1);
};

/** XNPV(rate, values, dates) — cash flows on actual dates, 365-day years. */
const XNPV: Fn = (args, ctx) => {
  const bad = argCount(args, 3);
  if (bad) return bad;
  const rate = toNumber(ctx.eval(args[0]));
  if (isError(rate)) return rate;
  const flows = aggregateNumbers([args[1]], ctx);
  if (isError(flows)) return flows;
  const dates = aggregateNumbers([args[2]], ctx);
  if (isError(dates)) return dates;
  if (flows.length !== dates.length || flows.length === 0) return NUM;
  const d0 = dates[0];
  return finite(flows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + rate, (dates[i] - d0) / 365), 0));
};

const XIRR: Fn = (args, ctx) => {
  const bad = argCount(args, 2, 3);
  if (bad) return bad;
  const flows = aggregateNumbers([args[0]], ctx);
  if (isError(flows)) return flows;
  const dates = aggregateNumbers([args[1]], ctx);
  if (isError(dates)) return dates;
  if (flows.length !== dates.length || flows.length === 0) return NUM;
  if (!flows.some((f) => f > 0) || !flows.some((f) => f < 0)) return NUM;
  const d0 = dates[0];
  const f = (r: number) => flows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + r, (dates[i] - d0) / 365), 0);
  let r = 0.1;
  if (args.length === 3) {
    const g = toNumber(ctx.eval(args[2]));
    if (isError(g)) return g;
    r = g;
  }
  for (let i = 0; i < 100; i++) {
    const y = f(r);
    const dy = (f(r + 1e-7) - y) / 1e-7;
    if (dy === 0) break;
    const next = r - y / dy;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - r) < 1e-10) return finite(next);
    r = next;
  }
  return NUM;
};

/** Depreciation: straight-line, sum-of-years, declining balance. */
const SLN: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 3);
  if (isError(ns)) return ns;
  const [cost, salvage, life] = ns;
  if (life === 0) return DIV0;
  return finite((cost - salvage) / life);
};

const SYD: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 4);
  if (isError(ns)) return ns;
  const [cost, salvage, life, per] = ns;
  if (life <= 0 || per < 1 || per > life) return NUM;
  return finite(((cost - salvage) * (life - per + 1) * 2) / (life * (life + 1)));
};

const DDB: Fn = (args, ctx) => {
  const ns = padded(args, ctx, 4, 5);
  if (isError(ns)) return ns;
  const [cost, salvage, life, per] = ns;
  const factor = args.length >= 5 && ns[4] !== 0 ? ns[4] : 2;
  if (life <= 0 || per < 1 || per > life || cost < 0 || salvage < 0) return NUM;
  let book = cost;
  let dep = 0;
  for (let k = 1; k <= Math.ceil(per); k++) {
    dep = Math.min((book * factor) / life, book - salvage);
    if (dep < 0) dep = 0;
    book -= dep;
  }
  return finite(dep);
};

const DB: Fn = (args, ctx) => {
  const ns = padded(args, ctx, 4, 5);
  if (isError(ns)) return ns;
  const [cost, salvage, life, per] = ns;
  const month = args.length >= 5 && ns[4] !== 0 ? ns[4] : 12;
  if (life <= 0 || per < 1 || per > life + 1 || cost <= 0) return NUM;
  const rate = Math.round((1 - Math.pow(salvage / cost, 1 / life)) * 1000) / 1000;
  let book = cost;
  let dep = 0;
  for (let k = 1; k <= Math.trunc(per); k++) {
    if (k === 1) dep = (cost * rate * month) / 12;
    else if (k === Math.trunc(life) + 1) dep = (book * rate * (12 - month)) / 12;
    else dep = book * rate;
    book -= dep;
  }
  return finite(dep);
};

const EFFECT: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 2);
  if (isError(ns)) return ns;
  const [nominal, periods] = ns;
  if (nominal <= 0 || periods < 1) return NUM;
  const n = Math.trunc(periods);
  return finite(Math.pow(1 + nominal / n, n) - 1);
};

const NOMINAL: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 2);
  if (isError(ns)) return ns;
  const [effect, periods] = ns;
  if (effect <= 0 || periods < 1) return NUM;
  const n = Math.trunc(periods);
  return finite(n * (Math.pow(1 + effect, 1 / n) - 1));
};

/** RRI(nper, pv, fv): the rate that grows pv into fv over nper periods. */
const RRI: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 3);
  if (isError(ns)) return ns;
  const [nper, pv, fv] = ns;
  if (nper <= 0 || pv === 0) return NUM;
  return finite(Math.pow(fv / pv, 1 / nper) - 1);
};

/** PDURATION(rate, pv, fv): periods needed for pv to reach fv at rate. */
const PDURATION: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 3);
  if (isError(ns)) return ns;
  const [rate, pv, fv] = ns;
  if (rate <= 0 || pv <= 0 || fv <= 0) return NUM;
  return finite(Math.log(fv / pv) / Math.log(1 + rate));
};

/** DOLLAR(number, [decimals]) lives in text, but the two currency-fraction
    helpers belong here. */
const DOLLARDE: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 2);
  if (isError(ns)) return ns;
  const [frac, base] = ns;
  const b = Math.trunc(base);
  if (b < 1) return NUM;
  const whole = Math.trunc(frac);
  const digits = Math.ceil(Math.log10(b));
  return finite(whole + ((frac - whole) * Math.pow(10, digits)) / b);
};

const DOLLARFR: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 2);
  if (isError(ns)) return ns;
  const [dec, base] = ns;
  const b = Math.trunc(base);
  if (b < 1) return NUM;
  const whole = Math.trunc(dec);
  const digits = Math.ceil(Math.log10(b));
  return finite(whole + ((dec - whole) * b) / Math.pow(10, digits));
};

export const FINANCIAL_FUNCTIONS: Record<string, Fn> = {
  PMT, FV, PV, NPER, RATE, IPMT, PPMT, CUMIPMT, CUMPRINC, NPV, IRR, MIRR, XNPV, XIRR,
  SLN, SYD, DDB, DB, EFFECT, NOMINAL, RRI, PDURATION, DOLLARDE, DOLLARFR,
};
