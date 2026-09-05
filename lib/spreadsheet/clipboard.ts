/**
 * Clipboard — copy, cut and paste over ranges, and the bridge to the browser.
 *
 * Two representations sit side by side, on purpose:
 *
 *  · The INTERNAL clipboard (`Clipboard`) keeps each cell's RAW content and the
 *    rectangle it came from. Pasting it back into the app can therefore adjust
 *    relative formulas (a copy of `=A1*2` becomes `=A2*2` a row down) — fidelity
 *    the browser clipboard cannot carry.
 *
 *  · The SYSTEM clipboard gets tab-separated DISPLAYED values (`toTSV`), the
 *    lingua franca every spreadsheet speaks. That is what leaves the app, and
 *    what an external paste arrives as (`fromTSV`) — a 2×3 block of tabs and
 *    newlines becoming a 2×3 range, exactly as the spec's example asks.
 *
 * The React hook writes the TSV to the browser on copy/cut and remembers it; on
 * paste it prefers the internal clipboard when the system text still matches
 * (an in-app round trip), and falls back to parsing the system text when it does
 * not (data from elsewhere). This module is the pure half: it has no `navigator`
 * and no React — it builds, serialises, parses, and computes paste edits.
 */

import type { CellPos, Rect } from "./coordinates";
import { adjustFormula } from "./formula/references";
import type { FormulaEngine } from "./formula";
import { getCellStyleId, getCellValue, type Worksheet } from "./model";
import type { Bounds } from "./selection";
import type { CellEdit } from "./history";

/** A copied or cut block: raw cell content, the styles alongside it, and where
    it came from. */
export interface Clipboard {
  rows: number;
  cols: number;
  /** Raw content, row-major, `""` for a blank cell. */
  cells: string[][];
  /** Style ids alongside `cells`, so formatting travels with a copy or cut
      (Phase 5). `0` for a cell with the default style. */
  styles: number[][];
  /** The source rectangle — the origin relative formulas are measured from, and
      (for a cut) the cells cleared when the block is pasted. */
  source: Rect;
  /** Whether this was a cut: the source is emptied on paste, and formulas move
      verbatim rather than being re-based. */
  cut: boolean;
  /**
   * The size of each copied cell that holds a PICTURE, block-relative.
   *
   * A picture sizes the cell it lives in, so that size is part of the picture
   * the way a style is: copy one elsewhere and arriving at the default 100 × 24
   * would be arriving cropped.
   *
   * Carried here and not in `styles` because a row height and a column width
   * are not cell properties — they belong to the row and the column. Writing
   * them for every copied cell would mean an ordinary paste of text silently
   * resized whatever columns it landed on. Picture cells only, for that reason.
   */
  imageSizes?: readonly CopiedImageSize[];
}

/** One picture cell's size, positioned relative to the copied block. */
export interface CopiedImageSize {
  /** Rows below the block's top-left. */
  row: number;
  /** Columns right of the block's top-left. */
  col: number;
  width: number;
  height: number;
}

/** Read a rectangle's RAW content AND styles into an internal clipboard block. */
export function copyRange(
  ws: Worksheet,
  rect: Rect,
  cut = false,
  /**
   * Whether that cell shows a picture. Supplied by the caller because only the
   * formula engine can answer it — a cell may arrive at a picture through a
   * reference rather than by holding `=IMAGE(` itself.
   */
  holdsImage?: (row: number, col: number) => boolean,
): Clipboard {
  const rows = rect.bottom - rect.top + 1;
  const cols = rect.right - rect.left + 1;
  const cells: string[][] = [];
  const styles: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const line: string[] = [];
    const styleLine: number[] = [];
    for (let c = 0; c < cols; c++) {
      line.push(getCellValue(ws, rect.top + r, rect.left + c));
      styleLine.push(getCellStyleId(ws, rect.top + r, rect.left + c));
    }
    cells.push(line);
    styles.push(styleLine);
  }
  const imageSizes: CopiedImageSize[] = [];
  if (holdsImage) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const row = rect.top + r;
        const col = rect.left + c;
        if (!holdsImage(row, col)) continue;
        imageSizes.push({
          row: r,
          col: c,
          width: ws.colWidths[col] ?? ws.defaultColWidth,
          height: ws.rowHeights[row] ?? ws.defaultRowHeight,
        });
      }
    }
  }
  return {
    rows,
    cols,
    cells,
    styles,
    source: rect,
    cut,
    ...(imageSizes.length ? { imageSizes } : {}),
  };
}

/**
 * Where each copied picture's size lands, given the paste site.
 *
 * Clipped to the sheet like every other part of a paste: a block pasted near
 * the right edge loses its overhanging columns, and their sizes with them.
 */
export function pasteSizes(
  clip: Clipboard,
  target: CellPos,
  bounds: Bounds,
): CopiedImageSize[] {
  const out: CopiedImageSize[] = [];
  for (const size of clip.imageSizes ?? []) {
    const row = target.row + size.row;
    const col = target.col + size.col;
    if (row >= bounds.rows || col >= bounds.cols) continue;
    out.push({ row, col, width: size.width, height: size.height });
  }
  return out;
}

/**
 * A rectangle's DISPLAYED values as tab-separated text for the system clipboard.
 * Rows are newline-joined, columns tab-joined — the format the spec shows and
 * every spreadsheet exchanges.
 */
export function toTSV(
  ws: Worksheet,
  engine: FormulaEngine,
  sheetId: string,
  rect: Rect,
): string {
  const lines: string[] = [];
  for (let r = rect.top; r <= rect.bottom; r++) {
    const fields: string[] = [];
    for (let c = rect.left; c <= rect.right; c++) {
      /* A truly empty cell contributes an empty field; a populated one shows the
         engine's computed text, so what is copied matches what is seen. */
      fields.push(getCellValue(ws, r, c) === "" ? "" : engine.display(sheetId, r, c).text);
    }
    lines.push(fields.join("\t"));
  }
  return lines.join("\n");
}

