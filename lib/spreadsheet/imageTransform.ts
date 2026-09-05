/**
 * Resizing a picture already in a cell, by dragging a box around it.
 *
 * ## Why this is not the import rule
 *
 * `imageImport.ts` puts a ceiling on the way in, so a camera file cannot
 * arrive as a cell taller than the window. Nothing here has a ceiling: once
 * the picture is in the sheet the cell is an ordinary cell, and dragging it to
 * any size is the owner's business. The only bounds are the grid's own
 * minimums — the same 24 × 16 a column or row drag stops at — because a cell
 * dragged to nothing leaves no handle to drag it back by.
 *
 * ## Which handles keep the shape
 *
 * A CORNER keeps the picture's proportions; an EDGE does not. That is the
 * convention everywhere this gesture exists, and it is the useful split: the
 * corners are for "bigger" and "smaller", the edges are for the rarer case of
 * deliberately squashing something. Locking all eight would make a wrongly
 * shaped cell unfixable without leaving the box; freeing all eight would make
 * every ordinary resize distort the picture.
 *
 * Pure and DOM-free: pointer deltas in, a cell size out.
 */

import type { PixelSize } from "./imageImport.ts";

/** Compass points, as a resize box has always named them. */
export type TransformHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

export const TRANSFORM_HANDLES: readonly TransformHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

/** A corner keeps the aspect ratio; an edge is free in its one axis. */
export function keepsRatio(handle: TransformHandle): boolean {
  return handle.length === 2;
}

/** Which way the handle pushes each edge. 0 means that axis does not move. */
function direction(handle: TransformHandle): { x: number; y: number } {
  return {
    x: handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0,
    y: handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0,
  };
}

export interface TransformInput {
  /** The cell's size when the drag began. */
  start: PixelSize;
  handle: TransformHandle;
  /** Pointer movement since the drag began, in the same pixels as `start`. */
  dx: number;
  dy: number;
  /**
   * The picture's own width ÷ height, for the corner handles.
   *
   * Taken from the PICTURE and not from the cell, so a cell somebody has
   * already squashed snaps back to the picture's true shape on the first
   * corner drag rather than preserving the distortion for ever.
   */
  ratio?: number;
  min?: PixelSize;
}

const MIN: PixelSize = { width: 24, height: 16 };

/**
 * The cell size a drag has produced.
 *
 * A north or west handle grows the cell as the pointer moves the OTHER way,
 * which is what `direction` is for — the cell's top-left is pinned to the grid
 * and cannot move, so dragging the top edge upward can only mean "taller".
 */
export function transformCellSize(input: TransformInput): PixelSize {
  const { start, handle, dx, dy } = input;
  const min = input.min ?? MIN;
  const d = direction(handle);

  let width = start.width + d.x * dx;
  let height = start.height + d.y * dy;

  if (keepsRatio(handle) && input.ratio && input.ratio > 0 && Number.isFinite(input.ratio)) {
    /* Follow whichever axis the pointer moved further in, so a diagonal drag
       tracks the hand rather than jumping between two candidate sizes as the
       dominant axis changes. Compared as a FRACTION of the starting size:
       comparing raw pixels makes the wide axis win every time on a wide
       picture, and the box then ignores vertical movement almost entirely. */
    const byWidth = Math.abs(width - start.width) / Math.max(1, start.width);
    const byHeight = Math.abs(height - start.height) / Math.max(1, start.height);
    if (byWidth >= byHeight) height = width / input.ratio;
    else width = height * input.ratio;
  }

  return {
    width: Math.max(min.width, Math.round(width)),
    height: Math.max(min.height, Math.round(height)),
  };
}

/**
 * The picture's aspect ratio, or undefined when it cannot be known yet.
 *
 * `naturalWidth` is 0 until the image has decoded, and dividing by that gives
 * Infinity — a corner drag would then set the height to zero and the cell
 * would collapse on the first pixel of movement.
 */
export function ratioOf(natural: Partial<PixelSize> | null | undefined): number | undefined {
  const w = natural?.width;
  const h = natural?.height;
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h) || h <= 0) return undefined;
  return w / h;
}
