/**
 * Pivot tables — a summary of a block of records, one row per value of a
 * chosen field, optionally one column per value of a second, each cell an
 * aggregate (sum, count, average, min, max) of a third.
 *
 * The source block's first row is its headers, which is how the fields are
 * named. The result is plain cells written to a sheet of their own, with a
 * totals row and column; the definition is kept on the workbook so Refresh
 * rebuilds the table from the source's current values — the way a pivot in
 * Excel is static until refreshed rather than live.
 */

import type { Rect } from "./coordinates";

export type PivotAgg = "sum" | "count" | "average" | "min" | "max";

export const PIVOT_AGGS: { value: PivotAgg; label: string }[] = [
  { value: "sum", label: "Sum" },
  { value: "count", label: "Count" },
  { value: "average", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
];

export interface PivotSpec {
  /** Column offsets within the source block, 0-based. */
  rowField: number;
  colField?: number;
  valueField: number;
  agg: PivotAgg;
}

export interface PivotDefinition {
  id: string;
  /** Where the records live — including the header row. */
  source: { sheetId: string; rect: Rect };
  spec: PivotSpec;
  /** Where the table is written: a sheet, from its top-left. */
  target: { sheetId: string; row: number; col: number };
}

export interface SourceCell {
  text: string;
  number: number | null;
}

export type PivotCell = string | number;

/** Group keys in a sensible order: all-numeric keys numerically, else text. */
function orderKeys(keys: Iterable<string>): string[] {
  const list = [...keys];
  const numeric = list.every((k) => k.trim() !== "" && Number.isFinite(Number(k)));
  return list.sort((a, b) => (numeric ? Number(a) - Number(b) : a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })));
}

function aggregate(values: number[], counted: number, agg: PivotAgg): number | "" {
  if (agg === "count") return counted;
  if (values.length === 0) return "";
  switch (agg) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "average":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
  }
}

/** The field names a source block offers — its header row, blanks named by
    their column letter position. */
export function pivotFields(matrix: SourceCell[][]): string[] {
  const header = matrix[0] ?? [];
  return header.map((c, i) => (c.text.trim() ? c.text.trim() : `Column ${i + 1}`));
}

/**
 * Build the table. `matrix` is the source block INCLUDING its header row.
 * Returns rows of cells; numbers stay numbers so the sheet aligns them and
 * formulas can read them.
 */
export function buildPivot(matrix: SourceCell[][], spec: PivotSpec): PivotCell[][] {
  const fields = pivotFields(matrix);
  const records = matrix.slice(1);
  const rowName = fields[spec.rowField] ?? "Row";
  const valueName = fields[spec.valueField] ?? "Value";
  const aggLabel = PIVOT_AGGS.find((a) => a.value === spec.agg)?.label ?? spec.agg;

  /* rowKey → colKey → { values, counted } */
  const groups = new Map<string, Map<string, { values: number[]; counted: number }>>();
  const colKeys = new Set<string>();
  for (const rec of records) {
    const isEmpty = rec.every((c) => c.text === "");
    if (isEmpty) continue;
    const rk = rec[spec.rowField]?.text ?? "";
    const ck = spec.colField === undefined ? "" : (rec[spec.colField]?.text ?? "");
    const v = rec[spec.valueField];
    const byCol = groups.get(rk) ?? new Map();
    const cell = byCol.get(ck) ?? { values: [], counted: 0 };
    if (v && v.text !== "") {
      cell.counted += 1;
      if (v.number !== null) cell.values.push(v.number);
    }
    byCol.set(ck, cell);
    groups.set(rk, byCol);
    colKeys.add(ck);
  }

  const rows = orderKeys(groups.keys());
  const cols = spec.colField === undefined ? [""] : orderKeys(colKeys);
  const colName = spec.colField === undefined ? undefined : fields[spec.colField];

  const header: PivotCell[] = [rowName];
  if (colName === undefined) header.push(`${aggLabel} of ${valueName}`);
  else {
    for (const ck of cols) header.push(ck === "" ? "(blank)" : ck);
    header.push("Total");
  }
  const out: PivotCell[][] = [header];

  const colTotals = cols.map(() => ({ values: [] as number[], counted: 0 }));
  const grand = { values: [] as number[], counted: 0 };

  for (const rk of rows) {
    const byCol = groups.get(rk)!;
    const line: PivotCell[] = [rk === "" ? "(blank)" : rk];
    const rowAll = { values: [] as number[], counted: 0 };
    cols.forEach((ck, i) => {
      const cell = byCol.get(ck);
      if (cell) {
        line.push(aggregate(cell.values, cell.counted, spec.agg));
        rowAll.values.push(...cell.values);
        rowAll.counted += cell.counted;
        colTotals[i].values.push(...cell.values);
        colTotals[i].counted += cell.counted;
      } else line.push("");
    });
    if (colName !== undefined) line.push(aggregate(rowAll.values, rowAll.counted, spec.agg));
    grand.values.push(...rowAll.values);
    grand.counted += rowAll.counted;
    out.push(line);
  }

  const totals: PivotCell[] = ["Total"];
  if (colName === undefined) totals.push(aggregate(grand.values, grand.counted, spec.agg));
  else {
    for (const t of colTotals) totals.push(aggregate(t.values, t.counted, spec.agg));
    totals.push(aggregate(grand.values, grand.counted, spec.agg));
  }
  out.push(totals);
  return out;
}

