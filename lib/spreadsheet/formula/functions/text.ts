/**
 * Text functions.
 *
 * TEXT and VALUE deserve their caveats, written here rather than discovered: TEXT
 * supports the common numeric placeholders (`0`, `#`, `.`, `,`, `%`, a leading
 * currency symbol) and the common date/time tokens (`yyyy`, `mm`, `dd`, `hh`,
 * `ss`, and month/weekday names), but NOT the full Excel format-code language
 * (colours, conditions, fractions, scientific). SEARCH is case-insensitive
 * substring matching WITHOUT wildcard support, and VALUE parses plain numbers,
 * percentages and a leading currency symbol — not locale-specific or date text.
 */

import { VALUE, isError } from "../errors";
import { toNumber, toText, type ScalarValue } from "../value";
import { argCount, serialToDate, type Fn } from "./types";

/** A value as text, or the error it carries. */
function textOf(v: ScalarValue): ReturnType<typeof toText> {
  return toText(v);
}

const CONCATENATE: Fn = (args, ctx) => {
  let out = "";
  for (const arg of args) {
    for (const v of ctx.collect(arg)) {
      const t = toText(v);
      if (isError(t)) return t;
      out += t;
    }
  }
  return out;
};

const LEN: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const t = textOf(ctx.eval(args[0]));
  return isError(t) ? t : t.length;
};

function endChars(args: Node2, ctx: Ctx, side: "left" | "right"): ScalarValue {
  const bad = argCount(args, 1, 2);
  if (bad) return bad;
  const t = textOf(ctx.eval(args[0]));
  if (isError(t)) return t;
  const n = args.length === 2 ? toNumber(ctx.eval(args[1])) : 1;
  if (isError(n)) return n;
  if (n < 0) return VALUE; // a negative count is an error, per Sheets/Excel
  const count = Math.trunc(n);
  return side === "left" ? t.slice(0, count) : count === 0 ? "" : t.slice(-count);
}
type Node2 = Parameters<Fn>[0];
type Ctx = Parameters<Fn>[1];

const LEFT: Fn = (args, ctx) => endChars(args, ctx, "left");
const RIGHT: Fn = (args, ctx) => endChars(args, ctx, "right");

const MID: Fn = (args, ctx) => {
  const bad = argCount(args, 3);
  if (bad) return bad;
  const t = textOf(ctx.eval(args[0]));
  if (isError(t)) return t;
  const start = toNumber(ctx.eval(args[1]));
  if (isError(start)) return start;
  const len = toNumber(ctx.eval(args[2]));
  if (isError(len)) return len;
  if (start < 1 || len < 0) return VALUE;
  return t.slice(Math.trunc(start) - 1, Math.trunc(start) - 1 + Math.trunc(len));
};

const LOWER: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const t = textOf(ctx.eval(args[0]));
  return isError(t) ? t : t.toLowerCase();
};

const UPPER: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const t = textOf(ctx.eval(args[0]));
  return isError(t) ? t : t.toUpperCase();
};

const TRIM: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const t = textOf(ctx.eval(args[0]));
  /* Collapse runs of spaces to one and strip the ends, as the spreadsheet does. */
  return isError(t) ? t : t.replace(/\s+/g, " ").trim();
};

const SUBSTITUTE: Fn = (args, ctx) => {
  const bad = argCount(args, 3, 4);
  if (bad) return bad;
  const text = textOf(ctx.eval(args[0]));
  if (isError(text)) return text;
  const oldT = textOf(ctx.eval(args[1]));
  if (isError(oldT)) return oldT;
  const newT = textOf(ctx.eval(args[2]));
  if (isError(newT)) return newT;
  if (oldT === "") return text;
  if (args.length === 4) {
    const which = toNumber(ctx.eval(args[3]));
    if (isError(which)) return which;
    if (which < 1) return VALUE;
    let count = 0;
    let idx = 0;
    while ((idx = text.indexOf(oldT, idx)) !== -1) {
      count += 1;
      if (count === Math.trunc(which)) {
        return text.slice(0, idx) + newT + text.slice(idx + oldT.length);
      }
      idx += oldT.length;
    }
    return text; // that instance does not exist
  }
  return text.split(oldT).join(newT);
};

