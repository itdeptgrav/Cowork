/**
 * Functions whose result is a PICTURE in the cell rather than a value —
 * SPARKLINE and IMAGE. They return a `RichValue`, which the grid draws and
 * every other reader treats as empty: `=A1+1` on a sparkline cell is #VALUE!,
 * its text is "", and a CSV export writes nothing for it.
 *
 * SPARKLINE(data, [type], [colour], [min], [max]) — Sheets' form with the
 * options as plain arguments, since this formula language has no `{…}`
 * array literal to carry an options table. `type` is line (default), bar,
 * column or winloss.
 *
 * IMAGE(url, [mode]) — an https address; mode 1 fits the picture in the
 * cell, 2 stretches it to the cell, 3 shows it at its own size, clipped.
 */

import { VALUE, isError } from "../errors";
import { RichValue, isBlank, toNumber, toText } from "../value";
import { argCount, type Fn } from "./types";

const SPARK_TYPES = new Set(["line", "bar", "column", "winloss"]);

const SPARKLINE: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 5);
  if (bad) return bad;
  const values: number[] = [];
  for (const v of ctx.collect(args[0])) {
    if (isError(v)) return v;
    if (typeof v === "number") values.push(v);
    else if (typeof v === "boolean") values.push(v ? 1 : 0);
  }
  let chart: "line" | "bar" | "column" | "winloss" = "line";
  if (args.length >= 2) {
    const v = ctx.eval(args[1]);
    if (!isBlank(v)) {
      const t = toText(v);
      if (isError(t)) return t;
      const lower = t.trim().toLowerCase();
      if (!SPARK_TYPES.has(lower)) return VALUE;
      chart = lower as typeof chart;
    }
  }
  let color: string | undefined;
  if (args.length >= 3) {
    const v = ctx.eval(args[2]);
    if (!isBlank(v)) {
      const t = toText(v);
      if (isError(t)) return t;
      const c = t.trim();
      if (!/^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(c)) return VALUE;
      color = c;
    }
  }
  let min: number | undefined;
  let max: number | undefined;
  if (args.length >= 4) {
    const v = ctx.eval(args[3]);
    if (!isBlank(v)) {
      const n = toNumber(v);
      if (isError(n)) return n;
      min = n;
    }
  }
  if (args.length >= 5) {
    const v = ctx.eval(args[4]);
    if (!isBlank(v)) {
      const n = toNumber(v);
      if (isError(n)) return n;
      max = n;
    }
  }
  if (min !== undefined && max !== undefined && max <= min) return VALUE;
  return new RichValue({ type: "sparkline", chart, values: values.slice(0, 500), ...(color ? { color } : {}), ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
};

const IMAGE: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 2);
  if (bad) return bad;
  const t = toText(ctx.eval(args[0]));
  if (isError(t)) return t;
  const url = t.trim();
  if (!/^https:\/\/[^\s"'<>]+$/i.test(url)) return VALUE;
  let mode: 1 | 2 | 3 = 1;
  if (args.length === 2) {
    const v = ctx.eval(args[1]);
    if (!isBlank(v)) {
      const n = toNumber(v);
      if (isError(n)) return n;
      const m = Math.trunc(n);
      if (m < 1 || m > 3) return VALUE;
      mode = m as 1 | 2 | 3;
    }
  }
  return new RichValue({ type: "image", url, mode });
};

export const VISUAL_FUNCTIONS: Record<string, Fn> = { SPARKLINE, IMAGE };
