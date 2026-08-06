/**
 * Turning what Gemini proposed into something safe to apply to a sheet — or
 * refusing it. The Sheets half of the pair with
 * `lib/rules/documents/aiTools.ts`; see that file's header for why this
 * validation exists as a second, independent pass rather than trusting the
 * backend's own tool-name check.
 *
 * Every validator here takes the CURRENT sheet, not just the raw arguments —
 * a range or a column has to be checked against the sheet it would actually
 * apply to, not just against its own schema. `A1:Z9999` is a syntactically
 * valid range and a wildly unsafe one on a 20-column sheet.
 */

import {
  cellRef,
  columnIndex,
  columnLabel,
  inRect,
  parseRef,
  rangeToRect,
  type CellStyle,
  type ChartType,
  type ConditionalKind,
  type Rect,
  type SheetData,
} from "./grid.ts";
import type { FilterCondition } from "./grid.ts";

const MAX_SET_CELLS = 500;
const MAX_STRUCTURAL_COUNT = 500;
const MAX_TABLE_ROWS = 500;
const MAX_TABLE_COLS = 50;
const MAX_TITLE_LENGTH = 120;

const CHART_TYPES: ChartType[] = ["column", "bar", "line", "area", "pie", "doughnut", "scatter", "combo"];
const CONDITIONAL_KINDS: ConditionalKind[] = [
  "greater",
  "less",
  "equal",
  "between",
  "textContains",
  "blank",
  "notBlank",
  "duplicate",
  "unique",
  "top",
  "bottom",
  "aboveAvg",
  "belowAvg",
  "colorScale",
];
/** Which `ConditionalKind`s need which numeric/text arguments — checked so a rule that can never match isn't applied silently. */
const CONDITIONAL_NEEDS: Partial<Record<ConditionalKind, ("value" | "value2" | "text")[]>> = {
  greater: ["value"],
  less: ["value"],
  equal: ["value"],
  between: ["value", "value2"],
  textContains: ["text"],
  top: ["value"],
  bottom: ["value"],
};

export type SheetsAiAction =
  | { tool: "set_cells"; cells: { ref: string; value: string }[] }
  | { tool: "insert_rows"; atRow: number; count: number }
  | { tool: "delete_rows"; atRow: number; count: number }
  | { tool: "insert_columns"; atCol: number; count: number }
  | { tool: "delete_columns"; atCol: number; count: number }
  | { tool: "create_table"; anchor: string; headers: string[]; rows: string[][] }
  | { tool: "set_formula"; ref: string; formula: string; explanation: string }
  | { tool: "format_range"; rect: Rect; style: CellStyle }
  | { tool: "sort_range"; rect: Rect; byCol: number; direction: "asc" | "desc"; hasHeaderRow: boolean }
  | {
      tool: "filter_range";
      rect: Rect;
      byCol: number;
      condition: FilterCondition;
      value: string;
      hasHeaderRow: boolean;
    }
  | {
      tool: "apply_conditional_format";
      rect: Rect;
      kind: ConditionalKind;
      value?: number;
      value2?: number;
      text?: string;
      color?: string;
    }
  | { tool: "create_chart"; rect: Rect; chartType: ChartType; title: string }
  | { tool: "rename_sheet"; title: string }
  | { tool: "flag_outliers"; rect: Rect; flags: { ref: string; reason: string }[] };

function str(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  return typeof v === "string" ? v : null;
}
function int(args: Record<string, unknown>, key: string): number | null {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

function rectInBounds(rect: Rect, sheet: SheetData): boolean {
  return rect.top >= 0 && rect.left >= 0 && rect.bottom < sheet.rows && rect.right < sheet.cols;
}

function parseCellStyle(raw: unknown): CellStyle | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const style: CellStyle = {};
  if (typeof o.bold === "boolean") style.bold = o.bold;
  if (typeof o.italic === "boolean") style.italic = o.italic;
  if (typeof o.underline === "boolean") style.underline = o.underline;
  if (o.align === "left" || o.align === "center" || o.align === "right") style.align = o.align;
  if (typeof o.color === "string") style.color = o.color;
  if (typeof o.bg === "string") style.bg = o.bg;
  if (o.format === "currency" || o.format === "percent" || o.format === "comma" || o.format === "plain")
    style.format = o.format;
  return Object.keys(style).length > 0 ? style : null;
}