function locate(args: Node2, ctx: Ctx, caseSensitive: boolean): ScalarValue {
  const bad = argCount(args, 2, 3);
  if (bad) return bad;
  const needle = textOf(ctx.eval(args[0]));
  if (isError(needle)) return needle;
  const hay = textOf(ctx.eval(args[1]));
  if (isError(hay)) return hay;
  const start = args.length === 3 ? toNumber(ctx.eval(args[2])) : 1;
  if (isError(start)) return start;
  if (start < 1) return VALUE;
  const from = Math.trunc(start) - 1;
  const idx = caseSensitive
    ? hay.indexOf(needle, from)
    : hay.toLowerCase().indexOf(needle.toLowerCase(), from);
  return idx === -1 ? VALUE : idx + 1;
}

const FIND: Fn = (args, ctx) => locate(args, ctx, true);
const SEARCH: Fn = (args, ctx) => locate(args, ctx, false);

/* ── TEXT: a practical subset of the format-code language ─────────────────── */

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function formatDatePattern(serial: number, fmt: string): string {
  const d = serialToDate(serial);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const day = d.getUTCDate();
  const wd = d.getUTCDay();
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  let out = "";
  let i = 0;
  let afterHour = false; // so `mm` after `h` reads as minutes, not months
  const tokens = ["yyyy","yy","mmmm","mmm","mm","m","dddd","ddd","dd","d","hh","h","ss","s"];
  while (i < fmt.length) {
    const tok = tokens.find((t) => fmt.startsWith(t, i));
    if (!tok) {
      out += fmt[i];
      i += 1;
      continue;
    }
    i += tok.length;
    switch (tok) {
      case "yyyy": out += String(y); break;
      case "yy": out += pad(y % 100); break;
      case "mmmm": out += MONTHS[mo]; break;
      case "mmm": out += MONTHS[mo].slice(0, 3); break;
      case "mm": out += afterHour ? pad(mi) : pad(mo + 1); break;
      case "m": out += afterHour ? String(mi) : String(mo + 1); break;
      case "dddd": out += DAYS[wd]; break;
      case "ddd": out += DAYS[wd].slice(0, 3); break;
      case "dd": out += pad(day); break;
      case "d": out += String(day); break;
      case "hh": out += pad(h); afterHour = true; break;
      case "h": out += String(h); afterHour = true; break;
      case "ss": out += pad(s); break;
      case "s": out += String(s); break;
    }
  }
  return out;
}

function formatNumberPattern(n: number, fmt: string): string {
  const percent = fmt.includes("%");
  const value = percent ? n * 100 : n;
  const dot = fmt.indexOf(".");
  const decimals = dot >= 0 ? (fmt.slice(dot + 1).match(/[0#]/g)?.length ?? 0) : 0;
  const grouping = /[#0],[#0]/.test(fmt) || /,[#0]{3}/.test(fmt) || fmt.includes(",#") || fmt.includes(",0");
  const neg = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const grouped = grouping ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : int;
  const body = grouped + (frac ? `.${frac}` : "");
  const currency = fmt.startsWith("$") || fmt.startsWith("£") || fmt.startsWith("€") ? fmt[0] : "";
  return `${neg ? "-" : ""}${currency}${body}${percent ? "%" : ""}`;
}

const TEXT: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const value = ctx.eval(args[0]);
  if (isError(value)) return value;
  const fmt = textOf(ctx.eval(args[1]));
  if (isError(fmt)) return fmt;
  const n = toNumber(value);
  if (isError(n)) return toText(value); // non-numeric text formats to itself
  /* Any y/m/d/h/s letter marks a date format; otherwise it is numeric. */
  return /[ymdhs]/i.test(fmt) ? formatDatePattern(n, fmt) : formatNumberPattern(n, fmt);
};

const VALUE_FN: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const t = textOf(ctx.eval(args[0]));
  if (isError(t)) return t;
  let s = t.trim().replace(/^[$£€]/, "").replace(/,/g, "");
  const percent = s.endsWith("%");
  if (percent) s = s.slice(0, -1).trim();
  if (s === "" || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return VALUE;
  const num = Number(s);
  return percent ? num / 100 : num;
};

export const TEXT_FUNCTIONS: Record<string, Fn> = {
  CONCATENATE,
  LEN,
  LEFT,
  RIGHT,
  MID,
  LOWER,
  UPPER,
  TRIM,
  SUBSTITUTE,
  FIND,
  SEARCH,
  TEXT,
  VALUE: VALUE_FN,
};
