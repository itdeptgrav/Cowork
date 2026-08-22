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

/**
 * The booleans AND/OR/XOR actually see. A RANGE contributes its boolean and
 * numeric cells; blanks are skipped, and text cells that do not read as
 * TRUE/FALSE are IGNORED rather than erroring — the Sheets rule for logical
 * aggregation over a range. A DIRECT argument is coerced strictly, so a text
 * literal that is not TRUE/FALSE is still #VALUE!. The first error propagates.
 */
function booleanArgs(args: Node[], ctx: FnContext): boolean[] | ScalarValue {
  const out: boolean[] = [];
  for (const arg of args) {
    const fromRange = arg.type === "range";
    const vals = fromRange ? ctx.collect(arg) : [ctx.eval(arg)];
    for (const v of vals) {
      if (isError(v)) return v;
      if (isBlank(v)) continue;
      const b = toBoolean(v);
      if (isError(b)) {
        if (fromRange && typeof v === "string") continue; // text in a range is skipped
        return b;
      }
      out.push(b);
    }
  }
  return out.length === 0 ? VALUE : out;
}

const AND: Fn = (args, ctx) => {
  const bools = booleanArgs(args, ctx);
  return Array.isArray(bools) ? bools.every(Boolean) : bools;
};
const OR: Fn = (args, ctx) => {
  const bools = booleanArgs(args, ctx);
  return Array.isArray(bools) ? bools.some(Boolean) : bools;
};

/** True when an ODD number of arguments are true. */
const XOR: Fn = (args, ctx) => {
  const bools = booleanArgs(args, ctx);
  if (!Array.isArray(bools)) return bools;
  return bools.filter(Boolean).length % 2 === 1;
};

const NOT: Fn = (args, ctx) => {
  const bad = argCount(args, 1);
  if (bad) return bad;
  const b = toBoolean(ctx.eval(args[0]));
  return isError(b) ? b : !b;
};

/** The fallback is optional: IFERROR(x) shows empty text when x errors. */
const IFERROR: Fn = (args, ctx) => {
  const bad = argCount(args, 1, 2);
  if (bad) return bad;
  const v = ctx.eval(args[0]);
  if (!isError(v)) return v;
  return args.length === 2 ? ctx.eval(args[1]) : "";
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

/* TRUE() and FALSE() are real zero-argument functions in Sheets and Excel
   (exported XLSX files spell the literals this way), so the parser routes
   `TRUE()` here while a bare `TRUE` stays a literal. */
const TRUE_FN: Fn = (args) => argCount(args, 0) ?? true;
const FALSE_FN: Fn = (args) => argCount(args, 0) ?? false;

export const LOGICAL_FUNCTIONS: Record<string, Fn> = {
  IF,
  AND,
  OR,
  XOR,
  NOT,
  IFERROR,
  IFS,
  SWITCH,
  TRUE: TRUE_FN,
  FALSE: FALSE_FN,
};