/** The cells to write, as `{ row, col, value }` from a top-left anchor —
    numbers written as their plain text so the sheet reads them as numbers. */
export function pivotWrites(table: PivotCell[][], anchor: { row: number; col: number }): { row: number; col: number; value: string }[] {
  const writes: { row: number; col: number; value: string }[] = [];
  table.forEach((line, r) => {
    line.forEach((cell, c) => {
      const value = typeof cell === "number" ? String(Number(cell.toPrecision(15))) : cell;
      writes.push({ row: anchor.row + r, col: anchor.col + c, value });
    });
  });
  return writes;
}

/** The rectangle a table occupies from its anchor. */
export function pivotFootprint(table: PivotCell[][], anchor: { row: number; col: number }): Rect {
  const width = table.reduce((m, l) => Math.max(m, l.length), 0);
  return { top: anchor.row, left: anchor.col, bottom: anchor.row + Math.max(0, table.length - 1), right: anchor.col + Math.max(0, width - 1) };
}

/** Stored definitions read defensively. */
export function readPivots(raw: unknown): PivotDefinition[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PivotDefinition[] = [];
  const aggs = new Set(PIVOT_AGGS.map((a) => a.value));
  const rectOk = (r: unknown): r is Rect =>
    !!r && typeof r === "object" && ["top", "left", "bottom", "right"].every((k) => Number.isInteger((r as Record<string, unknown>)[k]) && ((r as Record<string, number>)[k] >= 0));
  for (const item of raw.slice(0, 100)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const source = o.source as Record<string, unknown> | undefined;
    const target = o.target as Record<string, unknown> | undefined;
    const spec = o.spec as Record<string, unknown> | undefined;
    if (typeof o.id !== "string" || !source || !target || !spec) continue;
    if (typeof source.sheetId !== "string" || !rectOk(source.rect)) continue;
    if (typeof target.sheetId !== "string" || !Number.isInteger(target.row) || !Number.isInteger(target.col)) continue;
    if (!Number.isInteger(spec.rowField) || !Number.isInteger(spec.valueField) || typeof spec.agg !== "string" || !aggs.has(spec.agg as PivotAgg)) continue;
    out.push({
      id: o.id,
      source: { sheetId: source.sheetId, rect: source.rect },
      target: { sheetId: target.sheetId, row: target.row as number, col: target.col as number },
      spec: {
        rowField: spec.rowField as number,
        valueField: spec.valueField as number,
        agg: spec.agg as PivotAgg,
        ...(Number.isInteger(spec.colField) ? { colField: spec.colField as number } : {}),
      },
    });
  }
  return out.length ? out : undefined;
}
