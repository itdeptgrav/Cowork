/**
 * More date and time — parsing, time-of-day parts, month arithmetic, working
 * days and the year-fraction family.
 *
 * Serials are the ones `date.ts` uses (25569 = 1970-01-01), with the fraction
 * of a day carrying the time. DATEVALUE reads the forms people type — ISO
 * `2026-09-04`, `9/4/2026`, `4 Sep 2026`, `September 4, 2026` — and nothing
 * looser, because a date guessed wrong is worse than #VALUE!.
 */

import { NUM, VALUE, isError, type FormulaError } from "../errors";
import { isBlank, toNumber, toText, type ScalarValue } from "../value";
import type { Node } from "../ast";
import type { FnContext } from "../evaluator";
import { aggregateNumbers, argCount, dateToSerial, serialToDate, type Fn } from "./types";

const DAY_MS = 86_400_000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function num(node: Node, ctx: FnContext): number | FormulaError {
  return toNumber(ctx.eval(node));
}

/** A date serial (whole days) for a UTC Y/M/D; overflowing months and days
    normalise as Date.UTC does. */
function serialOf(y: number, m: number, d: number): number {
  return Math.round(dateToSerial(Date.UTC(y, m - 1, d)));
}

/** Parse typed text to a date serial, or null. */
export function parseDateText(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m) {
    const base = serialOf(+m[1], +m[2], +m[3]);
    const time = m[4] ? (+m[4] * 3600 + +m[5] * 60 + (m[6] ? +m[6] : 0)) / 86400 : 0;
    return base + time;
  }
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return serialOf(y, +m[1], +m[2]);
  }
  m = /^(\d{1,2})[ -]([a-z]{3,9})[ -,]*(\d{4})$/i.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi === -1) return null;
    return serialOf(+m[3], mi + 1, +m[1]);
  }
  m = /^([a-z]{3,9})\.? (\d{1,2}),? (\d{4})$/i.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi === -1) return null;
    return serialOf(+m[3], mi + 1, +m[2]);
  }
  return null;
}

/** Parse "13:45", "1:45 pm", "13:45:30" to a fraction of a day, or null. */
export function parseTimeText(raw: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/i.exec(raw.trim());
  if (!m) return null;
  let h = +m[1];
  const mi = m[2] ? +m[2] : 0;
  const s = m[3] ? +m[3] : 0;
  if (m[4]) {
    const pm = m[4].toLowerCase() === "pm";
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  if (h > 23 || mi > 59 || s > 59) return null;
  return (h * 3600 + mi * 60 + s) / 86400;
}

/** A date serial from a value: a number as itself, text parsed. */
function serialArg(node: Node, ctx: FnContext): number | FormulaError {
  const v = ctx.eval(node);
  if (isError(v)) return v;
  if (typeof v === "string") {
    const s = parseDateText(v);
    if (s === null) {
      const n = toNumber(v);
      return isError(n) ? VALUE : n;
    }
    return s;
  }
  return toNumber(v);
}

const DATEVALUE: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const v = ctx.eval(args[0]);
  if (isError(v)) return v;
  const t = toText(v);
  if (isError(t)) return t;
  const s = parseDateText(t);
  return s === null ? VALUE : Math.floor(s);
};

const TIMEVALUE: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const t = toText(ctx.eval(args[0]));
  if (isError(t)) return t;
  const f = parseTimeText(t);
  if (f !== null) return f;
  const d = parseDateText(t);
  return d === null ? VALUE : d - Math.floor(d);
};

const TIME: Fn = (args, ctx) => {
  const bad = argCount(args, 3);
  if (bad) return bad;
  const h = num(args[0], ctx);
  if (isError(h)) return h;
  const m = num(args[1], ctx);
  if (isError(m)) return m;
  const s = num(args[2], ctx);
  if (isError(s)) return s;
  const total = Math.trunc(h) * 3600 + Math.trunc(m) * 60 + Math.trunc(s);
  if (total < 0) return NUM;
  return (total % 86400) / 86400;
};

function timePart(args: Node[], ctx: FnContext, pick: (secs: number) => number): ScalarValue {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const serial = serialArg(args[0], ctx);
  if (isError(serial)) return serial;
  if (serial < 0) return NUM;
  const frac = serial - Math.floor(serial);
  const secs = Math.round(frac * 86400) % 86400;
  return pick(secs);
}

const HOUR: Fn = (args, ctx) => timePart(args, ctx, (s) => Math.floor(s / 3600));
const MINUTE: Fn = (args, ctx) => timePart(args, ctx, (s) => Math.floor((s % 3600) / 60));
const SECOND: Fn = (args, ctx) => timePart(args, ctx, (s) => s % 60);

function ymd(serial: number): { y: number; m: number; d: number } {
  const d = serialToDate(Math.floor(serial));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** EDATE: the same day n months on, clamped to the month's length. */
const EDATE: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const s = serialArg(args[0], ctx);
  if (isError(s)) return s;
  const n = num(args[1], ctx);
  if (isError(n)) return n;
  const { y, m, d } = ymd(s);
  const total = y * 12 + (m - 1) + Math.trunc(n);
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return serialOf(ny, nm, Math.min(d, daysInMonth(ny, nm)));
};

