/**
 * The abstract syntax tree a formula parses into.
 *
 * The evaluator walks this — never the source text — which is the whole reason
 * for a real parser rather than string replacement: `=IF(SUM(A1:A10)>100,…)` is
 * a tree of a call whose argument is a comparison whose operand is a call, and
 * only a tree evaluates that correctly.
 */

import type { ErrorCode } from "./errors";

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "^"
  | "="
  | "<>"
  | "<"
  | ">"
  | "<="
  | ">=";

/** A cell reference. The `abs` flags carry `$` anchoring. `sheet` is the name
    from a cross-sheet qualifier (`Sheet2!A1`); absent means the formula's own
    sheet. It is the NAME, not an id — the engine resolves it, so a rename that
    rewrites the name keeps the reference pointing at the same sheet. */
export interface RefNode {
  type: "ref";
  row: number;
  col: number;
  absRow: boolean;
  absCol: boolean;
  sheet?: string;
}

export interface RangeNode {
  type: "range";
  start: RefNode;
  end: RefNode;
  sheet?: string;
}

export type Node =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  /** A literal error, e.g. the `#REF!` a deleted reference leaves behind. */
  | { type: "error"; code: ErrorCode }
  | RefNode
  | RangeNode
  | { type: "unary"; op: "-" | "+"; operand: Node }
  | { type: "percent"; operand: Node }
  | { type: "binary"; op: BinaryOp; left: Node; right: Node }
  | { type: "call"; name: string; args: Node[] };
