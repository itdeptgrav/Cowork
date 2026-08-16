/**
 * Logical functions.
 *
 * Each controls its own evaluation so it takes only the branch it needs: IF and
 * IFS stop at the first true condition, SWITCH at the first matching case, and
 * an error in a chosen branch propagates while an unchosen one is never touched.
 */

import type { Node } from "../ast";
import type { FnContext } from "../evaluator";
import { NA, VALUE, isError } from "../errors";
import { isBlank, toBoolean, type ScalarValue } from "../value";
import { argCount, valuesEqual, type Fn } from "./types";

const IF: Fn = (args, ctx) => {
  const bad = argCount(args, 2, 3);
  if (bad) return bad;
  const cond = toBoolean(ctx.eval(args[0]));
  if (isError(cond)) return cond;
  if (cond) return ctx.eval(args[1]);
  return args.length === 3 ? ctx.eval(args[2]) : false;
};

function booleanReduce(
  args: Node[],
  ctx: FnContext,
  combine: (acc: boolean, next: boolean) => boolean,
  seed: boolean,
): ScalarValue {
  let acc = seed;
  let sawAny = false;
  for (const arg of args) {
    const vals = arg.type === "range" ? ctx.collect(arg) : [ctx.eval(arg)];
    for (const v of vals) {
      if (isError(v)) return v;
      if (isBlank(v)) continue;
      const b = toBoolean(v);
      if (isError(b)) return b;
      sawAny = true;
      acc = combine(acc, b);
    }
  }
  return sawAny ? acc : VALUE;
}

const AND: Fn = (args, ctx) => booleanReduce(args, ctx, (a, b) => a && b, true);
const OR: Fn = (args, ctx) => booleanReduce(args, ctx, (a, b) => a || b, false);

/** True when an ODD number of arguments are true. */
const XOR: Fn = (args, ctx) => {
  let trues = 0;
  let sawAny = false;
  for (const arg of args) {
    const vals = arg.type === "range" ? ctx.collect(arg) : [ctx.eval(arg)];
    for (const v of vals) {
      if (isError(v)) return v;
      if (isBlank(v)) continue;
      const b = toBoolean(v);
      if (isError(b)) return b;
      sawAny = true;
      if (b) trues += 1;
    }
  }
  return sawAny ? trues % 2 === 1 : VALUE;
};

const NOT: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const b = toBoolean(ctx.eval(args[0]));
  return isError(b) ? b : !b;
};

const IFERROR: Fn = (args, ctx) => {
  const bad = argCount(args, 2);
  if (bad) return bad;
  const v = ctx.eval(args[0]);
  return isError(v) ? ctx.eval(args[1]) : v;
};

/** Pairs of (condition, value); the first true condition's value, else #N/A. */
const IFS: Fn = (args, ctx) => {
  if (args.length < 2 || args.length % 2 !== 0) return VALUE;
  for (let i = 0; i < args.length; i += 2) {
    const cond = toBoolean(ctx.eval(args[i]));
    if (isError(cond)) return cond;
    if (cond) return ctx.eval(args[i + 1]);
  }
  return NA;
};

/**
 * SWITCH(expr, case1, result1, …, [default]) — the first case equal to `expr`
 * gives its result; a lone trailing argument is the default, else #N/A.
 */
const SWITCH: Fn = (args, ctx) => {
  if (args.length < 3) return VALUE;
  const subject = ctx.eval(args[0]);
  if (isError(subject)) return subject;
  let i = 1;
  for (; i + 1 < args.length; i += 2) {
    const candidate = ctx.eval(args[i]);
    if (isError(candidate)) return candidate;
    if (valuesEqual(subject, candidate)) return ctx.eval(args[i + 1]);
  }
  /* A leftover argument is the default. */
  return i < args.length ? ctx.eval(args[i]) : NA;
};

export const LOGICAL_FUNCTIONS: Record<string, Fn> = {
  IF,
  AND,
  OR,
  XOR,
  NOT,
  IFERROR,
  IFS,
  SWITCH,
};
