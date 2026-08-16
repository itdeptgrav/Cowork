/**
 * The evaluator — walk an AST to a value.
 *
 * It reads cells through a context rather than knowing what a sheet is, so it
 * stays independent of the workbook and the UI (the engine supplies the
 * context). Errors are values: an error in an operand propagates unless a
 * function catches it. Comparison follows the spreadsheet's cross-type ordering
 * (number < text < boolean), with blanks taking the other side's type.
 */

import type { BinaryOp, Node } from "./ast";
import { DIV0, FormulaError, NAME, NUM, VALUE, isError } from "./errors";
import type { ErrorCode } from "./errors";
import { isArray, isBlank, toNumber, type ScalarValue } from "./value";
import { FUNCTIONS } from "./functions/index";

/** How the evaluator reaches cells — one at a time, on a named sheet or (when
    `sheet` is undefined) the formula's own sheet. */
export interface EvalContext {
  resolveCell(sheet: string | undefined, row: number, col: number): ScalarValue;
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
}

export function evaluate(node: Node, ctx: EvalContext): ScalarValue {
  switch (node.type) {
    case "number":
      return node.value;
    case "string":
      return node.value;
    case "boolean":
      return node.value;
    case "error":
      return new FormulaError(node.code as ErrorCode);
    case "ref":
      return ctx.resolveCell(node.sheet, node.row, node.col);
    case "range":
      /* A range only means something as a function argument. */
      return VALUE;
    case "unary": {
      const v = toNumber(evaluate(node.operand, ctx));
      if (isError(v)) return v;
      return node.op === "-" ? -v : v;
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
      return fn(node.args, fnContext(ctx));
    }
  }
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
    collect: (node) => {
      if (node.type === "range") return rangeMatrix(node, ctx).flat();
      const v = evaluate(node, ctx);
      return isArray(v) ? v.flat() : [v];
    },
    matrix: (node) => {
      if (node.type === "range") return rangeMatrix(node, ctx);
      const v = evaluate(node, ctx);
      return isArray(v) ? v.rows : [[v]];
    },
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
  const a = toNumber(evaluate(leftNode, ctx));
  if (isError(a)) return a;
  const b = toNumber(evaluate(rightNode, ctx));
  if (isError(b)) return b;
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return b === 0 ? DIV0 : a / b;
    case "^": {
      const r = Math.pow(a, b);
      return Number.isFinite(r) ? r : NUM;
    }
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