export function validateSheetsToolCall(
  tool: string,
  args: Record<string, unknown>,
  sheet: SheetData,
): { ok: true; action: SheetsAiAction } | { ok: false; message: string } {
  switch (tool) {
    case "set_cells": {
      const raw = args["cells"];
      if (!Array.isArray(raw) || raw.length === 0)
        return { ok: false, message: "The assistant returned no cells to write." };
      if (raw.length > MAX_SET_CELLS)
        return { ok: false, message: `That would write too many cells at once (over ${MAX_SET_CELLS}).` };
      const cells: { ref: string; value: string }[] = [];
      for (const c of raw) {
        if (!c || typeof c !== "object") return { ok: false, message: "The assistant returned a malformed cell." };
        const ref = str(c as Record<string, unknown>, "ref");
        const value = str(c as Record<string, unknown>, "value");
        if (!ref || value === null) return { ok: false, message: "The assistant returned a malformed cell." };
        const pos = parseRef(ref);
        if (!pos || pos.row >= sheet.rows || pos.col >= sheet.cols)
          return { ok: false, message: `"${ref}" is not a valid cell on this sheet.` };
        cells.push({ ref: ref.toUpperCase(), value });
      }
      return { ok: true, action: { tool: "set_cells", cells } };
    }

    case "insert_rows":
    case "delete_rows": {
      const rowArg = tool === "insert_rows" ? "beforeRow" : "startRow";
      const oneBased = int(args, rowArg);
      const count = int(args, "count");
      if (oneBased === null || oneBased < 1)
        return { ok: false, message: "The assistant returned an invalid row number." };
      if (count === null || count < 1 || count > MAX_STRUCTURAL_COUNT)
        return { ok: false, message: `The assistant proposed an invalid row count (must be 1–${MAX_STRUCTURAL_COUNT}).` };
      const atRow = oneBased - 1;
      if (tool === "delete_rows" && atRow + count > sheet.rows)
        return { ok: false, message: "That would delete rows past the end of the sheet." };
      return { ok: true, action: { tool, atRow, count } as SheetsAiAction };
    }

    case "insert_columns":
    case "delete_columns": {
      const colArg = tool === "insert_columns" ? "beforeColumn" : "startColumn";
      const letter = str(args, colArg);
      const count = int(args, "count");
      const atCol = letter ? columnIndex(letter) : -1;
      if (atCol < 0) return { ok: false, message: "The assistant returned an invalid column." };
      if (count === null || count < 1 || count > MAX_STRUCTURAL_COUNT)
        return { ok: false, message: `The assistant proposed an invalid column count (must be 1–${MAX_STRUCTURAL_COUNT}).` };
      if (tool === "delete_columns" && atCol + count > sheet.cols)
        return { ok: false, message: "That would delete columns past the end of the sheet." };
      return { ok: true, action: { tool, atCol, count } as SheetsAiAction };
    }

    case "create_table": {
      const anchor = str(args, "anchor");
      const headers = args["headers"];
      const rows = args["rows"];
      if (!anchor || !parseRef(anchor)) return { ok: false, message: "The assistant returned an invalid table location." };
      if (!Array.isArray(headers) || headers.length === 0 || !headers.every((h) => typeof h === "string"))
        return { ok: false, message: "The assistant returned a table with no headers." };
      if (headers.length > MAX_TABLE_COLS)
        return { ok: false, message: `That table is too wide (over ${MAX_TABLE_COLS} columns).` };
      if (!Array.isArray(rows) || rows.length > MAX_TABLE_ROWS)
        return { ok: false, message: `That table is too tall (over ${MAX_TABLE_ROWS} rows), or has no rows.` };
      const safeRows: string[][] = [];
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== headers.length || !row.every((c) => typeof c === "string"))
          return { ok: false, message: "The assistant returned a malformed table row." };
        safeRows.push(row as string[]);
      }
      const anchorPos = parseRef(anchor)!;
      if (anchorPos.row + safeRows.length + 1 > sheet.rows || anchorPos.col + headers.length > sheet.cols)
        return { ok: false, message: "That table would not fit on this sheet." };
      return { ok: true, action: { tool: "create_table", anchor: anchor.toUpperCase(), headers, rows: safeRows } };
    }

    case "set_formula": {
      const ref = str(args, "ref");
      const formula = str(args, "formula");
      const explanation = str(args, "explanation") ?? "";
      if (!ref || !parseRef(ref)) return { ok: false, message: "The assistant returned an invalid cell reference." };
      if (!formula || !formula.trim().startsWith("="))
        return { ok: false, message: "The assistant's formula didn't start with =." };
      /* A light sanity check, not a parser — HyperFormula is the real judge at
         apply time. Balanced parentheses catches the commonest truncated
         reply without pretending to validate formula grammar here. */
      const opens = (formula.match(/\(/g) ?? []).length;
      const closes = (formula.match(/\)/g) ?? []).length;
      if (opens !== closes)
        return { ok: false, message: "That formula has unbalanced parentheses." };
      return { ok: true, action: { tool: "set_formula", ref: ref.toUpperCase(), formula, explanation } };
    }

    case "format_range": {
      const range = str(args, "range");
      const rect = range ? rangeToRect(range) : null;
      const style = parseCellStyle(args["style"]);
      if (!rect) return { ok: false, message: "The assistant returned an invalid range." };
      if (!rectInBounds(rect, sheet)) return { ok: false, message: "That range is outside this sheet." };
      if (!style) return { ok: false, message: "The assistant proposed formatting with nothing to apply." };
      return { ok: true, action: { tool: "format_range", rect, style } };
    }

    case "sort_range": {
      const range = str(args, "range");
      const rect = range ? rangeToRect(range) : null;
      const byColLetter = str(args, "byColumn");
      const byCol = byColLetter ? columnIndex(byColLetter) : -1;
      const direction = args["direction"] === "desc" ? "desc" : args["direction"] === "asc" ? "asc" : null;
      const hasHeaderRow = args["hasHeaderRow"] === true;
      if (!rect) return { ok: false, message: "The assistant returned an invalid range." };
      if (!rectInBounds(rect, sheet)) return { ok: false, message: "That range is outside this sheet." };
      if (byCol < rect.left || byCol > rect.right)
        return { ok: false, message: "The sort column isn't inside the range being sorted." };
      if (!direction) return { ok: false, message: "The assistant didn't say which direction to sort." };
      return { ok: true, action: { tool: "sort_range", rect, byCol, direction, hasHeaderRow } };
    }

    case "filter_range": {
      const range = str(args, "range");
      const rect = range ? rangeToRect(range) : null;
      const byColLetter = str(args, "byColumn");
      const byCol = byColLetter ? columnIndex(byColLetter) : -1;
      const condition = args["condition"];
      const value = str(args, "value") ?? "";
      const hasHeaderRow = args["hasHeaderRow"] === true;
      if (!rect) return { ok: false, message: "The assistant returned an invalid range." };
      if (!rectInBounds(rect, sheet)) return { ok: false, message: "That range is outside this sheet." };
      if (byCol < rect.left || byCol > rect.right)
        return { ok: false, message: "The filter column isn't inside the range being filtered." };
      if (condition !== "equals" && condition !== "contains" && condition !== "notEmpty" && condition !== "empty")
        return { ok: false, message: "The assistant proposed an unsupported filter condition." };
      if ((condition === "equals" || condition === "contains") && !value)
        return { ok: false, message: "The assistant's filter has no value to match." };
      return {
        ok: true,
        action: { tool: "filter_range", rect, byCol, condition: condition as FilterCondition, value, hasHeaderRow },
      };
    }

    case "apply_conditional_format": {
      const range = str(args, "range");
      const rect = range ? rangeToRect(range) : null;
      const kind = args["kind"];
      if (!rect) return { ok: false, message: "The assistant returned an invalid range." };
      if (!rectInBounds(rect, sheet)) return { ok: false, message: "That range is outside this sheet." };
      if (typeof kind !== "string" || !CONDITIONAL_KINDS.includes(kind as ConditionalKind))
        return { ok: false, message: "The assistant proposed an unsupported conditional-format rule." };
      const needs = CONDITIONAL_NEEDS[kind as ConditionalKind] ?? [];
      const value = typeof args["value"] === "number" ? (args["value"] as number) : undefined;
      const value2 = typeof args["value2"] === "number" ? (args["value2"] as number) : undefined;
      const text = typeof args["text"] === "string" ? (args["text"] as string) : undefined;
      if (needs.includes("value") && value === undefined)
        return { ok: false, message: `A "${kind}" rule needs a numeric value.` };
      if (needs.includes("value2") && value2 === undefined)
        return { ok: false, message: `A "${kind}" rule needs a second numeric value.` };
      if (needs.includes("text") && !text)
        return { ok: false, message: `A "${kind}" rule needs text to match.` };
      const color = typeof args["color"] === "string" ? (args["color"] as string) : undefined;
      return {
        ok: true,
        action: { tool: "apply_conditional_format", rect, kind: kind as ConditionalKind, value, value2, text, color },
      };
    }

    case "create_chart": {
      const range = str(args, "range");
      const rect = range ? rangeToRect(range) : null;
      const chartType = args["chartType"];
      const title = str(args, "title") ?? "Chart";
      if (!rect) return { ok: false, message: "The assistant returned an invalid data range for the chart." };
      if (!rectInBounds(rect, sheet)) return { ok: false, message: "That range is outside this sheet." };
      if (rect.top === rect.bottom && rect.left === rect.right)
        return { ok: false, message: "A chart needs more than a single cell of data." };
      if (typeof chartType !== "string" || !CHART_TYPES.includes(chartType as ChartType))
        return { ok: false, message: "The assistant proposed an unsupported chart type." };
      return { ok: true, action: { tool: "create_chart", rect, chartType: chartType as ChartType, title } };
    }

    case "rename_sheet": {
      const title = str(args, "title");
      if (!title || !title.trim()) return { ok: false, message: "The assistant returned an empty name." };
      if (title.length > MAX_TITLE_LENGTH) return { ok: false, message: "That name is too long." };
      return { ok: true, action: { tool: "rename_sheet", title: title.trim() } };
    }

    case "flag_outliers": {
      const range = str(args, "range");
      const rect = range ? rangeToRect(range) : null;
      const raw = args["flags"];
      if (!rect) return { ok: false, message: "The assistant returned an invalid range." };
      if (!rectInBounds(rect, sheet)) return { ok: false, message: "That range is outside this sheet." };
      if (!Array.isArray(raw) || raw.length === 0)
        return { ok: false, message: "The assistant found nothing to flag." };
      if (raw.length > MAX_STRUCTURAL_COUNT)
        return { ok: false, message: `That would flag too many cells at once (over ${MAX_STRUCTURAL_COUNT}).` };
      const flags: { ref: string; reason: string }[] = [];
      for (const f of raw) {
        if (!f || typeof f !== "object") return { ok: false, message: "The assistant returned a malformed flag." };
        const ref = str(f as Record<string, unknown>, "ref");
        const reason = str(f as Record<string, unknown>, "reason");
        if (!ref || !reason) return { ok: false, message: "The assistant returned a malformed flag." };
        const pos = parseRef(ref);
        /* Every flagged ref has to fall INSIDE the range it was found in — a
           ref elsewhere on the sheet is not something this range's analysis
           actually supports, whatever the model claims about it. */
        if (!pos || !inRect(pos.row, pos.col, rect))
          return { ok: false, message: `"${ref}" is outside the range being analysed.` };
        flags.push({ ref: ref.toUpperCase(), reason });
      }
      return { ok: true, action: { tool: "flag_outliers", rect, flags } };
    }

    default:
      return { ok: false, message: `The assistant proposed an action this sheet doesn't support (${tool}).` };
  }
}

