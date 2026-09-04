/**
 * Charts — a floating object drawn from a range of cells.
 *
 * A chart is EMBEDDED: it floats over the grid at a pixel position in the
 * sheet's own content space (so it scrolls with the cells), at a size the
 * person drags, in a paint order they can change. The data it draws is read
 * from its range every render, so editing a cell redraws the chart; the
 * range itself is a rectangle that follows inserted and deleted rows and
 * columns like a named range does.
 *
 * `chartModel` reads the block the way Sheets does: the first column holds
 * the category labels and each further column is a series whose name is its
 * header when that top cell is text. `rows` transposes that for a block laid
 * out with a series along each row. A single line charts its values against
 * 1..n. Non-numbers are gaps (0).
 */

import type { Rect } from "./coordinates";

export type ChartType = "column" | "bar" | "line" | "area" | "pie" | "doughnut" | "scatter" | "combo";

export const CHART_TYPES: { type: ChartType; label: string }[] = [
  { type: "column", label: "Column" },
  { type: "bar", label: "Bar" },
  { type: "line", label: "Line" },
  { type: "area", label: "Area" },
  { type: "pie", label: "Pie" },
  { type: "doughnut", label: "Doughnut" },
  { type: "scatter", label: "Scatter" },
  { type: "combo", label: "Combo" },
];

export interface ChartSpec {
  id: string;
  type: ChartType;
  /** The data rectangle on the chart's own sheet. */
  rect: Rect;
  /** Shown in the title bar; also what the range label reads as. */
  title: string;
  /** Placement, in content pixels from the grid's top-left. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Paint order — a higher `z` sits in front. */
  z?: number;
  legend?: boolean;
  axes?: boolean;
  stacked?: boolean;
  /** Series run down columns (default) or along rows. */
  orientation?: "cols" | "rows";
}

/** The old grid's chart renderer reads a range as text; this keeps that
    contract for the copied renderer. */
export interface ChartSeries {
  name: string;
  values: number[];
}
export interface ChartModel {
  labels: string[];
  series: ChartSeries[];
}

export const MAX_CHARTS = 40;
export const CHART_DEFAULT_W = 360;
export const CHART_DEFAULT_H = 240;

/** Read a chart's data out of the sheet. `cell` returns the DISPLAYED text and
    the evaluated number (or null) — so a formula charts its result. */
export function chartModel(
  rect: Rect,
  cell: (row: number, col: number) => { text: string; number: number | null },
  orientation: "cols" | "rows" = "cols",
): ChartModel {
  const height = rect.bottom - rect.top + 1;
  const width = rect.right - rect.left + 1;
  const R = orientation === "rows" ? width : height;
  const C = orientation === "rows" ? height : width;
  const at = (i: number, j: number) =>
    orientation === "rows" ? cell(rect.top + j, rect.left + i) : cell(rect.top + i, rect.left + j);

  if (C === 1) {
    const head = at(0, 0);
    const headed = head.number === null && head.text !== "";
    const startI = headed ? 1 : 0;
    const values: number[] = [];
    const labels: string[] = [];
    for (let i = startI; i < R; i++) {
      values.push(at(i, 0).number ?? 0);
      labels.push(String(i - startI + 1));
    }
    return { labels, series: [{ name: headed ? head.text : "Series 1", values }] };
  }

  let headed = false;
  for (let j = 1; j < C; j++) {
    const v = at(0, j);
    if (v.text !== "" && v.number === null) {
      headed = true;
      break;
    }
  }
  const startI = headed ? 1 : 0;
  const labels: string[] = [];
  for (let i = startI; i < R; i++) labels.push(at(i, 0).text || String(i - startI + 1));
  const series: ChartSeries[] = [];
  for (let j = 1; j < C; j++) {
    const name = headed ? at(0, j).text || `Series ${j}` : `Series ${j}`;
    const values: number[] = [];
    for (let i = startI; i < R; i++) values.push(at(i, j).number ?? 0);
    series.push({ name, values });
  }
  return { labels, series };
}

/** Where a new chart lands: staggered from the last one so several inserted
    in a row do not stack exactly on top of each other. */
export function nextChartOrigin(existing: readonly ChartSpec[]): { x: number; y: number } {
  const n = existing.length;
  return { x: 40 + (n % 6) * 28, y: 40 + (n % 6) * 28 };
}

