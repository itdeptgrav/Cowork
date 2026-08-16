/**
 * The formula engine — tokenizer → parser → AST → evaluator, with a workbook
 * engine on top for dependency-tracked, incremental recalculation.
 *
 * Nothing here imports React or the sheet UI; the engine speaks (row, col) and
 * values, and the UI reads its `display`.
 */

export * from "./errors";
export * from "./value";
export type { Node, BinaryOp, RefNode, RangeNode } from "./ast";
export { tokenize, type Token } from "./tokenizer";
export { parse, ParseError } from "./parser";
export { evaluate, type EvalContext } from "./evaluator";
export { FUNCTIONS } from "./functions/index";
export { FormulaEngine, type CellDisplay } from "./engine";
export { adjustFormula, shiftReference } from "./references";
export {
  transformStructural,
  type StructuralOp,
  type StructuralAxis,
  type StructuralMode,
} from "./rewrite";
export { renameSheetInFormula, renderSheetPrefix, sheetNeedsQuote } from "./sheets";
export { compareValues } from "./functions/types";