const RECT_CELL_COUNT = (r: Rect) => (r.bottom - r.top + 1) * (r.right - r.left + 1);
/** Above this many cells, a range edit is "broad" and needs a confirmation rather than a straight Apply. */
const LARGE_RANGE_CELLS = 100;

/**
 * Does applying this action need an explicit confirmation, rather than a
 * straight Apply?
 *
 * `sheet` is the CURRENT data — deleting rows that are actually empty is a
 * different risk than deleting rows full of somebody's numbers, and only the
 * live sheet can tell the two apart.
 */
export function sheetsActionRequiresConfirmation(action: SheetsAiAction, sheet: SheetData): boolean {
  switch (action.tool) {
    case "delete_rows":
    case "delete_columns":
      /* Always — a structural delete cannot be judged safe from its size
         alone, and it is the one edit this tool set cannot preview a partial
         undo for once other edits have happened after it. */
      return true;
    case "sort_range":
    case "filter_range":
      /* Reorders or hides real rows of data every time it runs. */
      return true;
    case "format_range":
      return RECT_CELL_COUNT(action.rect) > LARGE_RANGE_CELLS;
    case "apply_conditional_format":
      return RECT_CELL_COUNT(action.rect) > LARGE_RANGE_CELLS;
    case "set_cells": {
      const overwritesData = action.cells.some((c) => (sheet.cells[c.ref] ?? "") !== "");
      return overwritesData && action.cells.length > 10;
    }
    case "create_table": {
      /* Only when it would land on cells that already hold something. */
      const anchorPos = parseRef(action.anchor)!;
      for (let r = 0; r <= action.rows.length; r++) {
        for (let c = 0; c < action.headers.length; c++) {
          const ref = cellRef(anchorPos.row + r, anchorPos.col + c);
          if ((sheet.cells[ref] ?? "") !== "") return true;
        }
      }
      return false;
    }
    case "flag_outliers":
      /* Additive and cosmetic — it paints a style onto existing cells,
         touches no value, and is undone the same one-click way any other
         style change is. Same reasoning as the other additive tools that
         fall through to the default below. */
      return false;
    default:
      return false;
  }
}

/** A short human label for the range an action touches — for the confirmation and preview copy. */
export function describeRect(rect: Rect): string {
  const a = cellRef(rect.top, rect.left);
  const b = cellRef(rect.bottom, rect.right);
  return a === b ? a : `${a}:${b}`;
}

export { columnLabel };