/**
 * Parse tab-separated text into a rectangular grid of raw values. Handles CRLF,
 * a single trailing newline, and ragged rows (short rows are padded so the
 * result is a true rectangle).
 */
export function parseTSV(text: string): string[][] {
  let body = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  /* Drop one trailing newline so "a\tb\n" is one row, not one row and a blank. */
  if (body.endsWith("\n")) body = body.slice(0, -1);
  if (body === "") return [[""]];
  const rows = body.split("\n").map((line) => line.split("\t"));
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  for (const row of rows) {
    while (row.length < width) row.push("");
  }
  return rows;
}

/** An external TSV paste as a clipboard block: values only (default style), no
    source, no cut. */
export function fromTSV(text: string): Clipboard {
  const cells = parseTSV(text);
  const rows = cells.length;
  const cols = cells[0]?.length ?? 0;
  const styles = cells.map((line) => line.map(() => 0));
  return {
    rows,
    cols,
    cells,
    styles,
    source: { top: 0, left: 0, bottom: rows - 1, right: cols - 1 },
    cut: false,
  };
}

/**
 * The edits pasting a clipboard block at a target cell produces.
 *
 * The block's top-left lands on `target`; the delta from its source top-left is
 * the same for every cell, so a copy adjusts each formula by that one delta
 * (`adjustFormulas`), while a cut or an external paste moves formulas verbatim.
 * Cells that would fall outside the grid are dropped rather than clamped, so a
 * paste near the edge writes what fits and no more.
 */
export function pasteEdits(
  clip: Clipboard,
  target: CellPos,
  bounds: Bounds,
  adjustFormulas: boolean,
): CellEdit[] {
  const dRow = target.row - clip.source.top;
  const dCol = target.col - clip.source.left;
  const edits: CellEdit[] = [];
  for (let r = 0; r < clip.rows; r++) {
    for (let c = 0; c < clip.cols; c++) {
      const row = target.row + r;
      const col = target.col + c;
      if (row >= bounds.rows || col >= bounds.cols) continue;
      const raw = clip.cells[r][c] ?? "";
      edits.push({
        row,
        col,
        raw: adjustFormulas ? adjustFormula(raw, dRow, dCol) : raw,
      });
    }
  }
  return edits;
}

/**
 * The style edits a paste produces — the source cell's style laid onto each
 * destination, so formatting travels with the block (Phase 5). A style of 0 is
 * emitted too, so pasting an unformatted cell CLEARS the destination's old
 * formatting, the way a paste replaces rather than merges.
 */
export function pasteStyles(clip: Clipboard, target: CellPos, bounds: Bounds): CellEdit[] {
  const edits: CellEdit[] = [];
  for (let r = 0; r < clip.rows; r++) {
    for (let c = 0; c < clip.cols; c++) {
      const row = target.row + r;
      const col = target.col + c;
      if (row >= bounds.rows || col >= bounds.cols) continue;
      edits.push({ row, col, style: clip.styles[r]?.[c] ?? 0 });
    }
  }
  return edits;
}

/** The edits that clear a cut block's source VALUES (before the paste overlays
    the ones it lands on). Pairs with `clearSourceStyles` for the formatting. */
export function clearSourceEdits(clip: Clipboard): CellEdit[] {
  const edits: CellEdit[] = [];
  for (let r = clip.source.top; r <= clip.source.bottom; r++) {
    for (let c = clip.source.left; c <= clip.source.right; c++) {
      edits.push({ row: r, col: c, raw: "" });
    }
  }
  return edits;
}

/** The edits that clear a cut block's source STYLES — a cut empties the cell's
    formatting along with its value. */
export function clearSourceStyles(clip: Clipboard): CellEdit[] {
  const edits: CellEdit[] = [];
  for (let r = clip.source.top; r <= clip.source.bottom; r++) {
    for (let c = clip.source.left; c <= clip.source.right; c++) {
      edits.push({ row: r, col: c, style: 0 });
    }
  }
  return edits;
}

/** The rectangle a paste of `clip` at `target` fills — for reselecting it. */
export function pasteRect(clip: Clipboard, target: CellPos, bounds: Bounds): Rect {
  return {
    top: target.row,
    left: target.col,
    bottom: Math.min(bounds.rows - 1, target.row + clip.rows - 1),
    right: Math.min(bounds.cols - 1, target.col + clip.cols - 1),
  };
}

/**
 * The same block turned on its side: rows become columns. Formulas are kept
 * as they are — a transposed relative reference would point somewhere else
 * entirely, so a pasted transpose is treated as values, the way Paste values
 * is. The source rectangle is swapped too, so the pasted extent is right.
 */
export function transposeClipboard(clip: Clipboard): Clipboard {
  const cells: string[][] = [];
  const styles: number[][] = [];
  for (let c = 0; c < clip.cols; c++) {
    const row: string[] = [];
    const srow: number[] = [];
    for (let r = 0; r < clip.rows; r++) {
      row.push(clip.cells[r]?.[c] ?? "");
      srow.push(clip.styles[r]?.[c] ?? 0);
    }
    cells.push(row);
    styles.push(srow);
  }
  const { top, left } = clip.source;
  return {
    ...clip,
    rows: clip.cols,
    cols: clip.rows,
    cells,
    styles,
    source: { top, left, bottom: top + clip.cols - 1, right: left + clip.rows - 1 },
    cut: false,
  };
}
