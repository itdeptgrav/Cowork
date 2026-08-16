/**
 * Sorting a range — reordering whole rows by a key column.
 *
 * The unit of movement is the ROW: sorting A1:C10 by column A moves each row's A,
 * B and C together, so relationships across the row are preserved (requirement).
 * The key is the COMPUTED value of the key column, so numbers, dates (serials)
 * and text all sort correctly — numeric, chronological and alphabetical fall out
 * of one cross-type comparison. Cells outside the range are untouched.
 *
 * It returns the cell edits (value AND style per cell), so a sort flows through
 * the ordinary command path and is a single undo. Formula references move
 * verbatim — a sort does not re-base them — which is a deliberate simplification.
 */

import type { Rect } from "./coordinates";
import { compareValues } from "./formula/functions/types";
import type { ScalarValue } from "./formula/value";
import { getCellStyleId, getCellValue, type Worksheet } from "./model";
import type { CellEdit } from "./history";

export type SortDirection = "asc" | "desc";

/**
 * The edits that sort `range` by `keyCol` (an absolute column index within the
 * range). `keyAt` supplies the comparable value of a cell — the caller passes
 * the engine's computed value so dates and numbers sort by magnitude.
 */
export function sortRangeEdits(
  ws: Worksheet,
  range: Rect,
  keyCol: number,
  direction: SortDirection,
  keyAt: (row: number, col: number) => ScalarValue,
): CellEdit[] {
  const rows: { key: ScalarValue; cells: { raw: string; style: number }[] }[] = [];
  for (let r = range.top; r <= range.bottom; r++) {
    const cells: { raw: string; style: number }[] = [];
    for (let c = range.left; c <= range.right; c++) {
      cells.push({ raw: getCellValue(ws, r, c), style: getCellStyleId(ws, r, c) });
    }
    rows.push({ key: keyAt(r, keyCol), cells });
  }

  const sign = direction === "asc" ? 1 : -1;
  const order = rows.map((_, i) => i).sort((a, b) => {
    const c = compareValues(rows[a].key, rows[b].key) * sign;
    return c !== 0 ? c : a - b; // stable: ties keep their original order
  });

  const edits: CellEdit[] = [];
  order.forEach((srcIdx, destIdx) => {
    const destRow = range.top + destIdx;
    rows[srcIdx].cells.forEach((cell, ci) => {
      edits.push({ row: destRow, col: range.left + ci, raw: cell.raw, style: cell.style });
    });
  });
  return edits;
}
