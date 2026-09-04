/**
 * The evaluator — walk an AST to a value.
 *
 * It reads cells through a context rather than knowing what a sheet is, so it
 * stays independent of the workbook and the UI (the engine supplies the
 * context). Errors are values: an error in an operand propagates unless a
 * function catches it. Comparison follows the spreadsheet's cross-type ordering
 * (number < text < boolean), with blanks taking the other side's type. `&`
 * concatenates via text coercion (blank → "", numbers/booleans by their display
 * text). Arithmetic that overflows to a non-finite number is #NUM!, and unary
 * `+` is an identity that passes any operand through untouched — both as Sheets
 * and Excel define them.
 */

import type { BinaryOp, Node, RangeNode, RefNode } from "./ast";
import { DIV0, FormulaError, NAME, NUM, VALUE, isError } from "./errors";
import type { ErrorCode } from "./errors";
import { BLANK, isArray, isBlank, toNumber, toText, type ScalarValue } from "./value";
import { FUNCTIONS } from "./functions/index";

/** How the evaluator reaches cells — one at a time, on a named sheet or (when
    `sheet` is undefined) the formula's own sheet. */
export interface EvalContext {
  resolveCell(sheet: string | undefined, row: number, col: number): ScalarValue;
  /** A named range's target — a ref or range node — or null when no such
      name is defined. Absent contexts have no names at all. */
  resolveRangeName?(name: string): RefNode | RangeNode | null;
  /** The cell whose formula is being evaluated — for ROW(), COLUMN() and the
      like. Absent for an ad-hoc rule evaluation. */
  cell?: { sheet: string; row: number; col: number };
}

/** What a function receives — the ability to evaluate its argument nodes, and to
    read a range (or an array-returning argument) as values. */
export interface FnContext {
  eval(node: Node): ScalarValue;
  /** A range → its cell values (row-major); an array argument → its elements;
      any other node → its single value. */
  collect(node: Node): ScalarValue[];
  /** A range → its cells as a 2-D grid (rows × columns); an array argument → its
      grid; any other node → a 1×1 grid. Lookup and array functions need the
      shape, not just a flat list. */
  matrix(node: Node): ScalarValue[][];
  /** The cell being evaluated, when there is one (see `EvalContext.cell`). */
  cell?: { sheet: string; row: number; col: number };
}

/** A finite number passes; overflow to ±Infinity (or NaN) is #NUM!. */
function finite(n: number): number | FormulaError {
  return Number.isFinite(n) ? n : NUM;
}

export function evaluate(node: Node, ctx: EvalContext): ScalarValue {
  switch (node.type) {
    case "number":
      /* A literal too large for a double (`=1E309`) is already #NUM!. */
      return finite(node.value);
    case "string":
      return node.value;
    case "boolean":
      return node.value;
    case "blank":
      /* An omitted argument — a blank, exactly like an empty cell. */
      return BLANK;
    case "error":
      return new FormulaError(node.code as ErrorCode);
    case "ref":
      return ctx.resolveCell(node.sheet, node.row, node.col);
    case "range":
      /* A range only means something as a function argument. */
      return VALUE;
    case "name": {
      const target = deref(node, ctx);
      return target.type === "name" ? NAME : evaluate(target, ctx);
    }
    case "unary": {
      const v = evaluate(node.operand, ctx);
      if (isError(v)) return v;
      /* Unary + is an identity: it returns its operand untouched, whatever the
         type — `=+"abc"` is "abc", `=+TRUE` is TRUE (Sheets/Excel). */
      if (node.op === "+") return v;
      const n = toNumber(v);
      if (isError(n)) return n;
      return finite(-n);
    }
    case "percent": {
      const v = toNumber(evaluate(node.operand, ctx));
      if (isError(v)) return v;
      return v / 100;
    }
    case "binary":
      return evalBinary(node.op, node.left, node.right, ctx);
    case "call": {
      const fn = FUNCTIONS[node.name];
      if (!fn) return NAME;
      /* A named range is handed to the function as the range it names, so
         every function that inspects its argument's shape sees a range. */
      return fn(node.args.map((a) => deref(a, ctx)), fnContext(ctx));
    }
  }
}

/** A name node replaced by what it names; any other node as it is. A name
    that resolves to nothing stays a name node, which evaluates to #NAME?. */
