/**
 * How big a picture is allowed to arrive, and the cell it lands in.
 *
 * ## Two different limits, and only one of them lives here
 *
 * A picture dropped into a cell sizes that cell: a 320×240 photo gives a
 * 320×240 cell, because a picture squeezed into a 100×24 default is not a
 * picture, it is a smudge. Left at that, a 4000×3000 camera file would give a
 * cell taller than the window and a sheet nobody can scroll past.
 *
 * So there is a ceiling — but it applies **at import only**. Anything larger is
 * scaled down to fit inside the box, keeping its aspect ratio, and the cell
 * takes the scaled size. Afterwards the cell is an ordinary cell: drag it to
 * whatever size you like, bigger than the box included. That is the whole
 * distinction the owner asked for, and it is why this function is about the
 * ARRIVING image and nothing else — no resize path should call it.
 *
 * The picture is never enlarged. A 40×40 icon stays 40×40 rather than being
 * blown up to fill the box: upscaling a small image produces a blurred one, and
 * nobody dragged anything to ask for that.
 */

/** The widest a picture may arrive. Five default columns across. */
export const MAX_IMPORT_WIDTH = 480;
/** The tallest a picture may arrive. Fifteen default rows down. */
export const MAX_IMPORT_HEIGHT = 360;

export interface PixelSize {
  width: number;
  height: number;
}

export interface ImportFit extends PixelSize {
  /** Whether the ceiling actually moved it — what the UI reports to the user. */
  scaled: boolean;
}

const DEFAULT_BOX: PixelSize = {
  width: MAX_IMPORT_WIDTH,
  height: MAX_IMPORT_HEIGHT,
};

function usable(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/**
 * The size a picture should occupy when it arrives in a cell.
 *
 * `natural` is the image's own pixel size — `naturalWidth`/`naturalHeight` off
 * a decoded `HTMLImageElement`, or the dimensions of whatever the editor
 * produced after a crop.
 *
 * Returns whole pixels, because that is what a row height and a column width
 * are; a fractional column width lands on a device pixel boundary and the
 * picture picks up a half-pixel of blur along one edge.
 */
export function fitImportSize(
  natural: PixelSize,
  box: PixelSize = DEFAULT_BOX,
): ImportFit {
  const w = natural.width;
  const h = natural.height;
  /* A file that will not decode, or decodes to nothing. The caller cannot size
     a cell from it, so hand back the box rather than a zero-sized cell that
     would be invisible and unclickable. */
  if (!usable(w) || !usable(h)) {
    return { width: box.width, height: box.height, scaled: true };
  }

  /* `1` in the list is what makes this a ceiling rather than a fit-to-box: a
     picture smaller than the box scales by 1 and arrives at its own size. */
  const scale = Math.min(1, box.width / w, box.height / h);
  if (scale === 1) return { width: Math.round(w), height: Math.round(h), scaled: false };

  return {
    /* At least 1: a 4000×1 sliver would otherwise round its height to zero and
       vanish into a cell with no content. */
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scaled: true,
  };
}

/**
 * What to tell somebody whose picture was shrunk on the way in.
 *
 * Said once, at import, and never again — the cell is free to be any size after
 * this, so a persistent warning would be describing a rule that has stopped
 * applying.
 */
export function importResizeNotice(
  natural: PixelSize,
  fitted: ImportFit,
): string | null {
  if (!fitted.scaled) return null;
  if (!usable(natural.width) || !usable(natural.height)) {
    return `That image could not be measured, so it was placed at ${fitted.width} × ${fitted.height}.`;
  }
  return `Resized from ${Math.round(natural.width)} × ${Math.round(natural.height)} to ${fitted.width} × ${fitted.height} to fit the maximum import size. You can drag the cell larger from here.`;
}
