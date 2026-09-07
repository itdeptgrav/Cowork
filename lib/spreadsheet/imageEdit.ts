/**
 * Crop and rotation arithmetic for the picture editor.
 *
 * Pure and DOM-free, like `metrics.ts` next door: it takes numbers and returns
 * numbers, so the awkward part of the editor — what a crop rectangle means
 * after two rotations — can be proven at a terminal instead of by dragging a
 * handle and squinting.
 *
 * ## The order of operations, fixed here so the canvas cannot disagree
 *
 * **Rotate first, then crop.** The crop rectangle is expressed in the ROTATED
 * image's coordinates, which is the only order that matches what somebody is
 * looking at: they turn the picture upright, then draw a box around the part
 * they want. Cropping first and rotating after would leave the box they drew
 * lying on its side.
 *
 * Rotation is in quarter turns, not degrees. A free-angle rotation needs a
 * larger canvas, a fill colour for the corners it exposes, and a decision about
 * what happens to the crop box — none of which the owner asked for, and each of
 * which is a visible choice rather than an implementation detail.
 */

import type { PixelSize } from "./imageImport.ts";

export interface CropRect {
  /** Left edge, in the ROTATED image's pixels. */
  x: number;
  /** Top edge, in the ROTATED image's pixels. */
  y: number;
  width: number;
  height: number;
}

export interface ImageEdit {
  /** Clockwise quarter turns. Normalized to 0–3 by `normalizeTurns`. */
  turns: number;
  /** Absent means the whole (rotated) image. */
  crop?: CropRect;
}

/**
 * Quarter turns as 0–3.
 *
 * Turning right four times is turning right zero times, and somebody who holds
 * the button will get there. Negative input works too, so an anticlockwise
 * button can pass -1 rather than doing its own arithmetic.
 */
export function normalizeTurns(turns: number): number {
  if (!Number.isFinite(turns)) return 0;
  return ((Math.trunc(turns) % 4) + 4) % 4;
}

/** The size of an image after `turns` quarter turns — swapped on the odd ones. */
export function rotatedSize(natural: PixelSize, turns: number): PixelSize {
  const t = normalizeTurns(turns);
  return t % 2 === 0
    ? { width: natural.width, height: natural.height }
    : { width: natural.height, height: natural.width };
}

/**
 * A crop rectangle forced inside the image it belongs to.
 *
 * Called on every drag rather than only at the end: a handle dragged past the
 * edge should stop at the edge, not be rejected when the mouse comes up after
 * the picture has already been drawn wrong for a second.
 *
 * Returns null when there is no image to crop — a caller with a zero-sized
 * bound has nothing to clamp against and should be showing an error, not a
 * rectangle.
 */
export function clampCrop(crop: CropRect, bounds: PixelSize): CropRect | null {
  const bw = Math.floor(bounds.width);
  const bh = Math.floor(bounds.height);
  if (!Number.isFinite(bw) || !Number.isFinite(bh) || bw < 1 || bh < 1) return null;

  /* Width first, then position: a rectangle wider than the image can only be
     fixed by making it narrower, and clamping x against a width that is still
     too big would push it off the other edge. */
  const w = Math.min(Math.max(1, Math.round(crop.width) || 1), bw);
  const h = Math.min(Math.max(1, Math.round(crop.height) || 1), bh);
  const x = Math.min(Math.max(0, Math.round(crop.x) || 0), bw - w);
  const y = Math.min(Math.max(0, Math.round(crop.y) || 0), bh - h);
  return { x, y, width: w, height: h };
}

/** The whole image as a crop rectangle — the editor's resting state. */
export function fullCrop(size: PixelSize): CropRect {
  return { x: 0, y: 0, width: Math.max(1, Math.round(size.width)), height: Math.max(1, Math.round(size.height)) };
}

/**
 * The size the edit produces, before the import ceiling is applied.
 *
 * Two separate steps on purpose: this one is what the person chose, and
 * `fitImportSize` is what the sheet will allow. Folding them together would
 * make the editor's own preview disagree with the cell it lands in.
 */
export function editedSize(natural: PixelSize, edit: ImageEdit): PixelSize {
  const rotated = rotatedSize(natural, edit.turns);
  if (!edit.crop) return rotated;
  const crop = clampCrop(edit.crop, rotated);
  return crop ? { width: crop.width, height: crop.height } : rotated;
}

/**
 * Whether the edit would change the picture at all.
 *
 * An editor closed without touching anything should hand back the original
 * file, not a re-encoded copy of it: re-encoding a JPEG loses a generation of
 * quality and throws away whatever the camera put in the file, for no change
 * anybody asked for.
 */
export function isIdentityEdit(natural: PixelSize, edit: ImageEdit): boolean {
  if (normalizeTurns(edit.turns) !== 0) return false;
  if (!edit.crop) return true;
  const crop = clampCrop(edit.crop, natural);
  if (!crop) return true;
  return (
    crop.x === 0 &&
    crop.y === 0 &&
    crop.width === Math.round(natural.width) &&
    crop.height === Math.round(natural.height)
  );
}
