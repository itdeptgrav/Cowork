/**
 * Information and engineering functions.
 *
 * The IS* family answers a question about a value's TYPE without ever
 * raising an error itself — `ISERROR(1/0)` is TRUE, not #DIV/0! — which is
 * the whole reason they exist: a formula that wants to guard a lookup needs
 * a predicate that survives what it is guarding against.
 *
 * The engineering half is number-base conversion and bit arithmetic, the
 * Sheets/Excel subset people actually reach for.
 */

import { NA, NUM, VALUE, isError, type FormulaError } from "../errors";
import { isArray, isBlank, toNumber, toText, type ScalarValue } from "../value";
import type { Node } from "../ast";
import type { FnContext } from "../evaluator";
import { argCount, type Fn } from "./types";
import { numbers } from "./mathExtra";

/** The one argument, evaluated — errors come back as VALUES here, not thrown
    upward, because the IS* predicates test for them. */
function one(args: Node[], ctx: FnContext): ScalarValue | FormulaError {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const v = ctx.eval(args[0]);
  return isArray(v) ? v.first : v;
}

const predicate =
  (test: (v: ScalarValue) => boolean): Fn =>
  (args, ctx) => {
    const bad = argCount(args, 1);
    if (bad) return bad;
    const v = ctx.eval(args[0]);
    return test(isArray(v) ? v.first : v);
  };

const ISNUMBER: Fn = predicate((v) => typeof v === "number");
const ISTEXT: Fn = predicate((v) => typeof v === "string");
const ISNONTEXT: Fn = predicate((v) => typeof v !== "string");
const ISLOGICAL: Fn = predicate((v) => typeof v === "boolean");
const ISBLANK: Fn = predicate((v) => isBlank(v));
const ISERROR: Fn = predicate((v) => isError(v));
const ISERR: Fn = predicate((v) => isError(v) && v.code !== "#N/A");
const ISNA: Fn = predicate((v) => isError(v) && v.code === "#N/A");

const ISEVEN: Fn = (args, ctx) => {
  const v = one(args, ctx);
  if (isError(v)) return v;
  const n = toNumber(v);
  if (isError(n)) return n;
  return Math.trunc(n) % 2 === 0;
};

const ISODD: Fn = (args, ctx) => {
  const v = one(args, ctx);
  if (isError(v)) return v;
  const n = toNumber(v);
  if (isError(n)) return n;
  return Math.abs(Math.trunc(n)) % 2 === 1;
};

/** N(value): a number as itself, TRUE as 1, a date serial as its number, text as 0. */
const N: Fn = (args, ctx) => {
  const v = one(args, ctx);
  if (isError(v)) return v;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return 0;
};

/** T(value): text as itself, anything else as the empty string. */
const T: Fn = (args, ctx) => {
  const v = one(args, ctx);
  if (isError(v)) return v;
  return typeof v === "string" ? v : "";
};

const NA_FN: Fn = (args) => {
  const bad = argCount(args, 0);
  return bad ?? NA;
};

/** TYPE(value): 1 number, 2 text, 4 boolean, 16 error, 64 array. */
const TYPE: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const v = ctx.eval(args[0]);
  if (isArray(v)) return 64;
  if (isError(v)) return 16;
  if (typeof v === "boolean") return 4;
  if (typeof v === "string") return 2;
  return 1;
};

const ERROR_CODES: Record<string, number> = {
  "#DIV/0!": 2,
  "#VALUE!": 3,
  "#REF!": 4,
  "#NAME?": 5,
  "#NUM!": 6,
  "#N/A": 7,
};

/** ERROR.TYPE(value): the error's number, or #N/A when it is not an error. */
const ERROR_TYPE: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const v = ctx.eval(args[0]);
  if (!isError(v)) return NA;
  return ERROR_CODES[v.code] ?? NA;
};

/* ── Number bases ───────────────────────────────────────────────────────── */

function digitsOf(v: ScalarValue): string | FormulaError {
  if (isError(v)) return v;
  const t = toText(v);
  if (isError(t)) return t;
  return t.trim();
}

/** Two's-complement reading of a fixed-width digit string, as the spreadsheet
    does for a 10-digit binary / 10-digit hex / 10-digit octal number. */
