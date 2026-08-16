/**
 * Spreadsheet errors — the values a formula returns when it cannot produce one.
 *
 * These are real values that flow through the evaluator like any number or
 * string: an error in an argument propagates to the result unless a function
 * (IFERROR) deliberately catches it. Each carries one of the standard codes a
 * spreadsheet shows in the cell.
 */

export type ErrorCode =
  | "#DIV/0!"
  | "#VALUE!"
  | "#REF!"
  | "#NAME?"
  | "#N/A"
  | "#NUM!";

export class FormulaError {
  readonly kind = "error" as const;
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    this.code = code;
  }
}

export const DIV0 = new FormulaError("#DIV/0!");
export const VALUE = new FormulaError("#VALUE!");
/** Also what a circular reference resolves to, matching Google Sheets. */
export const REF = new FormulaError("#REF!");
export const NAME = new FormulaError("#NAME?");
export const NA = new FormulaError("#N/A");
export const NUM = new FormulaError("#NUM!");

export function isError(value: unknown): value is FormulaError {
  return value instanceof FormulaError;
}
