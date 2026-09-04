/**
 * More lookup and array functions — position (ROW, COLUMN, ROWS, COLUMNS),
 * choosing (CHOOSE, LOOKUP, XMATCH), addresses, and the shape functions
 * (TRANSPOSE, SEQUENCE, SORTBY, FLATTEN).
 *
 * ROW() and COLUMN() with no argument answer for the cell holding the
 * formula — the engine passes it in — and with a reference answer for that
 * reference's top-left cell, as the originals do when nothing spills.
 *
 * INDIRECT and OFFSET are deliberately absent: they would read cells the
 * dependency graph cannot see, so a change to their target would not
 * recalculate them. A formula that is sometimes stale is worse than one
 * that is missing, and both have an INDEX/MATCH form that is not.
 */

import { NA, REF, VALUE, isError, type FormulaError } from "../errors";
import { ArrayValue, isArray, isBlank, toNumber, toText, type ScalarValue } from "../value";
import type { Node } from "../ast";
import type { FnContext } from "../evaluator";
import { argCount, compareValues, valuesEqual, wildcardToRegExp, type Fn } from "./types";

function num(node: Node, ctx: FnContext): number | FormulaError {
  return toNumber(ctx.eval(node));
}

/** The top-left cell of a reference or range argument, 0-based, or null. */
function anchorOf(node: Node): { row: number; col: number } | null {
  if (node.type === "ref") return { row: node.row, col: node.col };
  if (node.type === "range") {
    return { row: Math.min(node.start.row, node.end.row), col: Math.min(node.start.col, node.end.col) };
  }
  return null;
}

const ROW: Fn = (args, ctx) => {
  const bad = argCount(args, 0, 1);
  if (bad) return bad;
  if (args.length === 0) return ctx.cell ? ctx.cell.row + 1 : VALUE;
  const a = anchorOf(args[0]);
  return a ? a.row + 1 : VALUE;
};

const COLUMN: Fn = (args, ctx) => {
  const bad = argCount(args, 0, 1);
  if (bad) return bad;
  if (args.length === 0) return ctx.cell ? ctx.cell.col + 1 : VALUE;
  const a = anchorOf(args[0]);
  return a ? a.col + 1 : VALUE;
};

const ROWS: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  return ctx.matrix(args[0]).length;
};

const COLUMNS: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  return ctx.matrix(args[0])[0]?.length ?? 0;
};

/** CHOOSE(index, value1, value2, …): the index-th value, evaluated lazily. */
const CHOOSE: Fn = (args, ctx) => {
  if (args.length < 2) return VALUE;
  const i = num(args[0], ctx);
  if (isError(i)) return i;
  const k = Math.trunc(i);
  if (k < 1 || k > args.length - 1) return VALUE;
  const node = args[k];
  if (node.type === "range") {
    const m = ctx.matrix(node);
    return new ArrayValue(m);
  }
  return ctx.eval(node);
};

/** LOOKUP(value, lookup_vector, [result_vector]): the largest entry ≤ value,
    the vector assumed sorted; the result from the parallel vector. */
const LOOKUP: Fn = (args, ctx) => {
  const bad = argCount(args, 2, 3);
  if (bad) return bad;
  const value = ctx.eval(args[0]);
  if (isError(value)) return value;
  const lookupM = ctx.matrix(args[1]);
  let vector: ScalarValue[];
  let results: ScalarValue[];
  if (args.length === 3) {
    vector = lookupM.flat();
    results = ctx.matrix(args[2]).flat();
  } else if (lookupM.length >= (lookupM[0]?.length ?? 0)) {
    /* A tall (or square) array: search the first column, answer from the last. */
    vector = lookupM.map((r) => r[0]);
    results = lookupM.map((r) => r[r.length - 1]);
  } else {
    vector = lookupM[0];
    results = lookupM[lookupM.length - 1];
  }
  let best = -1;
  for (let i = 0; i < vector.length; i++) {
    if (isBlank(vector[i])) continue;
    if (compareValues(vector[i], value) <= 0) best = i;
    else break;
  }
  if (best === -1) return NA;
  return results[best] ?? NA;
};

/** XMATCH(value, range, [match_mode], [search_mode]): 0 exact, -1 exact or next
    smaller, 1 exact or next larger, 2 wildcard; search_mode -1 searches from
    the end. */
const XMATCH: Fn = (args, ctx) => {
  const bad = argCount(args, 2, 4);
  if (bad) return bad;
  const value = ctx.eval(args[0]);
  if (isError(value)) return value;
  const vector = ctx.matrix(args[1]).flat();
  let mode = 0;
  if (args.length >= 3) {
    const m = num(args[2], ctx);
    if (isError(m)) return m;
    mode = Math.trunc(m);
  }
  let fromEnd = false;
  if (args.length === 4) {
    const s = num(args[3], ctx);
    if (isError(s)) return s;
    fromEnd = s < 0;
  }
  const order = vector.map((_, i) => i);
  if (fromEnd) order.reverse();
  if (mode === 2) {
    const re = wildcardToRegExp(String(isArray(value) ? value.first : value));
    for (const i of order) if (typeof vector[i] === "string" && re.test(vector[i] as string)) return i + 1;
    return NA;
  }
  for (const i of order) if (valuesEqual(vector[i], value)) return i + 1;
  if (mode === 0) return NA;
  let best = -1;
  for (let i = 0; i < vector.length; i++) {
    const c = compareValues(vector[i], value);
    if (mode === -1 && c < 0 && (best === -1 || compareValues(vector[i], vector[best]) > 0)) best = i;
    if (mode === 1 && c > 0 && (best === -1 || compareValues(vector[i], vector[best]) < 0)) best = i;
  }
  return best === -1 ? NA : best + 1;
};