function fromBase(text: string, radix: number, width: number): number | FormulaError {
  if (text === "") return 0;
  if (text.length > width) return NUM;
  const valid = radix === 2 ? /^[01]+$/ : radix === 8 ? /^[0-7]+$/ : /^[0-9a-fA-F]+$/;
  if (!valid.test(text)) return NUM;
  const n = parseInt(text, radix);
  const limit = Math.pow(radix, width);
  return text.length === width && n >= limit / 2 ? n - limit : n;
}

function toBase(n: number, radix: number, width: number, places?: number): string | FormulaError {
  const v = Math.trunc(n);
  const limit = Math.pow(radix, width);
  if (v < -limit / 2 || v >= limit / 2) return NUM;
  const text = (v < 0 ? v + limit : v).toString(radix).toUpperCase();
  if (places === undefined) return text;
  const p = Math.trunc(places);
  if (p < text.length || p > width) return NUM;
  return text.padStart(p, "0");
}

const conv =
  (fromRadix: number, toRadix: number, fromWidth: number, toWidth: number): Fn =>
  (args, ctx) => {
    const bad = argCount(args, 1, toRadix === 10 ? 1 : 2);
    if (bad) return bad;
    const raw = ctx.eval(args[0]);
    let n: number | FormulaError;
    if (fromRadix === 10) n = toNumber(raw);
    else {
      const t = digitsOf(raw);
      if (isError(t)) return t;
      n = fromBase(t, fromRadix, fromWidth);
    }
    if (isError(n)) return n;
    if (toRadix === 10) return n;
    let places: number | undefined;
    if (args.length === 2) {
      const p = toNumber(ctx.eval(args[1]));
      if (isError(p)) return p;
      places = p;
    }
    return toBase(n, toRadix, toWidth, places);
  };

const BIN2DEC = conv(2, 10, 10, 10);
const BIN2HEX = conv(2, 16, 10, 10);
const BIN2OCT = conv(2, 8, 10, 10);
const DEC2BIN = conv(10, 2, 10, 10);
const DEC2HEX = conv(10, 16, 10, 10);
const DEC2OCT = conv(10, 8, 10, 10);
const HEX2DEC = conv(16, 10, 10, 10);
const HEX2BIN = conv(16, 2, 10, 10);
const HEX2OCT = conv(16, 8, 10, 10);
const OCT2DEC = conv(8, 10, 10, 10);
const OCT2BIN = conv(8, 2, 10, 10);
const OCT2HEX = conv(8, 16, 10, 10);

/* ── Bits ───────────────────────────────────────────────────────────────── */

const MAX_BITS = 2 ** 48;

function bitwise(op: (a: bigint, b: bigint) => bigint): Fn {
  return (args, ctx) => {
    const ns = numbers(args, ctx, 2);
    if (isError(ns)) return ns;
    const [a, b] = ns;
    if (a < 0 || b < 0 || a >= MAX_BITS || b >= MAX_BITS || !Number.isInteger(a) || !Number.isInteger(b)) return NUM;
    return Number(op(BigInt(a), BigInt(b)));
  };
}

const BITAND = bitwise((a, b) => a & b);
const BITOR = bitwise((a, b) => a | b);
const BITXOR = bitwise((a, b) => a ^ b);

const shift =
  (direction: 1 | -1): Fn =>
  (args, ctx) => {
    const ns = numbers(args, ctx, 2);
    if (isError(ns)) return ns;
    const [a, s] = ns;
    if (a < 0 || a >= MAX_BITS || !Number.isInteger(a)) return NUM;
    const amount = Math.trunc(s) * direction;
    const r = amount >= 0 ? BigInt(a) << BigInt(amount) : BigInt(a) >> BigInt(-amount);
    if (r >= BigInt(MAX_BITS)) return NUM;
    return Number(r);
  };

const BITLSHIFT = shift(1);
const BITRSHIFT = shift(-1);

/** DELTA(a, [b]): 1 when equal; GESTEP(n, [step]): 1 when n >= step. */
const DELTA: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 1, 2);
  if (isError(ns)) return ns;
  return ns[0] === (ns[1] ?? 0) ? 1 : 0;
};

const GESTEP: Fn = (args, ctx) => {
  const ns = numbers(args, ctx, 1, 2);
  if (isError(ns)) return ns;
  return ns[0] >= (ns[1] ?? 0) ? 1 : 0;
};

