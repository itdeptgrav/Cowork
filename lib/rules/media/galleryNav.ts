/**
 * Index arithmetic for the image gallery — the whole of "which image is
 * showing" as pure functions, so the viewer component holds no logic a test
 * cannot reach without a DOM.
 *
 * **Non-wrapping on purpose.** At the first image, Previous does nothing; at the
 * last, Next does nothing. The ends are a real signal — "there is no more this
 * way" — and wrapping around silently hides how many images there are and where
 * in them you stand, which is the one thing the viewer has to make obvious.
 */

/** Force an index inside `[0, length - 1]`. An empty list clamps to 0. */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index > length - 1) return length - 1;
  return index;
}

/**
 * Move `delta` steps from `index`, stopping at the ends rather than wrapping.
 * `delta` is normally ±1 (one Previous/Next), but any step is clamped.
 */
export function stepIndex(index: number, delta: number, length: number): number {
  return clampIndex(index + delta, length);
}

/** Whether a Previous/Next step would actually move — what disables an arrow. */
export function canStep(index: number, delta: number, length: number): boolean {
  return stepIndex(index, delta, length) !== clampIndex(index, length);
}
