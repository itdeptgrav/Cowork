/**
 * Date and time functions.
 *
 * Dates are serial numbers on the same scale the display layer reads (serial
 * 25569 = 1970-01-01), so `=YEAR(DATE(2026,8,16))` and a Date number format agree.
 * TODAY and NOW are non-deterministic and, like every volatile function here, are
 * recomputed only when a dependency changes — not continuously on the clock.
 */

import { NUM, VALUE, isError } from "../errors";
import { toNumber } from "../value";
import { argCount, dateToSerial, serialToDate, type Fn } from "./types";

const DATE: Fn = (args, ctx) => {
  const bad = argCount(args, 3);
  if (bad) return bad;
  const y = toNumber(ctx.eval(args[0]));
  if (isError(y)) return y;
  const m = toNumber(ctx.eval(args[1]));
  if (isError(m)) return m;
  const d = toNumber(ctx.eval(args[2]));
  if (isError(d)) return d;
  /* A year 0–1899 is offset into the 1900s, the spreadsheet convention. */
  const year = y >= 0 && y < 1900 ? 1900 + Math.trunc(y) : Math.trunc(y);
  /* Date.UTC normalises out-of-range months and days (month 13 → next January). */
  return dateToSerial(Date.UTC(year, Math.trunc(m) - 1, Math.trunc(d)));
};

function part(args: Parameters<Fn>[0], ctx: Parameters<Fn>[1], get: (d: Date) => number) {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const serial = toNumber(ctx.eval(args[0]));
  if (isError(serial)) return serial;
  if (!Number.isFinite(serial)) return VALUE;
  return get(serialToDate(serial));
}

const YEAR: Fn = (args, ctx) => part(args, ctx, (d) => d.getUTCFullYear());
const MONTH: Fn = (args, ctx) => part(args, ctx, (d) => d.getUTCMonth() + 1);
const DAY: Fn = (args, ctx) => part(args, ctx, (d) => d.getUTCDate());

const TODAY: Fn = (args) => {
  const bad = argCount(args, 0);
  if (bad) return bad;
  return Math.floor(dateToSerial(Date.now()));
};

const NOW: Fn = (args) => {
  const bad = argCount(args, 0);
  if (bad) return bad;
  return dateToSerial(Date.now());
};

/**
 * WEEKDAY(serial, [type]): the day of the week.
 *  · type 1 (default): 1 = Sunday … 7 = Saturday
 *  · type 2: 1 = Monday … 7 = Sunday
 *  · type 3: 0 = Monday … 6 = Sunday
 */
const WEEKDAY: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 2);
  if (bad) return bad;
  const serial = toNumber(ctx.eval(args[0]));
  if (isError(serial)) return serial;
  if (!Number.isFinite(serial)) return VALUE;
  const type = args.length === 2 ? toNumber(ctx.eval(args[1])) : 1;
  if (isError(type)) return type;
  const sun0 = serialToDate(serial).getUTCDay(); // 0 = Sunday … 6 = Saturday
  switch (Math.trunc(type)) {
    case 1:
      return sun0 + 1;
    case 2:
      return ((sun0 + 6) % 7) + 1;
    case 3:
      return (sun0 + 6) % 7;
    default:
      return NUM;
  }
};

export const DATE_FUNCTIONS: Record<string, Fn> = {
  DATE,
  YEAR,
  MONTH,
  DAY,
  TODAY,
  NOW,
  WEEKDAY,
};
