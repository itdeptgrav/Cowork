/**
 * What the sheet sends Gemini — the selected range and the minimum
 * surrounding material (nearby headers, a small window of values), never
 * the whole sheet unless the caller has already decided the instruction
 * asked for it.
 *
 * Pure, like `lib/rules/documents/aiContext.ts`: takes plain values already
 * read from `SheetData`, so the budgeting rule is testable without a grid.
 */

import { cellRef, columnLabel, parseRef, type Rect, type SheetData } from "./grid.ts";

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

/**
 * The NON-EMPTY cells of `rect`, in row-major reading order, budgeted by how
 * many are actually emitted — an empty position costs nothing, so a sparse
 * selection's values are never eaten by the blank space around them. Walks the
 * sparse cell map rather than every grid position, which is what lets a
 * whole-sheet request over a large, mostly-empty grid stay cheap. `truncated`
 * is true only when a non-empty cell was genuinely left out, so the callers'
 * notes can state exactly what happened.
 */
function selectionValues(
  sheet: SheetData,
  rect: Rect,
  maxCells: number,
): { text: string; truncated: boolean } {
  const inside: { row: number; col: number; value: string }[] = [];
  for (const [ref, value] of Object.entries(sheet.cells)) {
    if (!value) continue;
    const pos = parseRef(ref);
    if (!pos) continue;
    if (pos.row < rect.top || pos.row > rect.bottom || pos.col < rect.left || pos.col > rect.right) continue;
    inside.push({ row: pos.row, col: pos.col, value });
  }
  inside.sort((a, b) => a.row - b.row || a.col - b.col);
  const truncated = inside.length > maxCells;
  const shown = truncated ? inside.slice(0, maxCells) : inside;

  const rows: string[] = [];
  let line: string[] = [];
  let lastRow = -1;
  for (const c of shown) {
    if (c.row !== lastRow && line.length) {
      rows.push(line.join(", "));
      line = [];
    }
    lastRow = c.row;
    line.push(`${cellRef(c.row, c.col)}=${c.value}`);
  }
  if (line.length) rows.push(line.join(", "));
  return { text: rows.join("\n"), truncated };
}

export function buildSheetsContext(input: SheetsContextInput): string {
  const { sheet, selection } = input;
  const parts: string[] = [`Sheet size: ${sheet.rows} rows × ${sheet.cols} columns.`];

  if (input.wholeSheet) {
    const full: Rect = { top: 0, left: 0, bottom: sheet.rows - 1, right: sheet.cols - 1 };
    const { text, truncated } = selectionValues(sheet, full, MAX_FULL_SHEET_CELLS);
    parts.push(`Full sheet contents (explicitly requested), non-empty cells only:\n${text}`);
    if (truncated)
      parts.push(
        `(The sheet has more than ${MAX_FULL_SHEET_CELLS} non-empty cells; only the first ${MAX_FULL_SHEET_CELLS}, reading left-to-right then top-to-bottom, are shown above.)`,
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

  const { text, truncated } = selectionValues(sheet, selection, MAX_CELLS_IN_CONTEXT);
  parts.push(text ? `Selected cell values:\n${text}` : "The selected cells are empty.");

  /* Only claimed when a non-empty cell was actually dropped — a merely LARGE
     selection whose values all fit is sent whole, with no caveat. */
  const cellCount = (selection.bottom - selection.top + 1) * (selection.right - selection.left + 1);
  if (truncated)
    parts.push(`(The selection has ${cellCount} cells; only the first ${MAX_CELLS_IN_CONTEXT} non-empty ones are shown above.)`);

  return parts.join("\n\n");
}

/** True when the instruction is plainly asking about the whole sheet rather than the selection. */
export function requestsWholeSheet(instruction: string): boolean {
  return /\b(whole|entire|full)\s+sheet\b/i.test(instruction);
}
