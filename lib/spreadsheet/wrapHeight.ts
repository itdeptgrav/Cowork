/**
 * How tall a row has to be for its wrapped text to actually be readable.
 *
 * ## The defect this fixes
 *
 * Wrap text set `white-space: normal` and stopped there. The text duly wrapped
 * onto a second and third line — inside a cell still 24px tall, with
 * `overflow: hidden` over it. So turning wrapping ON made the text *less*
 * visible than leaving it off: unwrapped, a long value at least spilled far
 * enough to read; wrapped, everything below the first line was simply cut away.
 * The one control whose whole purpose is "show me all of this" hid most of it.
 *
 * Row height is what was missing. `rowHeights` only ever held heights somebody
 * set BY HAND, and nothing derived one from content.
 *
 * ## Why the line height is pinned here
 *
 * The height has to be computed before the browser lays the text out, so this
 * has to predict what the browser will do. Left at CSS `normal`, line height
 * depends on the font's own metrics and varies between fonts and platforms —
 * so a prediction would be wrong by a line or two on somebody else's machine,
 * which is worse than not predicting at all.
 *
 * So the wrapped cell is given an EXPLICIT line height, `WRAP_LINE_HEIGHT`, and
 * this module multiplies by the same constant. The render and the measurement
 * agree because they are the same number, not because they were tuned to match.
 */

/** Multiplier on the font size for a wrapped line. Mirrored in `cellStyle.ts`;
    the two must not drift, which is why neither writes the number itself. */
export const WRAP_LINE_HEIGHT = 1.35;

/** `px-1.5` on the cell — 6px a side. */
export const CELL_PADDING_X = 12;

/** Top and bottom breathing room, so wrapped text is not flush to the lines. */
export const CELL_PADDING_Y = 3;

/**
 * How many lines this text takes in a box of `available` pixels.
 *
 * `measure` is injected rather than reached for: the browser measures text with
 * a canvas, which does not exist under the test runner, and a line-breaking
 * rule that can only be checked in a browser is one nobody checks. Callers in
 * the grid pass a canvas-backed measurer; the tests pass arithmetic.
 *
 * The algorithm is the browser's, as far as it matters here:
 *
 *   · explicit newlines always break;
 *   · otherwise words are packed greedily;
 *   · a single word too long for the line is broken across lines by character,
 *     which is what `word-break: break-word` does — and skipping it is how a
 *     pasted URL in a narrow column reports one line and gets clipped to one
 *     line while occupying four.
 */
export function wrapLineCount(
  text: string,
  available: number,
  measure: (s: string) => number,
): number {
  if (!text) return 1;
  /* A column narrower than a character cannot be reasoned about; one line is
     the honest answer and avoids a loop that never advances. */
  if (!(available > 0)) return 1;

  let lines = 0;
  for (const paragraph of String(text).split("\n")) {
    if (paragraph === "") {
      lines += 1;
      continue;
    }
    const words = paragraph.split(/(\s+)/).filter((w) => w !== "");
    let current = "";
    for (const word of words) {
      const candidate = current + word;
      if (measure(candidate) <= available) {
        current = candidate;
        continue;
      }
      /* It does not fit. Close the current line — unless the overflowing token
         is the leading whitespace of a line, which is dropped as the browser
         does rather than carried onto the next line. */
      if (current.trim() !== "") {
        lines += 1;
        current = "";
      }
      if (/^\s+$/.test(word)) continue;

      /* The word alone on a line: if it still does not fit, break it. */
      let rest = word;
      while (measure(rest) > available) {
        /* Find the longest prefix that fits. Linear rather than binary — a
           cell's text is short, and a wrong split is worse than a slow one. */
        let cut = 1;
        while (cut < rest.length && measure(rest.slice(0, cut + 1)) <= available) {
          cut += 1;
        }
        lines += 1;
        rest = rest.slice(cut);
        if (cut === 0) break; /* Cannot advance; stop rather than spin. */
      }
      current = rest;
    }
    /* Whatever is left is the last line of this paragraph. Empty means the
       final word closed a line exactly and there is no remainder. */
    if (current !== "") lines += 1;
  }
  return Math.max(1, lines);
}

/** The height one wrapped cell needs, for a given number of lines. */
export function wrappedCellHeight(lines: number, fontSize: number): number {
  return Math.ceil(
    Math.max(1, lines) * fontSize * WRAP_LINE_HEIGHT + CELL_PADDING_Y * 2,
  );
}

/**
 * The height a row needs — the tallest of its wrapped cells, never below the
 * default.
 *
 * A row is never made SHORTER than the sheet's default by this: auto-fit
 * decides how much more room wrapped content needs, and shrinking a row nobody
 * asked to shrink would move every row below it for no reason anybody could
 * see.
 */
export function autoRowHeight(
  cellHeights: readonly number[],
  defaultHeight: number,
): number {
  let tallest = defaultHeight;
  for (const h of cellHeights) if (h > tallest) tallest = h;
  return tallest;
}

/**
 * The heights a sheet actually renders at: the taller of what is stored and
 * what the wrapped text needs.
 *
 * ## Why a stored height is a floor and not a ceiling
 *
 * This started as "a stored height always wins", on the reasoning that
 * somebody who dragged a row border had already answered the question. That is
 * true of a dragged row and false of every other way a height gets stored —
 * and the second is far more common, because a height arrives with the FILE.
 * A workbook whose rows were sized for unwrapped text opens here, every row
 * carries a height, and auto-fit is locked out of all of them: the text wraps
 * and is then clipped by a row that will not grow.
 *
 * So the rule is the max. Wrapped text is always fully visible, which is the
 * entire point of asking for it, and a row explicitly made TALLER than its
 * content still keeps that room.
 *
 * The one thing this gives up is deliberately making a row SHORTER than its
 * wrapped text. That is not a loss worth protecting: it is a row that hides
 * what is in it, and turning wrapping off is the way to ask for that.
 */
export function mergeRowHeights(
  auto: Readonly<Record<number, number>>,
  stored: Readonly<Record<number, number>>,
): Record<number, number> {
  const out: Record<number, number> = { ...stored };
  for (const [key, height] of Object.entries(auto)) {
    const row = Number(key);
    const existing = out[row];
    if (existing === undefined || height > existing) out[row] = height;
  }
  return out;
}
