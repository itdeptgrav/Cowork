/**
 * More text — case, repetition, character codes, regular expressions, joining
 * and splitting, and the number-to-text formatters.
 *
 * The REGEX* trio is Google Sheets' (Excel has no equivalent); patterns are
 * JavaScript regular expressions, which cover what people paste in from RE2
 * for ordinary matching. SPLIT returns an array, so on its own a cell shows
 * the first piece and `INDEX(SPLIT(...), 1, 2)` picks another — the same
 * non-spilling rule every array function here follows.
 */

import { NA, VALUE, isError, type FormulaError } from "../errors";
import { ArrayValue, formatNumber, isArray, isBlank, toBoolean, toNumber, toText, type ScalarValue } from "../value";
import type { Node } from "../ast";
import type { FnContext } from "../evaluator";
import { argCount, type Fn } from "./types";

function text(node: Node, ctx: FnContext): string | FormulaError {
  return toText(ctx.eval(node));
}

function num(node: Node, ctx: FnContext): number | FormulaError {
  return toNumber(ctx.eval(node));
}

const PROPER: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const t = text(args[0], ctx);
  if (isError(t)) return t;
  /* Any letter after a non-letter is capitalised — "o'neil" is "O'Neil" and
     "2nd" is "2Nd", exactly as the originals do it. */
  return t.toLowerCase().replace(/(^|[^a-z])([a-z])/gi, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
};

const REPT: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const t = text(args[0], ctx);
  if (isError(t)) return t;
  const n = num(args[1], ctx);
  if (isError(n)) return n;
  if (n < 0 || t.length * n > 32767) return VALUE;
  return t.repeat(Math.trunc(n));
};

const EXACT: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const a = text(args[0], ctx);
  if (isError(a)) return a;
  const b = text(args[1], ctx);
  if (isError(b)) return b;
  return a === b;
};

const CHAR: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const n = num(args[0], ctx);
  if (isError(n)) return n;
  const code = Math.trunc(n);
  if (code < 1 || code > 255) return VALUE;
  return String.fromCharCode(code);
};

const CODE: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const t = text(args[0], ctx);
  if (isError(t)) return t;
  if (t === "") return VALUE;
  return t.charCodeAt(0);
};

const UNICHAR: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const n = num(args[0], ctx);
  if (isError(n)) return n;
  const code = Math.trunc(n);
  if (code < 1 || code > 0x10ffff) return VALUE;
  return String.fromCodePoint(code);
};

const UNICODE: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const t = text(args[0], ctx);
  if (isError(t)) return t;
  if (t === "") return VALUE;
  return t.codePointAt(0) ?? VALUE;
};

/** CLEAN strips the non-printing control characters. */
const CLEAN: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const t = text(args[0], ctx);
  if (isError(t)) return t;
  return t.replace(/[\x00-\x1f\x7f]/g, "");
};

/** REPLACE(text, start, length, new_text) — by position, unlike SUBSTITUTE. */
const REPLACE: Fn = (args, ctx) => {
  const bad = argCount(args, 4);
  if (bad) return bad;
  const t = text(args[0], ctx);
  if (isError(t)) return t;
  const start = num(args[1], ctx);
  if (isError(start)) return start;
  const len = num(args[2], ctx);
  if (isError(len)) return len;
  const repl = text(args[3], ctx);
  if (isError(repl)) return repl;
  if (start < 1 || len < 0) return VALUE;
  const s = Math.trunc(start) - 1;
  return t.slice(0, s) + repl + t.slice(s + Math.trunc(len));
};

/** TEXTJOIN(delimiter, ignore_empty, text1, …). JOIN is Sheets' shorter form
    that never skips empties. */
function joinWith(delim: string, skipEmpty: boolean, args: Node[], ctx: FnContext): string | FormulaError {
  const parts: string[] = [];
  for (const a of args) {
    for (const v of ctx.collect(a)) {
      const t = toText(v);
      if (isError(t)) return t;
      if (skipEmpty && t === "") continue;
      parts.push(t);
    }
  }
  return parts.join(delim);
}

const TEXTJOIN: Fn = (args, ctx) => {
  if (args.length < 3) return VALUE;
  const delim = text(args[0], ctx);
  if (isError(delim)) return delim;
  const skip = toBoolean(ctx.eval(args[1]));
  if (isError(skip)) return skip;
  return joinWith(delim, skip, args.slice(2), ctx);
};

