/**
 * The fill handle — dragging a selection's corner to extend its contents.
 *
 * A fill reads the selected cells as a series and continues it into the cells
 * the drag reaches. What "continue" means depends on the series (requirement 9):
 *
 *  · all-numeric → an arithmetic sequence. Two cells set the step (`1, 2` → `3,
 *    4, 5, 6`); a lone number has step zero, so it simply repeats.
 *  · formulas    → copied with their relative references walked along the drag
 *    (`=A1` down a column becomes `=A2`, `=A3`, …).
 *  · anything else → the pattern repeats cell for cell.
 *
 * The drag has a direction — down, up, left or right — and the maths is written
 * once for a forward drag (row/column index increasing) and reused for the
 * reverse by feeding the source in reverse and flipping the reference-shift sign.
 * Pure and DOM-free: the grid hands it the source rectangle and the cell the
 * handle was dragged to, and gets back the destination rectangle and the edits.
 */

import type { CellPos, Rect } from "./coordinates";
import { adjustFormula } from "./formula/references";
import { getCellStyleId, getCellValue, type Worksheet } from "./model";
import type { Bounds } from "./selection";
import type { CellEdit } from "./history";

type Axis = "row" | "col";

/** A raw string as a finite number, or null when it is not a plain number. */
function asNumber(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** A generated number as a clean raw string, shaving the float noise a constant
    step accumulates (0.1 + 0.2 …) without touching genuine precision. Rounds
    RELATIVELY — to 15 significant digits, the same reading the engine's
    `formatNumber` uses — so tiny magnitudes (1e-15, 2e-15 → 3e-15) survive,
    where an absolute cutoff would floor them to zero. */
function numberToRaw(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return String(Number(value.toPrecision(15)));
}

/**
 * Continue a 1-D series forward by `count` cells.
 *
 * `source` is the series in the drag's travel direction (its last element sits
 * next to the first generated cell). `sign` is +1 for a forward drag and -1 for
 * a reverse one, and scales how far each generated formula's references move.
 * `axis` says which reference component a step walks.
 */
export function fillSeries(
  source: readonly string[],
  count: number,
  axis: Axis,
  sign: 1 | -1,
): string[] {
  if (count <= 0) return [];
  const n = source.length;
  if (n === 0) return Array.from({ length: count }, () => "");

  const numbers = source.map(asNumber);
  const allNumeric = numbers.every((x): x is number => x !== null);

  const out: string[] = [];
  if (allNumeric) {
    const last = numbers[n - 1];
    const step = n >= 2 ? numbers[n - 1] - numbers[n - 2] : 0;
    for (let k = 1; k <= count; k++) out.push(numberToRaw(last + step * k));
    return out;
  }

  /* Pattern / formula branch: the cell at forward position `p` (0-based, past
     the series start) repeats source[p mod n], shifted by the whole-pattern
     multiples it has advanced. */
  for (let k = 1; k <= count; k++) {
    const p = n - 1 + k;
    const mapped = ((p % n) + n) % n;
    const shift = sign * (p - mapped);
    const raw = source[mapped];
    if (raw.startsWith("=")) {
      out.push(adjustFormula(raw, axis === "row" ? shift : 0, axis === "col" ? shift : 0));
    } else {
      out.push(raw);
    }
  }
  return out;
}

/**
 * The source styles a fill lays onto the generated cells — the SAME `p mod n`
 * mapping the values follow, so formatting repeats in step with the series. The
 * caller reverses the source in tandem with the values for an upward/leftward
 * drag, so no sign is needed here.
 */
export function fillStyleSeries(source: readonly number[], count: number): number[] {
  if (count <= 0) return [];
  const n = source.length;
  if (n === 0) return Array.from({ length: count }, () => 0);
  const out: number[] = [];
  for (let k = 1; k <= count; k++) {
    const p = n - 1 + k;
    out.push(source[((p % n) + n) % n]);
  }
  return out;
}

/** Which way a handle dragged to `target` extends the source, and how far. */
type FillPlan =
  | { dir: "down" | "up"; count: number }
  | { dir: "left" | "right"; count: number }
  | null;

function planFill(source: Rect, target: CellPos): FillPlan {
  const down = Math.max(0, target.row - source.bottom);
  const up = Math.max(0, source.top - target.row);
  const right = Math.max(0, target.col - source.right);
  const left = Math.max(0, source.left - target.col);
  const vertical = Math.max(down, up);
  const horizontal = Math.max(right, left);
  if (vertical === 0 && horizontal === 0) return null;
  /* Ties favour the vertical drag, the commoner gesture. */
  if (vertical >= horizontal) {
    return down >= up ? { dir: "down", count: down } : { dir: "up", count: up };
  }
  return right >= left ? { dir: "right", count: right } : { dir: "left", count: left };
}

/**
 * The rectangle a fill to `target` would cover — the source grown along the
 * drag's dominant axis. Used both to apply the fill and to preview it while the
 * handle is being dragged. A drag that leaves the source unmoved returns it
 * unchanged.
 */
export function fillDestRect(source: Rect, target: CellPos, bounds: Bounds): Rect {
  const plan = planFill(source, {
    row: Math.max(0, Math.min(bounds.rows - 1, target.row)),
    col: Math.max(0, Math.min(bounds.cols - 1, target.col)),
  });
  if (!plan) return source;
  switch (plan.dir) {
    case "down":
      return { ...source, bottom: source.bottom + plan.count };
    case "up":
      return { ...source, top: source.top - plan.count };
    case "right":
      return { ...source, right: source.right + plan.count };
    case "left":
      return { ...source, left: source.left - plan.count };
  }
}

/**
 * Compute a fill: the destination rectangle, the value edits that populate the
 * cells the drag added, and the style edits that carry each source cell's
 * formatting onto them. Each column (vertical drag) or row (horizontal drag) is
 * continued independently from its own source cells.
 */
export function computeFill(
  ws: Worksheet,
  source: Rect,
  target: CellPos,
  bounds: Bounds,
): { dest: Rect; edits: CellEdit[]; styleEdits: CellEdit[] } {
  const clamped = {
    row: Math.max(0, Math.min(bounds.rows - 1, target.row)),
    col: Math.max(0, Math.min(bounds.cols - 1, target.col)),
  };
  const plan = planFill(source, clamped);
  if (!plan) return { dest: source, edits: [], styleEdits: [] };

  const edits: CellEdit[] = [];
  const styleEdits: CellEdit[] = [];
  const dest = fillDestRect(source, clamped, bounds);

  if (plan.dir === "down" || plan.dir === "up") {
    for (let c = source.left; c <= source.right; c++) {
      const column: string[] = [];
      const colStyles: number[] = [];
      for (let r = source.top; r <= source.bottom; r++) {
        column.push(getCellValue(ws, r, c));
        colStyles.push(getCellStyleId(ws, r, c));
      }
      if (plan.dir === "down") {
        const gen = fillSeries(column, plan.count, "row", 1);
        const styleGen = fillStyleSeries(colStyles, plan.count);
        gen.forEach((raw, k) => edits.push({ row: source.bottom + 1 + k, col: c, raw }));
        styleGen.forEach((style, k) => styleEdits.push({ row: source.bottom + 1 + k, col: c, style }));
      } else {
        /* Reverse so the series travels upward; shift references negatively. */
        const gen = fillSeries([...column].reverse(), plan.count, "row", -1);
        const styleGen = fillStyleSeries([...colStyles].reverse(), plan.count);
        gen.forEach((raw, k) => edits.push({ row: source.top - 1 - k, col: c, raw }));
        styleGen.forEach((style, k) => styleEdits.push({ row: source.top - 1 - k, col: c, style }));
      }
    }
  } else {
    for (let r = source.top; r <= source.bottom; r++) {
      const rowCells: string[] = [];
      const rowStyles: number[] = [];
      for (let c = source.left; c <= source.right; c++) {
        rowCells.push(getCellValue(ws, r, c));
        rowStyles.push(getCellStyleId(ws, r, c));
      }
      if (plan.dir === "right") {
        const gen = fillSeries(rowCells, plan.count, "col", 1);
        const styleGen = fillStyleSeries(rowStyles, plan.count);
        gen.forEach((raw, k) => edits.push({ row: r, col: source.right + 1 + k, raw }));
        styleGen.forEach((style, k) => styleEdits.push({ row: r, col: source.right + 1 + k, style }));
      } else {
        const gen = fillSeries([...rowCells].reverse(), plan.count, "col", -1);
        const styleGen = fillStyleSeries([...rowStyles].reverse(), plan.count);
        gen.forEach((raw, k) => edits.push({ row: r, col: source.left - 1 - k, raw }));
        styleGen.forEach((style, k) => styleEdits.push({ row: r, col: source.left - 1 - k, style }));
      }
    }
  }
  return { dest, edits, styleEdits };
}
