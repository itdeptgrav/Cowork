/**
 * Column widths and row heights, between Excel's units and pixels.
 *
 * ## Why this had to exist
 *
 * A file's column widths were dropped on import — `colWidths: {}`, always — so
 * a workbook whose columns were sized to fit its text arrived with every column
 * at the default. Text that fitted in Excel was cut off in Cowork, which is
 * exactly what it looks like: a cell reading "The change l…".
 *
 * Wrapping did not save it either, because the wrap flag was dropped too. The
 * cell was narrow AND unwrapped, so the only thing left was the ellipsis.
 *
 * ## The units, and why they are approximations
 *
 * Excel does not store a column width in pixels. It stores it in CHARACTERS of
 * the workbook's standard font — `wch` — and the pixel width is then a function
 * of whatever font the reader has. The conversion below is Excel's own
 * documented approximation for an 11pt Calibri sheet: `px = wch * 7 + 5`, the
 * 5 being the cell's padding and gridline.
 *
 * It will not be exact for a workbook written in a different font, and it does
 * not need to be: the purpose is that a column sized to hold its text still
 * holds its text. SheetJS also offers `wpx` where the file carried one, and
 * that IS exact, so it is preferred when present.
 *
 * Row heights are simpler — Excel stores points, and a point is a well-defined
 * 1/72 inch against CSS's 96dpi pixel.
 */

/** Pixels per character of the standard font, plus the cell's own padding. */
const PX_PER_CH = 7;
const CELL_PADDING_PX = 5;

/** CSS pixels per point: 96dpi / 72pt. */
const PX_PER_PT = 96 / 72;

/** What SheetJS puts on `!cols` — any one of these may be present. */
export interface XlsxColInfo {
  wch?: number;
  wpx?: number;
  width?: number;
  hidden?: boolean;
}

/** What SheetJS puts on `!rows`. */
export interface XlsxRowInfo {
  hpt?: number;
  hpx?: number;
  hidden?: boolean;
}

/**
 * A column's width in pixels, or null when the file did not set one.
 *
 * Null rather than a default, because "this column has no stored width" and
 * "this column is exactly the default width" are different facts: storing the
 * second would pin every column and stop the sheet's own default applying.
 */
export function colWidthPx(info: XlsxColInfo | undefined | null): number | null {
  if (!info) return null;
  /* Exact when the file carried pixels. */
  if (typeof info.wpx === "number" && info.wpx > 0) return Math.round(info.wpx);
  const ch = typeof info.wch === "number" ? info.wch : info.width;
  if (typeof ch !== "number" || !(ch > 0)) return null;
  return Math.round(ch * PX_PER_CH + CELL_PADDING_PX);
}

/** The inverse, for export. Characters, because that is what Excel stores. */
export function colWidthToWch(px: number): number {
  const ch = (px - CELL_PADDING_PX) / PX_PER_CH;
  /* Never below one character: a zero would read as a hidden column in Excel,
     which is a different thing from a narrow one. */
  return Math.max(1, Math.round(ch * 100) / 100);
}

/** A row's height in pixels, or null when the file did not set one. */
export function rowHeightPx(info: XlsxRowInfo | undefined | null): number | null {
  if (!info) return null;
  if (typeof info.hpx === "number" && info.hpx > 0) return Math.round(info.hpx);
  if (typeof info.hpt === "number" && info.hpt > 0)
    return Math.round(info.hpt * PX_PER_PT);
  return null;
}

/** The inverse, for export. Points. */
export function rowHeightToHpt(px: number): number {
  return Math.max(1, Math.round((px / PX_PER_PT) * 100) / 100);
}