const JOIN: Fn = (args, ctx) => {
  if (args.length < 2) return VALUE;
  const delim = text(args[0], ctx);
  if (isError(delim)) return delim;
  return joinWith(delim, false, args.slice(1), ctx);
};

/** CONCAT is the modern name for CONCATENATE and accepts ranges. */
const CONCAT: Fn = (args, ctx) => joinWith("", false, args, ctx);

/** SPLIT(text, delimiter, [split_by_each], [remove_empty]) → a one-row array. */
const SPLIT: Fn = (args, ctx) => {
  const bad = argCount(args, 2, 4);
  if (bad) return bad;
  const t = text(args[0], ctx);
  if (isError(t)) return t;
  const d = text(args[1], ctx);
  if (isError(d)) return d;
  let byEach = true;
  if (args.length >= 3) {
    const b = toBoolean(ctx.eval(args[2]));
    if (isError(b)) return b;
    byEach = b;
  }
  let removeEmpty = true;
  if (args.length >= 4) {
    const b = toBoolean(ctx.eval(args[3]));
    if (isError(b)) return b;
    removeEmpty = b;
  }
  if (d === "") return VALUE;
  let pieces: string[];
  if (byEach) {
    const chars = new Set(d.split(""));
    pieces = [];
    let cur = "";
    for (const ch of t) {
      if (chars.has(ch)) {
        pieces.push(cur);
        cur = "";
      } else cur += ch;
    }
    pieces.push(cur);
  } else pieces = t.split(d);
  if (removeEmpty) pieces = pieces.filter((p) => p !== "");
  const row: ScalarValue[] = pieces.map((p) => {
    const n = Number(p);
    return p.trim() !== "" && Number.isFinite(n) && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(p.trim()) ? n : p;
  });
  return new ArrayValue([row.length ? row : [""]]);
};

function regexOf(pattern: string, flags = ""): RegExp | FormulaError {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return VALUE;
  }
}

const REGEXMATCH: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const t = text(args[0], ctx);
  if (isError(t)) return t;
  const p = text(args[1], ctx);
  if (isError(p)) return p;
  const re = regexOf(p);
  if (isError(re)) return re;
  return re.test(t);
};

/** The first match — or the first capture group when the pattern has one,
    which is how Sheets behaves. #N/A when nothing matches. */
const REGEXEXTRACT: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const t = text(args[0], ctx);
  if (isError(t)) return t;
  const p = text(args[1], ctx);
  if (isError(p)) return p;
  const re = regexOf(p);
  if (isError(re)) return re;
  const m = re.exec(t);
  if (!m) return NA;
  return m.length > 1 ? (m[1] ?? "") : m[0];
};

const REGEXREPLACE: Fn = (args, ctx) => {
  const bad = argCount(args, 3);
  if (bad) return bad;
  const t = text(args[0], ctx);
  if (isError(t)) return t;
  const p = text(args[1], ctx);
  if (isError(p)) return p;
  const r = text(args[2], ctx);
  if (isError(r)) return r;
  const re = regexOf(p, "g");
  if (isError(re)) return re;
  return t.replace(re, r);
};

/** TEXTBEFORE / TEXTAFTER (text, delimiter, [instance]). A negative instance
    counts from the end. #N/A when the delimiter is not there. */
function around(args: Node[], ctx: FnContext, side: "before" | "after"): ScalarValue {
  const bad = argCount(args, 2, 3);
  if (bad) return bad;
  const t = text(args[0], ctx);
  if (isError(t)) return t;
  const d = text(args[1], ctx);
  if (isError(d)) return d;
  let instance = 1;
  if (args.length === 3) {
    const n = num(args[2], ctx);
    if (isError(n)) return n;
    instance = Math.trunc(n);
  }
  if (d === "" || instance === 0) return VALUE;
  const positions: number[] = [];
  let from = 0;
  for (;;) {
    const i = t.indexOf(d, from);
    if (i === -1) break;
    positions.push(i);
    from = i + d.length;
  }
  const idx = instance > 0 ? instance - 1 : positions.length + instance;
  if (idx < 0 || idx >= positions.length) return NA;
  const at = positions[idx];
  return side === "before" ? t.slice(0, at) : t.slice(at + d.length);
}

