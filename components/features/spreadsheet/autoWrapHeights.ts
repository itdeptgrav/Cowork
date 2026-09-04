"use client";

/**
 * Growing rows to fit their wrapped text.
 *
 * The line-breaking and the arithmetic are in `lib/spreadsheet/wrapHeight.ts`,
 * where they are pure and tested. This is the half that cannot be: it needs the
 * browser to measure a string in a particular font, and it needs the sheet's
 * own resolved styles and displayed text.
 *
 * ## Why it walks the styles and not the cells
 *
 * `cellStyles` is sparse, and wrapping is a style. A sheet where nobody has
 * turned wrapping on does one `Object.keys` over a small map and returns
 * nothing — so this costs approximately zero on the sheets it does not apply
 * to, which is most of them. Walking `cells` instead would visit every value in
 * the workbook to discover that none of them wraps.
 */

import { parseCellRef } from "@/lib/spreadsheet/coordinates";
import {
  autoRowHeight,
  wrapLineCount,
  wrappedCellHeight,
  CELL_PADDING_X,
} from "@/lib/spreadsheet/wrapHeight";
import type { Worksheet } from "@/lib/spreadsheet/model";
import type { CellStyle } from "@/lib/spreadsheet/style";

/**
 * One canvas for the life of the page, and a cache keyed by the font string.
 *
 * `measureText` is fast; building a canvas context and re-setting `font` for
 * every cell on every render is not. The cache is per font, not per string,
 * because the string varies and the font almost never does.
 */
let ctx: CanvasRenderingContext2D | null = null;
function measurerFor(font: string): (s: string) => number {
  if (!ctx) {
    if (typeof document === "undefined") return (s) => s.length * 7;
    ctx = document.createElement("canvas").getContext("2d");
  }
  const c = ctx;
  if (!c) return (s) => s.length * 7;
  return (s) => {
    /* Set per call rather than per measurer: two measurers with different fonts
       share one context, and whichever set `font` last would otherwise decide
       for both. */
    c.font = font;
    return c.measureText(s).width;
  };
}

/** The CSS font shorthand for a cell, matching what the grid renders. */
function fontOf(style: CellStyle): string {
  const size = style.fontSize ?? 13;
  const family = style.fontFamily ?? "system-ui, sans-serif";
  const weight = style.bold ? "700" : "400";
  const italic = style.italic ? "italic " : "";
  return `${italic}${weight} ${size}px ${family}`;
}

/**
 * Row index → the height that row needs, for rows that need more than the
 * sheet's default. Rows that fit are absent rather than present-and-equal, so
 * the caller can skip the merge entirely when nothing wraps.
 */
export function autoWrapHeights(
  worksheet: Worksheet,
  effectiveStyle: (row: number, col: number) => CellStyle,
  textAt: (row: number, col: number) => string,
): Record<number, number> {
  const refs = Object.keys(worksheet.cellStyles);
  if (refs.length === 0) return {};

  const perRow = new Map<number, number[]>();
  for (const ref of refs) {
    const pos = parseCellRef(ref);
    if (!pos) continue;
    const style = effectiveStyle(pos.row, pos.col);
    if (!style.wrap) continue;

    const text = textAt(pos.row, pos.col);
    if (!text) continue;

    const width =
      worksheet.colWidths[pos.col] ?? worksheet.defaultColWidth;
    const available = width - CELL_PADDING_X;
    const fontSize = style.fontSize ?? 13;
    const lines = wrapLineCount(text, available, measurerFor(fontOf(style)));
    /* One line needs nothing: it fits the default row, and adding it here would
       make every wrapped cell claim a height and defeat the skip below. */
    if (lines <= 1) continue;

    const height = wrappedCellHeight(lines, fontSize);
    const list = perRow.get(pos.row);
    if (list) list.push(height);
    else perRow.set(pos.row, [height]);
  }

  const out: Record<number, number> = {};
  for (const [row, heights] of perRow) {
    const h = autoRowHeight(heights, worksheet.defaultRowHeight);
    if (h > worksheet.defaultRowHeight) out[row] = h;
  }
  return out;
}