function columnLabel(col: number): string {
  let n = col;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** ADDRESS(row, col, [abs_type], [a1], [sheet]): abs 1 $A$1, 2 A$1, 3 $A1, 4 A1. */
const ADDRESS: Fn = (args, ctx) => {
  const bad = argCount(args, 2, 5);
  if (bad) return bad;
  const r = num(args[0], ctx);
  if (isError(r)) return r;
  const c = num(args[1], ctx);
  if (isError(c)) return c;
  let abs = 1;
  if (args.length >= 3) {
    const v = ctx.eval(args[2]);
    if (!isBlank(v)) {
      const a = toNumber(v);
      if (isError(a)) return a;
      abs = Math.trunc(a);
    }
  }
  if (args.length >= 4) {
    const v = ctx.eval(args[3]);
    if (!isBlank(v) && !isError(v) && (v === false || v === 0)) return VALUE; // R1C1 is not supported
  }
  const row = Math.trunc(r);
  const col = Math.trunc(c);
  if (row < 1 || col < 1 || abs < 1 || abs > 4) return VALUE;
  const rowAbs = abs === 1 || abs === 2 ? "$" : "";
  const colAbs = abs === 1 || abs === 3 ? "$" : "";
  const cell = `${colAbs}${columnLabel(col)}${rowAbs}${row}`;
  if (args.length === 5) {
    const s = toText(ctx.eval(args[4]));
    if (isError(s)) return s;
    if (s) return (/^[A-Za-z0-9_]+$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`) + "!" + cell;
  }
  return cell;
};

const TRANSPOSE: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const m = ctx.matrix(args[0]);
  const rows = m.length;
  const cols = m[0]?.length ?? 0;
  const out: ScalarValue[][] = [];
  for (let c = 0; c < cols; c++) {
    const row: ScalarValue[] = [];
    for (let r = 0; r < rows; r++) row.push(m[r][c]);
    out.push(row);
  }
  return new ArrayValue(out.length ? out : [[]]);
};

/** SEQUENCE(rows, [cols], [start], [step]): a grid of counting numbers. */
const SEQUENCE: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 4);
  if (bad) return bad;
  const vals: number[] = [];
  const defaults = [1, 1, 1, 1];
  for (let i = 0; i < 4; i++) {
    if (i >= args.length) {
      vals.push(defaults[i]);
      continue;
    }
    const v = ctx.eval(args[i]);
    if (isBlank(v)) {
      vals.push(defaults[i]);
      continue;
    }
    const n = toNumber(v);
    if (isError(n)) return n;
    vals.push(n);
  }
  const [rows, cols, start, step] = vals.map((v, i) => (i < 2 ? Math.trunc(v) : v));
  if (rows < 1 || cols < 1 || rows * cols > 100_000) return VALUE;
  const out: ScalarValue[][] = [];
  let k = 0;
  for (let r = 0; r < rows; r++) {
    const row: ScalarValue[] = [];
    for (let c = 0; c < cols; c++) row.push(start + step * k++);
    out.push(row);
  }
  return new ArrayValue(out);
};

/** SORTBY(range, by_range, [order]): rows of `range` ordered by `by_range`;
    order 1 ascending (default), -1 descending. */
const SORTBY: Fn = (args, ctx) => {
  const bad = argCount(args, 2, 3);
  if (bad) return bad;
  const m = ctx.matrix(args[0]);
  const by = ctx.matrix(args[1]).flat();
  if (by.length !== m.length) return VALUE;
  let dir = 1;
  if (args.length === 3) {
    const o = num(args[2], ctx);
    if (isError(o)) return o;
    dir = o < 0 ? -1 : 1;
  }
  const order = m.map((_, i) => i).sort((a, b) => dir * compareValues(by[a], by[b]) || a - b);
  return new ArrayValue(order.map((i) => m[i]));
};

/** FLATTEN(range1, …): every value in one column, in order. */
const FLATTEN: Fn = (args, ctx) => {
  if (args.length === 0) return VALUE;
  const out: ScalarValue[][] = [];
  for (const a of args) for (const v of ctx.collect(a)) out.push([v]);
  return new ArrayValue(out.length ? out : [[]]);
};

/** ISREF-style guard used by the tests: a reference that names a missing
    sheet resolves to #REF!, which this exposes for a readable assertion. */
export const MISSING_SHEET = REF;

export const LOOKUP_EXTRA_FUNCTIONS: Record<string, Fn> = {
  ROW, COLUMN, ROWS, COLUMNS, CHOOSE, LOOKUP, XMATCH, ADDRESS, TRANSPOSE, SEQUENCE, SORTBY, FLATTEN,
};