const TEXTBEFORE: Fn = (args, ctx) => around(args, ctx, "before");
const TEXTAFTER: Fn = (args, ctx) => around(args, ctx, "after");

/** NUMBERVALUE(text, [decimal_separator], [group_separator]). */
const NUMBERVALUE: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 3);
  if (bad) return bad;
  const t = text(args[0], ctx);
  if (isError(t)) return t;
  let dec = ".";
  let grp = ",";
  if (args.length >= 2) {
    const d = text(args[1], ctx);
    if (isError(d)) return d;
    if (d) dec = d[0];
  }
  if (args.length >= 3) {
    const g = text(args[2], ctx);
    if (isError(g)) return g;
    if (g) grp = g[0];
  }
  if (dec === grp) return VALUE;
  let s = t.replace(/\s+/g, "");
  if (s === "") return 0;
  let percent = 0;
  while (s.endsWith("%")) {
    percent++;
    s = s.slice(0, -1);
  }
  s = s.split(grp).join("");
  s = s.replace(dec, ".");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return VALUE;
  return Number(s) / Math.pow(100, percent);
};

function grouped(n: number, decimals: number, useGrouping: boolean): string {
  const fixed = Math.abs(n).toFixed(Math.max(0, decimals));
  if (!useGrouping) return (n < 0 ? "-" : "") + fixed;
  const [whole, frac] = fixed.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (n < 0 ? "-" : "") + withCommas + (frac !== undefined ? "." + frac : "");
}

/** FIXED(number, [decimals], [no_commas]); a negative decimals rounds left of
    the point, as in the original. */
const FIXED: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 3);
  if (bad) return bad;
  const n = num(args[0], ctx);
  if (isError(n)) return n;
  let decimals = 2;
  if (args.length >= 2) {
    const d = num(args[1], ctx);
    if (isError(d)) return d;
    decimals = Math.trunc(d);
  }
  let noCommas = false;
  if (args.length >= 3) {
    const b = toBoolean(ctx.eval(args[2]));
    if (isError(b)) return b;
    noCommas = b;
  }
  const value = decimals < 0 ? Math.round(n / Math.pow(10, -decimals)) * Math.pow(10, -decimals) : n;
  return grouped(value, decimals, !noCommas);
};

/** DOLLAR(number, [decimals]) — "$1,234.57"; negatives in brackets. */
const DOLLAR: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 2);
  if (bad) return bad;
  const n = num(args[0], ctx);
  if (isError(n)) return n;
  let decimals = 2;
  if (args.length === 2) {
    const d = num(args[1], ctx);
    if (isError(d)) return d;
    decimals = Math.trunc(d);
  }
  const value = decimals < 0 ? Math.round(n / Math.pow(10, -decimals)) * Math.pow(10, -decimals) : n;
  const body = grouped(Math.abs(value), decimals, true);
  return value < 0 ? `($${body})` : `$${body}`;
};

/** ENCODEURL(text): percent-encoding for a query-string value. */
const ENCODEURL: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const t = text(args[0], ctx);
  if (isError(t)) return t;
  return encodeURIComponent(t);
};

/** HYPERLINK(url, [label]): shows the label (the address when there is none).
    The cell's own link is set from Insert ▸ Link; this is the text side. */
const HYPERLINK: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 2);
  if (bad) return bad;
  const url = text(args[0], ctx);
  if (isError(url)) return url;
  if (args.length === 2) {
    const v = ctx.eval(args[1]);
    if (isError(v)) return v;
    if (isBlank(v)) return url;
    return isArray(v) ? v.first : v;
  }
  return url;
};

/** LENB/LEFTB-style byte counting is not a distinction here; ASC and WIDECHAR
    are identity, as they are for Latin text. */
const ASC: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  return text(args[0], ctx);
};

/** VALUE-like helper exported for the TEXT tests: a number as the sheet shows it. */
export function plain(n: number): string {
  return formatNumber(n);
}

export const TEXT_EXTRA_FUNCTIONS: Record<string, Fn> = {
  PROPER, REPT, EXACT, CHAR, CODE, UNICHAR, UNICODE, CLEAN, REPLACE, TEXTJOIN, JOIN, CONCAT, SPLIT,
  REGEXMATCH, REGEXEXTRACT, REGEXREPLACE, TEXTBEFORE, TEXTAFTER, NUMBERVALUE, FIXED, DOLLAR,
  ENCODEURL, HYPERLINK, ASC,
};
