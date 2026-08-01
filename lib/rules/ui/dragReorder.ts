/**
 * Dragging a row to a new place in a list.
 *
 * ## Why this is a rule and not code inside the component
 *
 * Two things go wrong in every hand-written reorder, and both are arithmetic
 * rather than DOM: which gap the pointer is over, and the off-by-one when a row
 * moves DOWNWARD past its own old position. The second has already been the
 * subject of a regression guard in this repo — a regex reading the component's
 * source, because there was no function to test. There is one now.
 *
 * Nothing here touches the DOM, React, or a drag event. The caller measures; this
 * decides.
 *
 * `lib/rules/performance/deviceMode.ts` is the precedent for a non-business rule
 * living under `lib/rules/`.
 */

export interface RowOffset {
  /** Distance from the top of the list to the top of this row, in pixels. */
  top: number;
  height: number;
}

/**
 * Which GAP the pointer is over, 0..n.
 *
 * A gap index, not a row index: `0` is above the first row, `n` is below the
 * last. That is the number an insertion needs, and converting a row index into
 * it at the call site is where the "did the pointer mean above or below this
 * row" question gets answered twice and differently.
 *
 * The boundary is each row's MIDPOINT, so the gap flips when the pointer passes
 * the middle of a row rather than when it reaches an edge — which is what makes
 * a slow drag feel like it is tracking the pointer instead of snapping late.
 */
export function insertionIndex(offsets: readonly RowOffset[], y: number): number {
  if (offsets.length === 0) return 0;
  for (let i = 0; i < offsets.length; i += 1) {
    const row = offsets[i];
    if (y < row.top + row.height / 2) return i;
  }
  return offsets.length;
}

/**
 * Where the insertion line should be DRAWN, in pixels from the top of the list.
 *
 * The top of the row that would be pushed down, or the bottom of the last row
 * for a drop at the end. Returned rather than derived at the call site because
 * the indicator and the drop must agree — an indicator drawn from one rule and a
 * drop computed from another is a list that lands rows somewhere other than where
 * the line promised.
 */
export function insertionOffset(
  offsets: readonly RowOffset[],
  gapIndex: number,
): number {
  if (offsets.length === 0) return 0;
  if (gapIndex <= 0) return offsets[0].top;
  const at = Math.min(gapIndex, offsets.length);
  if (at >= offsets.length) {
    const last = offsets[offsets.length - 1];
    return last.top + last.height;
  }
  return offsets[at].top;
}

/**
 * Move one id to a gap, returning the new order.
 *
 * **The off-by-one lives here and nowhere else.** The gap index counts the
 * dragged row while it is still in place, so a downward move lands one short
 * without the adjustment — the bug that makes a row dragged to the bottom stop
 * one from the bottom, every time, in every list anybody writes.
 *
 * Returns the input order unchanged when the move is a no-op or the id is not in
 * the list, so a caller can compare by identity to decide whether anything
 * happened.
 */
export function moveWithin(
  ids: readonly string[],
  id: string,
  gapIndex: number,
): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return [...ids];

  const to = gapIndex > from ? gapIndex - 1 : gapIndex;
  const clamped = Math.max(0, Math.min(ids.length - 1, to));
  if (clamped === from) return [...ids];

  const next = [...ids];
  next.splice(from, 1);
  next.splice(clamped, 0, id);
  return next;
}

/** Did this move change anything? Compared as a sequence, never as a set. */
export function orderChanged(
  before: readonly string[],
  after: readonly string[],
): boolean {
  if (before.length !== after.length) return true;
  return before.some((id, i) => id !== after[i]);
}
