/**
 * The figures the status bar shows for a selection — what Excel and Sheets
 * put in the bottom corner: sum, average, count, min, max. Numbers only
 * count for the arithmetic; text and blanks are counted by Count but not
 * by Numeric count, exactly as those two products do it.
 */

import type { ScalarValue } from "./formula/value";
import { formatNumber, isBlank } from "./formula/value";
import { isError } from "./formula/errors";

export interface SelectionStats {
  /** Cells that hold anything at all. */
  count: number;
  /** Cells that hold a number. */
  numeric: number;
  sum: number;
  average: number | null;
  min: number | null;
  max: number | null;
}

export function selectionStats(values: Iterable<ScalarValue>): SelectionStats {
  let count = 0;
  let numeric = 0;
  let sum = 0;
  let min: number | null = null;
  let max: number | null = null;
  for (const v of values) {
    if (isBlank(v)) continue;
    if (typeof v === "string" && v === "") continue;
    count++;
    if (typeof v !== "number" || isError(v)) continue;
    numeric++;
    sum += v;
    if (min === null || v < min) min = v;
    if (max === null || v > max) max = v;
  }
  return { count, numeric, sum, average: numeric ? sum / numeric : null, min, max };
}

/** The status-bar line, or empty when there is nothing worth saying. */
export function statsLine(s: SelectionStats): { label: string; value: string }[] {
  if (s.count < 2) return [];
  const out: { label: string; value: string }[] = [];
  if (s.numeric > 0) {
    out.push({ label: "Sum", value: formatNumber(Number(s.sum.toPrecision(12))) });
    if (s.average !== null) out.push({ label: "Average", value: formatNumber(Number(s.average.toPrecision(12))) });
    if (s.min !== null) out.push({ label: "Min", value: formatNumber(s.min) });
    if (s.max !== null) out.push({ label: "Max", value: formatNumber(s.max) });
  }
  out.push({ label: "Count", value: String(s.count) });
  return out;
}
