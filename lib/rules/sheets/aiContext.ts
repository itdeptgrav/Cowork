/**
 * What the sheet sends Gemini — the selected range and the minimum
 * surrounding material (nearby headers, a small window of values), never
 * the whole sheet unless the caller has already decided the instruction
 * asked for it.
 *
 * Pure, like `lib/rules/documents/aiContext.ts`: takes plain values already
 * read from `SheetData`, so the budgeting rule is testable without a grid.
 */

import { cellRef, columnLabel, type Rect, type SheetData } from "./grid.ts";

const MAX_CELLS_IN_CONTEXT = 400;
const MAX_FULL_SHEET_CELLS = 4000;

export interface SheetsContextInput {
  sheet: SheetData;
  /** The current selection, or null when the selection is a single empty cell with nothing to anchor context on. */
  selection: Rect | null;
  /** True only when the caller decided the instruction explicitly asked for the whole sheet. */
  wholeSheet?: boolean;
}

/** The header row's text for each column in `rect`, read from row 0 regardless of where `rect` itself starts. */
function headerRowFor(sheet: SheetData, rect: Rect): string {
  const headers: string[] = [];
  for (let col = rect.left; col <= rect.right; col++) {
    const v = sheet.cells[cellRef(0, col)];
    if (v) headers.push(`${columnLabel(col)}=${v}`);
  }
  return headers.join(", ");
}

function selectionValues(sheet: SheetData, rect: Rect, maxCells: number): string {
  const rows: string[] = [];
  let count = 0;
  for (let row = rect.top; row <= rect.bottom && count < maxCells; row++) {
    const cells: string[] = [];
    for (let col = rect.left; col <= rect.right && count < maxCells; col++) {
      const ref = cellRef(row, col);
      const v = sheet.cells[ref];
      if (v) cells.push(`${ref}=${v}`);
      count++;
    }
    if (cells.length) rows.push(cells.join(", "));
  }
  return rows.join("\n");
}

export function buildSheetsContext(input: SheetsContextInput): string {
  const { sheet, selection } = input;
  const parts: string[] = [`Sheet size: ${sheet.rows} rows × ${sheet.cols} columns.`];

  if (input.wholeSheet) {
    const full: Rect = { top: 0, left: 0, bottom: sheet.rows - 1, right: sheet.cols - 1 };
    parts.push(
      `Full sheet contents (explicitly requested), non-empty cells only:\n${selectionValues(sheet, full, MAX_FULL_SHEET_CELLS)}`,
    );
    return parts.join("\n\n");
  }

  if (!selection) {
    parts.push("Nothing is selected.");
    return parts.join("\n\n");
  }

  parts.push(`Selected range: ${cellRef(selection.top, selection.left)}:${cellRef(selection.bottom, selection.right)}`);

  const headers = headerRowFor(sheet, selection);
  if (headers && selection.top > 0) parts.push(`Column headers (row 1) for these columns: ${headers}`);

  const values = selectionValues(sheet, selection, MAX_CELLS_IN_CONTEXT);
  parts.push(values ? `Selected cell values:\n${values}` : "The selected cells are empty.");

  const cellCount = (selection.bottom - selection.top + 1) * (selection.right - selection.left + 1);
  if (cellCount > MAX_CELLS_IN_CONTEXT)
    parts.push(`(The selection has ${cellCount} cells; only the first ${MAX_CELLS_IN_CONTEXT} non-empty ones are shown above.)`);

  return parts.join("\n\n");
}

/** True when the instruction is plainly asking about the whole sheet rather than the selection. */
export function requestsWholeSheet(instruction: string): boolean {
  return /\b(whole|entire|full)\s+sheet\b/i.test(instruction);
}
