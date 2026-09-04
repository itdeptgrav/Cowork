/**
 * Alternating colours — Sheets' Format ▸ Alternating colours.
 *
 * A band paints a range's rows in two colours turn and turn about, with a
 * darker header row on top. It is a sheet-level fill drawn UNDER a cell's
 * own style and under conditional formats, so a cell someone coloured by
 * hand keeps its colour. Bands move with their rows and columns when the
 * sheet is restructured, like every other ranged annotation.
 */

import type { Rect } from "./coordinates";
import { rangeContains } from "./conditional";

export interface Banding {
  id: string;
  range: Rect;
  /** The first row's colour; unset for no header. */
  header?: string;
  odd: string;
  even: string;
}

export interface BandPreset {
  label: string;
  header: string;
  odd: string;
  even: string;
}

export const BAND_PRESETS: BandPreset[] = [
  { label: "Grey", header: "#d9dde3", odd: "#ffffff", even: "#f1f3f5" },
  { label: "Blue", header: "#c7d2fe", odd: "#ffffff", even: "#eef2ff" },
  { label: "Green", header: "#bbf7d0", odd: "#ffffff", even: "#ecfdf3" },
  { label: "Orange", header: "#fed7aa", odd: "#ffffff", even: "#fff7ed" },
  { label: "Purple", header: "#e9d5ff", odd: "#ffffff", even: "#faf5ff" },
];

/** The band colour under a cell, or undefined outside every band. The last
    band listed wins where two overlap, which adding a band prevents anyway. */
export function bandColorAt(bands: Banding[] | undefined, row: number, col: number): string | undefined {
  if (!bands || bands.length === 0) return undefined;
  let out: string | undefined;
  for (const b of bands) {
    if (!rangeContains(b.range, row, col)) continue;
    if (b.header && row === b.range.top) out = b.header;
    else {
      const offset = row - b.range.top - (b.header ? 1 : 0);
      out = offset % 2 === 0 ? b.odd : b.even;
    }
  }
  return out;
}

const HEX = /^#[0-9a-f]{6}$/i;

function readRect(raw: unknown): Rect | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
  const top = n(r.top);
  const left = n(r.left);
  const bottom = n(r.bottom);
  const right = n(r.right);
  if (top === null || left === null || bottom === null || right === null || bottom < top || right < left) return null;
  return { top, left, bottom, right };
}

/** Stored bands back, dropping anything malformed. */
export function readBands(raw: unknown): Banding[] {
  if (!Array.isArray(raw)) return [];
  const out: Banding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    const range = readRect(b.range);
    if (!range || typeof b.id !== "string" || typeof b.odd !== "string" || typeof b.even !== "string") continue;
    if (!HEX.test(b.odd) || !HEX.test(b.even)) continue;
    const band: Banding = { id: b.id, range, odd: b.odd.toLowerCase(), even: b.even.toLowerCase() };
    if (typeof b.header === "string" && HEX.test(b.header)) band.header = b.header.toLowerCase();
    out.push(band);
  }
  return out;
}

/** Bands after rows or columns are inserted or deleted, matching the
    treatment `shiftProtection` gives protected ranges. */
export function shiftBanding(
  bands: Banding[],
  op: { axis: "row" | "col"; at: number; count: number; mode: "insert" | "delete" },
): Banding[] {
  const out: Banding[] = [];
  const lo = op.axis === "row" ? "top" : "left";
  const hi = op.axis === "row" ? "bottom" : "right";
  for (const b of bands) {
    const r = { ...b.range };
    if (op.mode === "insert") {
      if (r[lo] >= op.at) r[lo] += op.count;
      if (r[hi] >= op.at) r[hi] += op.count;
    } else {
      const end = op.at + op.count - 1;
      if (r[lo] >= op.at && r[hi] <= end) continue; /* wholly deleted */
      if (r[lo] > end) r[lo] -= op.count;
      else if (r[lo] >= op.at) r[lo] = op.at;
      if (r[hi] > end) r[hi] -= op.count;
      else if (r[hi] >= op.at) r[hi] = op.at - 1;
      if (r[hi] < r[lo]) continue;
    }
    out.push({ ...b, range: r });
  }
  return out;
}

/** Whether two rectangles share a cell. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
}
