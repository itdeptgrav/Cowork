/**
 * Colour scales and data bars — the conditional formats that paint from the
 * RANGE rather than from a rule about one cell.
 *
 * A colour scale maps each numeric cell's position between the range's
 * lowest and highest value to a colour between two (or three) stops. A
 * data bar draws a bar whose length is the value's share of the range's
 * largest value. Both need the range's numbers first, which the controller
 * gathers once per rule and hands in here.
 */

/** What the grid paints for a cell from its visual rules. */
export interface CellPaint {
  background?: string;
  bar?: { fraction: number; color: string };
}

export interface RangeNumbers {
  min: number;
  max: number;
}

/** Hex colour → [r, g, b]. Short and long forms; anything else is grey. */
export function parseHex(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [128, 128, 128];
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(rgb: [number, number, number]): string {
  return "#" + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
}

/** A colour `t` of the way from `a` to `b`, in 0–1. */
export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  const k = Math.max(0, Math.min(1, t));
  return toHex([r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k]);
}

/** Where a value sits in the range, 0–1; a flat range reads as the middle. */
export function fractionOf(value: number, range: RangeNumbers): number {
  if (range.max <= range.min) return 0.5;
  return Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min)));
}

/** The colour a scale gives a value. Three stops put `mid` at the halfway point. */
export function colorScaleColor(value: number, range: RangeNumbers, stops: { min: string; mid?: string; max: string }): string {
  const t = fractionOf(value, range);
  if (stops.mid) {
    return t <= 0.5 ? mixHex(stops.min, stops.mid, t * 2) : mixHex(stops.mid, stops.max, (t - 0.5) * 2);
  }
  return mixHex(stops.min, stops.max, t);
}

/** The bar's length as a share of the cell, 0–1. Negative values draw no bar;
    the range's largest positive value fills the cell. */
export function dataBarFraction(value: number, range: RangeNumbers): number {
  const top = Math.max(range.max, 0);
  if (top <= 0 || value <= 0) return 0;
  return Math.max(0, Math.min(1, value / top));
}

/** The lowest and highest number among some values, or null with none. */
export function rangeNumbers(values: Iterable<unknown>): RangeNumbers | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) ? { min, max } : null;
}

/** The ready-made scales the form offers. */
export const COLOR_SCALE_PRESETS: { label: string; min: string; mid?: string; max: string }[] = [
  { label: "White to green", min: "#ffffff", max: "#57bb8a" },
  { label: "Green to white", min: "#57bb8a", max: "#ffffff" },
  { label: "Red to white to green", min: "#e67c73", mid: "#ffffff", max: "#57bb8a" },
  { label: "Green to white to red", min: "#57bb8a", mid: "#ffffff", max: "#e67c73" },
  { label: "White to red", min: "#ffffff", max: "#e67c73" },
  { label: "Red to yellow to green", min: "#e67c73", mid: "#ffd666", max: "#57bb8a" },
  { label: "White to blue", min: "#ffffff", max: "#6b8afd" },
];

export const DATA_BAR_COLORS: { label: string; color: string }[] = [
  { label: "Blue", color: "#6b8afd" },
  { label: "Green", color: "#57bb8a" },
  { label: "Orange", color: "#f4a742" },
  { label: "Red", color: "#e67c73" },
  { label: "Grey", color: "#9aa3b2" },
];