function deref(node: Node, ctx: EvalContext): Node {
  if (node.type !== "name") return node;
  return ctx.resolveRangeName?.(node.name) ?? node;
}

function rangeMatrix(node: Node & { type: "range" }, ctx: EvalContext): ScalarValue[][] {
  const { start, end, sheet } = node;
  const r0 = Math.min(start.row, end.row);
  const r1 = Math.max(start.row, end.row);
  const c0 = Math.min(start.col, end.col);
  const c1 = Math.max(start.col, end.col);
  const grid: ScalarValue[][] = [];
  for (let r = r0; r <= r1; r++) {
    const row: ScalarValue[] = [];
    for (let c = c0; c <= c1; c++) row.push(ctx.resolveCell(sheet, r, c));
    grid.push(row);
  }
  return grid;
}

function fnContext(ctx: EvalContext): FnContext {
  return {
    eval: (node) => evaluate(node, ctx),
    collect: (raw) => {
      const node = deref(raw, ctx);
      if (node.type === "range") return rangeMatrix(node, ctx).flat();
      const v = evaluate(node, ctx);
      return isArray(v) ? v.flat() : [v];
    },
    matrix: (raw) => {
      const node = deref(raw, ctx);
      if (node.type === "range") return rangeMatrix(node, ctx);
      const v = evaluate(node, ctx);
      return isArray(v) ? v.rows : [[v]];
    },
    cell: ctx.cell,
  };
}

function evalBinary(op: BinaryOp, leftNode: Node, rightNode: Node, ctx: EvalContext): ScalarValue {
  if (op === "=" || op === "<>" || op === "<" || op === ">" || op === "<=" || op === ">=") {
    const left = evaluate(leftNode, ctx);
    if (isError(left)) return left;
    const right = evaluate(rightNode, ctx);
    if (isError(right)) return right;
    return compare(op, left, right);
  }
  if (op === "&") {
    /* Concatenation coerces both sides to text: blank → "", numbers and
       booleans by their display text. Errors propagate left-to-right. */
    const a = toText(evaluate(leftNode, ctx));
    if (isError(a)) return a;
    const b = toText(evaluate(rightNode, ctx));
    if (isError(b)) return b;
    return a + b;
  }
  const a = toNumber(evaluate(leftNode, ctx));
  if (isError(a)) return a;
  const b = toNumber(evaluate(rightNode, ctx));
  if (isError(b)) return b;
  switch (op) {
    case "+":
      return finite(a + b);
    case "-":
      return finite(a - b);
    case "*":
      return finite(a * b);
    case "/":
      return b === 0 ? DIV0 : finite(a / b);
    case "^":
      return finite(Math.pow(a, b));
  }
  return VALUE;
}

type Comparable = number | string | boolean;

/** A blank takes the type of whatever it is compared with. */
function resolveBlank(value: ScalarValue, other: ScalarValue): Comparable {
  if (!isBlank(value)) return value as Comparable;
  if (typeof other === "string") return "";
  if (typeof other === "boolean") return false;
  return 0;
}

function rank(value: Comparable): number {
  if (typeof value === "number") return 0;
  if (typeof value === "string") return 1;
  return 2; // boolean sorts after text, as in a spreadsheet
}

function compare(op: BinaryOp, aRaw: ScalarValue, bRaw: ScalarValue): boolean | FormulaError {
  const a = resolveBlank(aRaw, bRaw);
  const b = resolveBlank(bRaw, aRaw);
  let c: number;
  if (rank(a) !== rank(b)) {
    c = rank(a) < rank(b) ? -1 : 1;
  } else if (typeof a === "number" && typeof b === "number") {
    c = a < b ? -1 : a > b ? 1 : 0;
  } else if (typeof a === "boolean" && typeof b === "boolean") {
    c = (a ? 1 : 0) - (b ? 1 : 0);
  } else {
    const sa = String(a).toUpperCase();
    const sb = String(b).toUpperCase();
    c = sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  switch (op) {
    case "=":
      return c === 0;
    case "<>":
      return c !== 0;
    case "<":
      return c < 0;
    case ">":
      return c > 0;
    case "<=":
      return c <= 0;
    case ">=":
      return c >= 0;
  }
  return VALUE;
}
