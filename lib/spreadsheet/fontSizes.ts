/**
 * The font sizes a spreadsheet toolbar offers, and how the A+ / A− buttons
 * move between them.
 *
 * ## The defect this exists to fix
 *
 * The picker offered a LADDER — 10, 11, 12, 13, 14, 16, 18, 24, 32 — and the
 * grow and shrink buttons stepped by **one**. Those two disagree the moment
 * you pass 14: a press took the size to 15, which is not a rung, so the
 * `<select>` beside the buttons had no option matching its own value and
 * stopped showing the size at all. Press again and it landed on 16 and
 * reappeared.
 *
 * From the outside that is exactly "the button and the number are not
 * connected": most presses moved the text in the cell and left the number
 * beside it stuck or blank.
 *
 * Stepping the ladder is also what every other size picker does — including
 * this product's own document toolbar, which had the right behaviour in a
 * private helper the spreadsheet could not reach. This is that helper, made
 * shared and tested, so the two cannot drift again.
 *
 * ## Sizes that are not on the ladder
 *
 * They arrive: a workbook opened from a file carries whatever Excel had, and
 * anything set before this fix could be any whole number. `fontSizeOptions`
 * therefore adds the current size to the list when it is not a rung, so the
 * picker can always show what is actually applied. A control that cannot
 * display its own value is the bug above in a different costume.
 */

/** The rungs, ascending. */
export const FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 24, 32] as const;

/**
 * What an unstyled cell is drawn at.
 *
 * Must match `GridBody`'s own fallback, or the toolbar reports a size the grid
 * is not using.
 */
export const DEFAULT_FONT_SIZE = 13;

/** Excel's own bounds, and the ones the buttons already clamped to. */
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 96;

/**
 * One rung up or down from wherever the size is now.
 *
 * A size BETWEEN rungs moves to the next rung in that direction rather than to
 * `current ± 1`, so a sheet that arrived at 15pt from a file joins the ladder
 * on the first press instead of walking up it one point at a time.
 *
 * Past either end it falls back to single steps, clamped — 32 is the largest
 * rung offered but not the largest size allowed, and refusing to grow at all
 * would be a worse answer than growing by one.
 */
export function stepFontSize(current: number, direction: 1 | -1): number {
  const from = Number.isFinite(current) ? current : DEFAULT_FONT_SIZE;
  const rung =
    direction === 1
      ? FONT_SIZES.find((s) => s > from)
      : [...FONT_SIZES].reverse().find((s) => s < from);
  const next = rung ?? from + direction;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, next));
}

/**
 * The options a picker should render, given what is currently applied.
 *
 * The ladder, plus the current size where it is not already on it, so the
 * control can always show its own value. Sorted, because an out-of-place
 * number in a numeric list reads as a fault in the list.
 */
export function fontSizeOptions(current: number): number[] {
  const base = [...FONT_SIZES];
  if (!Number.isFinite(current) || base.includes(current as never)) return base;
  return [...base, current].sort((a, b) => a - b);
}
