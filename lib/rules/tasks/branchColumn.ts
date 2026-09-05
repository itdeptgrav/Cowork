/**
 * Where a team's column sits beside the person it belongs to.
 *
 * ## What was wrong
 *
 * The person picker opens a manager's team as its own column to the right. Every
 * column was top-aligned to the panel, so opening the team of somebody near the
 * BOTTOM of a long list put their people up at the top — level with names they
 * have nothing to do with, and a whole list-height away from the row that opened
 * them. The one relationship the columns exist to show, *these report to that
 * person*, was the one thing the layout did not say.
 *
 * So the column starts level with its own row. The chain then reads as a
 * staircase down and to the right, which is the shape of the reporting line.
 *
 * ## Why the offset has to be clamped
 *
 * Aligning naively puts a tall column off the bottom of the window whenever the
 * row is far enough down — the fix would create a list you cannot reach the end
 * of. So the column slides back UP as far as it needs to fit, and no further:
 * the alignment is a preference, staying on screen is not.
 *
 * It never slides above the panel's own top either. A negative offset would put
 * a team above the list it came out of, which reads as belonging to whatever is
 * up there instead.
 */

export function branchColumnTop(input: {
  /** The opening row's top, in pixels from the strip's content top. */
  rowTop: number;
  /** How tall the team's column will be once rendered. */
  columnHeight: number;
  /** Pixels between the strip's content top and the bottom of the window. */
  available: number;
  /** Clearance kept below the column. */
  margin?: number;
}): number {
  const { rowTop, columnHeight, available, margin = 12 } = input;
  const safe = (n: number) => (Number.isFinite(n) ? n : 0);
  /* The lowest top that still leaves the whole column on screen. Negative when
     the column is taller than the room it has — a list longer than the window
     — and the `max` below then pins it to the top, which is the best available
     answer rather than a nonsense one. */
  const lowest = safe(available) - safe(columnHeight) - margin;
  return Math.max(0, Math.min(safe(rowTop), lowest));
}