/** CONVERT(value, from_unit, to_unit) for the common measures. */
const UNITS: Record<string, [string, number]> = {
  /* length → metres */
  m: ["len", 1], km: ["len", 1000], cm: ["len", 0.01], mm: ["len", 0.001], mi: ["len", 1609.344],
  yd: ["len", 0.9144], ft: ["len", 0.3048], in: ["len", 0.0254], nmi: ["len", 1852],
  /* mass → kilograms */
  kg: ["mass", 1], g: ["mass", 0.001], lbm: ["mass", 0.45359237], ozm: ["mass", 0.028349523125],
  ton: ["mass", 907.18474], stone: ["mass", 6.35029318],
  /* time → seconds */
  sec: ["time", 1], s: ["time", 1], min: ["time", 60], mn: ["time", 60], hr: ["time", 3600],
  day: ["time", 86400], d: ["time", 86400], yr: ["time", 31557600],
  /* volume → litres */
  l: ["vol", 1], L: ["vol", 1], ml: ["vol", 0.001], gal: ["vol", 3.785411784], qt: ["vol", 0.946352946],
  pt: ["vol", 0.473176473], cup: ["vol", 0.2365882365], oz: ["vol", 0.0295735295625], "m3": ["vol", 1000],
  /* area → square metres */
  "m2": ["area", 1], "km2": ["area", 1e6], "ft2": ["area", 0.09290304], "mi2": ["area", 2589988.110336],
  ha: ["area", 10000], acre: ["area", 4046.8564224],
  /* speed → m/s */
  "m/s": ["speed", 1], "km/h": ["speed", 1 / 3.6], mph: ["speed", 0.44704], kn: ["speed", 0.514444],
  /* information → bytes */
  byte: ["info", 1], bit: ["info", 0.125], kbyte: ["info", 1024], Mbyte: ["info", 1024 ** 2], Gbyte: ["info", 1024 ** 3],
  /* energy → joules */
  J: ["energy", 1], kJ: ["energy", 1000], cal: ["energy", 4.184], kcal: ["energy", 4184], Wh: ["energy", 3600], kWh: ["energy", 3.6e6],
  /* pressure → pascals */
  Pa: ["press", 1], atm: ["press", 101325], mmHg: ["press", 133.322], psi: ["press", 6894.757], bar: ["press", 100000],
};

const CONVERT: Fn = (args, ctx) => {
  const bad = argCount(args, 3);
  if (bad) return bad;
  const n = toNumber(ctx.eval(args[0]));
  if (isError(n)) return n;
  const from = digitsOf(ctx.eval(args[1]));
  if (isError(from)) return from;
  const to = digitsOf(ctx.eval(args[2]));
  if (isError(to)) return to;
  /* Temperature has offsets, not just scale. */
  const temp = (t: string) => ({ C: "C", cel: "C", F: "F", fah: "F", K: "K", kel: "K" })[t];
  const tf = temp(from);
  const tt = temp(to);
  if (tf && tt) {
    const k = tf === "C" ? n + 273.15 : tf === "F" ? ((n - 32) * 5) / 9 + 273.15 : n;
    return tt === "C" ? k - 273.15 : tt === "F" ? ((k - 273.15) * 9) / 5 + 32 : k;
  }
  const a = UNITS[from];
  const b = UNITS[to];
  if (!a || !b) return NA;
  if (a[0] !== b[0]) return NA;
  return (n * a[1]) / b[1];
};

export const INFO_FUNCTIONS: Record<string, Fn> = {
  ISNUMBER, ISTEXT, ISNONTEXT, ISLOGICAL, ISBLANK, ISERROR, ISERR, ISNA, ISEVEN, ISODD, N, T,
  NA: NA_FN, TYPE, "ERROR.TYPE": ERROR_TYPE,
  BIN2DEC, BIN2HEX, BIN2OCT, DEC2BIN, DEC2HEX, DEC2OCT, HEX2DEC, HEX2BIN, HEX2OCT, OCT2DEC, OCT2BIN, OCT2HEX,
  BITAND, BITOR, BITXOR, BITLSHIFT, BITRSHIFT, DELTA, GESTEP, CONVERT,
};

/* VALUE is imported for the guard below; a bad unit is #N/A per the originals,
   but an unreadable number is #VALUE!. */
export const _UNIT_ERROR = VALUE;