const EOMONTH: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const s = serialArg(args[0], ctx);
  if (isError(s)) return s;
  const n = num(args[1], ctx);
  if (isError(n)) return n;
  const { y, m } = ymd(s);
  const total = y * 12 + (m - 1) + Math.trunc(n);
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return serialOf(ny, nm, daysInMonth(ny, nm));
};

const DAYS: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const end = serialArg(args[0], ctx);
  if (isError(end)) return end;
  const start = serialArg(args[1], ctx);
  if (isError(start)) return start;
  return Math.floor(end) - Math.floor(start);
};

/** DAYS360 with the US (NASD) method, the default in both originals. */
const DAYS360: Fn = (args, ctx) => {
  const bad = argCount(args, 2, 3);
  if (bad) return bad;
  const a = serialArg(args[0], ctx);
  if (isError(a)) return a;
  const b = serialArg(args[1], ctx);
  if (isError(b)) return b;
  const s = ymd(a);
  const e = ymd(b);
  let d1 = s.d;
  let d2 = e.d;
  if (d1 === 31) d1 = 30;
  if (d2 === 31 && d1 === 30) d2 = 30;
  return (e.y - s.y) * 360 + (e.m - s.m) * 30 + (d2 - d1);
};

/** DATEDIF(start, end, unit): Y, M, D, MD, YM, YD. */
const DATEDIF: Fn = (args, ctx) => {
  const bad = argCount(args, 3);
  if (bad) return bad;
  const a = serialArg(args[0], ctx);
  if (isError(a)) return a;
  const b = serialArg(args[1], ctx);
  if (isError(b)) return b;
  const unitT = toText(ctx.eval(args[2]));
  if (isError(unitT)) return unitT;
  if (b < a) return NUM;
  const s = ymd(a);
  const e = ymd(b);
  let months = (e.y - s.y) * 12 + (e.m - s.m);
  if (e.d < s.d) months -= 1;
  switch (unitT.toUpperCase()) {
    case "D":
      return Math.floor(b) - Math.floor(a);
    case "M":
      return months;
    case "Y":
      return Math.floor(months / 12);
    case "YM":
      return months % 12;
    case "MD": {
      /* Days past the last full month. */
      const prevMonthDays = daysInMonth(e.m === 1 ? e.y - 1 : e.y, e.m === 1 ? 12 : e.m - 1);
      return e.d >= s.d ? e.d - s.d : e.d + prevMonthDays - s.d;
    }
    case "YD": {
      const years = Math.floor(months / 12);
      const anniversary = serialOf(s.y + years, s.m, Math.min(s.d, daysInMonth(s.y + years, s.m)));
      return Math.floor(b) - anniversary;
    }
    default:
      return NUM;
  }
};

function weekdayOf(serial: number): number {
  /* 0 = Sunday, from the serial's date. */
  return serialToDate(Math.floor(serial)).getUTCDay();
}

function holidaySet(node: Node | undefined, ctx: FnContext): Set<number> | FormulaError {
  const set = new Set<number>();
  if (!node) return set;
  for (const v of ctx.collect(node)) {
    if (isBlank(v)) continue;
    if (isError(v)) return v;
    const n = typeof v === "string" ? parseDateText(v) : toNumber(v);
    if (n === null || isError(n)) return VALUE;
    set.add(Math.floor(n));
  }
  return set;
}

/** NETWORKDAYS(start, end, [holidays]): Monday–Friday, inclusive, holidays out. */
const NETWORKDAYS: Fn = (args, ctx) => {
  const bad = argCount(args, 2, 3);
  if (bad) return bad;
  const a = serialArg(args[0], ctx);
  if (isError(a)) return a;
  const b = serialArg(args[1], ctx);
  if (isError(b)) return b;
  const holidays = holidaySet(args[2], ctx);
  if (isError(holidays)) return holidays;
  const from = Math.floor(Math.min(a, b));
  const to = Math.floor(Math.max(a, b));
  let count = 0;
  for (let d = from; d <= to; d++) {
    const wd = weekdayOf(d);
    if (wd === 0 || wd === 6 || holidays.has(d)) continue;
    count++;
  }
  return a <= b ? count : -count;
};

/** WORKDAY(start, days, [holidays]): the date n working days away. */
const WORKDAY: Fn = (args, ctx) => {
  const bad = argCount(args, 2, 3);
  if (bad) return bad;
  const s = serialArg(args[0], ctx);
  if (isError(s)) return s;
  const n = num(args[1], ctx);
  if (isError(n)) return n;
  const holidays = holidaySet(args[2], ctx);
  if (isError(holidays)) return holidays;
  let d = Math.floor(s);
  let left = Math.trunc(n);
  const step = left < 0 ? -1 : 1;
  while (left !== 0) {
    d += step;
    const wd = weekdayOf(d);
    if (wd === 0 || wd === 6 || holidays.has(d)) continue;
    left -= step;
  }
  return d;
};