export function newChart(
  id: string,
  type: ChartType,
  rect: Rect,
  existing: readonly ChartSpec[],
  title = "Chart",
): ChartSpec {
  const { x, y } = nextChartOrigin(existing);
  const z = existing.reduce((m, c) => Math.max(m, c.z ?? 0), 0) + 1;
  return { id, type, rect, title, x, y, w: CHART_DEFAULT_W, h: CHART_DEFAULT_H, z };
}

export function addChart(charts: readonly ChartSpec[] | undefined, chart: ChartSpec): ChartSpec[] {
  return [...(charts ?? []), chart].slice(-MAX_CHARTS);
}

export function updateChart(charts: readonly ChartSpec[] | undefined, id: string, patch: Partial<ChartSpec>): ChartSpec[] {
  return (charts ?? []).map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c));
}

export function removeChart(charts: readonly ChartSpec[] | undefined, id: string): ChartSpec[] {
  return (charts ?? []).filter((c) => c.id !== id);
}

/** Bring a chart to the front of the paint order. */
export function raiseChart(charts: readonly ChartSpec[] | undefined, id: string): ChartSpec[] {
  const list = charts ?? [];
  const top = list.reduce((m, c) => Math.max(m, c.z ?? 0), 0);
  const target = list.find((c) => c.id === id);
  if (!target || (target.z ?? 0) === top) return [...list];
  return updateChart(list, id, { z: top + 1 });
}

/**
 * Charts after rows or columns are inserted or deleted on their sheet. The
 * data rectangle moves and stretches the way a named range does; a chart
 * whose whole range is deleted keeps an empty 1x1 range and draws "no
 * numbers" rather than vanishing, because the picture is the person's work
 * even when its data is gone.
 */
export function shiftCharts(
  charts: readonly ChartSpec[] | undefined,
  op: { axis: "row" | "col"; at: number; count: number; mode: "insert" | "delete" },
): ChartSpec[] | undefined {
  if (!charts) return charts;
  return charts.map((c) => {
    const r = { ...c.rect };
    const lo = op.axis === "row" ? "top" : "left";
    const hi = op.axis === "row" ? "bottom" : "right";
    if (op.mode === "insert") {
      if (r[lo] >= op.at) r[lo] += op.count;
      if (r[hi] >= op.at) r[hi] += op.count;
    } else {
      const end = op.at + op.count - 1;
      if (r[lo] >= op.at && r[hi] <= end) {
        r[lo] = op.at;
        r[hi] = op.at;
      } else if (r[lo] > end) {
        r[lo] -= op.count;
        r[hi] -= op.count;
      } else if (r[hi] >= op.at) {
        const removedInside = Math.min(r[hi], end) - Math.max(r[lo], op.at) + 1;
        r[hi] -= removedInside;
        if (r[lo] > op.at) r[lo] = op.at;
      }
    }
    return { ...c, rect: r };
  });
}

/** Stored charts read defensively. */
export function readCharts(raw: unknown): ChartSpec[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const types = new Set<string>(CHART_TYPES.map((t) => t.type));
  const out: ChartSpec[] = [];
  for (const item of raw.slice(0, MAX_CHARTS)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const rect = o.rect as Record<string, unknown> | undefined;
    if (typeof o.id !== "string" || typeof o.type !== "string" || !types.has(o.type) || !rect) continue;
    const nums = [rect.top, rect.left, rect.bottom, rect.right];
    if (!nums.every((v) => typeof v === "number" && Number.isInteger(v) && v >= 0)) continue;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const spec: ChartSpec = {
      id: o.id,
      type: o.type as ChartType,
      rect: { top: rect.top as number, left: rect.left as number, bottom: rect.bottom as number, right: rect.right as number },
      title: typeof o.title === "string" ? o.title : "Chart",
    };
    const x = num(o.x), y = num(o.y), w = num(o.w), h = num(o.h), z = num(o.z);
    if (x !== undefined) spec.x = x;
    if (y !== undefined) spec.y = y;
    if (w !== undefined) spec.w = w;
    if (h !== undefined) spec.h = h;
    if (z !== undefined) spec.z = z;
    if (typeof o.legend === "boolean") spec.legend = o.legend;
    if (typeof o.axes === "boolean") spec.axes = o.axes;
    if (typeof o.stacked === "boolean") spec.stacked = o.stacked;
    if (o.orientation === "rows" || o.orientation === "cols") spec.orientation = o.orientation;
    out.push(spec);
  }
  return out.length ? out : undefined;
}