/** WEEKNUM(date, [type]): type 1 weeks start Sunday, 2 Monday; week 1 holds
    January 1st. Type 21 is the ISO week. */
const WEEKNUM: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 2);
  if (bad) return bad;
  const s = serialArg(args[0], ctx);
  if (isError(s)) return s;
  let type = 1;
  if (args.length === 2) {
    const t = num(args[1], ctx);
    if (isError(t)) return t;
    type = Math.trunc(t);
  }
  if (type === 21) return isoWeek(Math.floor(s));
  const startDay = type === 2 ? 1 : 0;
  const { y } = ymd(s);
  const jan1 = serialOf(y, 1, 1);
  const jan1Wd = weekdayOf(jan1);
  const offset = (jan1Wd - startDay + 7) % 7;
  return Math.floor((Math.floor(s) - jan1 + offset) / 7) + 1;
};

function isoWeek(serial: number): number {
  const d = serialToDate(serial);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target.getTime() - firstThursday.getTime()) / DAY_MS;
  return 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

const ISOWEEKNUM: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const s = serialArg(args[0], ctx);
  if (isError(s)) return s;
  return isoWeek(Math.floor(s));
};

/** YEARFRAC(start, end, [basis]): 0 US 30/360, 1 actual/actual, 2 actual/360,
    3 actual/365, 4 European 30/360. */
const YEARFRAC: Fn = (args, ctx) => {
  const bad = argCount(args, 2, 3);
  if (bad) return bad;
  const a0 = serialArg(args[0], ctx);
  if (isError(a0)) return a0;
  const b0 = serialArg(args[1], ctx);
  if (isError(b0)) return b0;
  let basis = 0;
  if (args.length === 3) {
    const b = num(args[2], ctx);
    if (isError(b)) return b;
    basis = Math.trunc(b);
  }
  const a = Math.floor(Math.min(a0, b0));
  const b = Math.floor(Math.max(a0, b0));
  const s = ymd(a);
  const e = ymd(b);
  switch (basis) {
    case 0: {
      let d1 = s.d;
      let d2 = e.d;
      const lastFebS = s.m === 2 && s.d === daysInMonth(s.y, 2);
      const lastFebE = e.m === 2 && e.d === daysInMonth(e.y, 2);
      if (lastFebS && lastFebE) d2 = 30;
      if (lastFebS) d1 = 30;
      if (d2 === 31 && d1 >= 30) d2 = 30;
      if (d1 === 31) d1 = 30;
      return ((e.y - s.y) * 360 + (e.m - s.m) * 30 + (d2 - d1)) / 360;
    }
    case 1: {
      const days = b - a;
      if (s.y === e.y) return days / (daysInMonth(s.y, 2) === 29 ? 366 : 365);
      let total = 0;
      for (let y = s.y; y <= e.y; y++) total += daysInMonth(y, 2) === 29 ? 366 : 365;
      return days / (total / (e.y - s.y + 1));
    }
    case 2:
      return (b - a) / 360;
    case 3:
      return (b - a) / 365;
    case 4: {
      const d1 = Math.min(s.d, 30);
      const d2 = Math.min(e.d, 30);
      return ((e.y - s.y) * 360 + (e.m - s.m) * 30 + (d2 - d1)) / 360;
    }
    default:
      return NUM;
  }
};

/** DATESTRING helpers: the name of a month or weekday from a serial. */
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MONTHNAME: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const s = serialArg(args[0], ctx);
  if (isError(s)) return s;
  return MONTH_NAMES[ymd(s).m - 1];
};

const DAYNAME: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const s = serialArg(args[0], ctx);
  if (isError(s)) return s;
  return DAY_NAMES[weekdayOf(s)];
};

/** The sum of a column of durations is just SUM; these two make the halves
    of a serial explicit. */
const DATEPART: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const s = serialArg(args[0], ctx);
  if (isError(s)) return s;
  return Math.floor(s);
};

const TIMEPART: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const s = serialArg(args[0], ctx);
  if (isError(s)) return s;
  return s - Math.floor(s);
};

/** Ensure the shared helper stays referenced: a date list's earliest serial. */
export function earliest(args: Node[], ctx: FnContext): number | FormulaError {
  const ns = aggregateNumbers(args, ctx);
  if (isError(ns)) return ns;
  return ns.length ? Math.min(...ns) : NUM;
}

export const DATE_EXTRA_FUNCTIONS: Record<string, Fn> = {
  DATEVALUE, TIMEVALUE, TIME, HOUR, MINUTE, SECOND, EDATE, EOMONTH, DAYS, DAYS360, DATEDIF,
  NETWORKDAYS, WORKDAY, WEEKNUM, ISOWEEKNUM, YEARFRAC, MONTHNAME, DAYNAME, DATEPART, TIMEPART,
};
