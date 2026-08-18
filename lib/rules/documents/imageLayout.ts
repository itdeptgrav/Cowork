/**
 * How an image sits in a document: how wide, and which way the text goes round
 * it.
 *
 * **The reported gap, 17 Aug 2026.** An uploaded image landed at its natural
 * size, in the text flow, and could not be moved or made smaller. The owner
 * asked for the behaviour Word and Google Docs have: drag a corner to resize,
 * and align left, centre or right with the text wrapping around it.
 *
 * **Pure, and rendered as inline style.** The document is stored and reloaded
 * as HTML (`editor.getHTML()`), so anything the editor knows about an image
 * has to survive a round trip through markup. A class name would not — the
 * stylesheet is not saved with the document, and the same HTML is printed, put
 * in a PDF and sent by mail. Inline style travels with it.
 */

export const IMAGE_ALIGNMENTS = ["left", "center", "right"] as const;
export type ImageAlign = (typeof IMAGE_ALIGNMENTS)[number];

/** The default, and what an image with no stored alignment reads as. */
export const DEFAULT_ALIGN: ImageAlign = "center";

/**
 * Width bounds, as a percentage of the page's text column.
 *
 * Percentage rather than pixels: a document written on a wide screen and
 * printed on A4 must not have an image running off the page. 10% is small
 * enough to sit beside a paragraph as a thumbnail; 100% is the full column.
 */
export const MIN_WIDTH_PCT = 10;
export const MAX_WIDTH_PCT = 100;
export const DEFAULT_WIDTH_PCT = 100;

/**
 * A width the document can hold, whatever was dragged or typed.
 *
 * **Absent is not zero.** `Number(null)` and `Number("")` are both 0, which is
 * finite, so a naive clamp turned "no width recorded" into the MINIMUM — every
 * image in a document written before this existed would have opened as a 10%
 * thumbnail. Nothing stated means the default; only a real number is clamped.
 */
export function clampWidthPct(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_WIDTH_PCT;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_WIDTH_PCT;
  return Math.min(MAX_WIDTH_PCT, Math.max(MIN_WIDTH_PCT, Math.round(n)));
}

/** An alignment the document can hold. Anything unknown reads as the default. */
export function readAlign(value: unknown): ImageAlign {
  return IMAGE_ALIGNMENTS.includes(value as ImageAlign)
    ? (value as ImageAlign)
    : DEFAULT_ALIGN;
}

/**
 * The inline style for one image.
 *
 * **`float` for left and right, `margin: auto` for centre.** Floating is what
 * makes text wrap AROUND an image rather than sit above and below it, and it is
 * the one CSS mechanism that behaves the same in a browser, in a print
 * stylesheet and in the HTML mail clients render. A centred image is not
 * floated at all — text does not wrap around a centred image in Word either;
 * it sits on its own line.
 *
 * `max-width` alongside `width` so a 12MP photograph asked to be 100% cannot
 * push the page wider than the column it sits in.
 */
export function imageStyle(input: {
  widthPct: number;
  align: ImageAlign;
  /** Width over height, where the image has been freely stretched. */
  aspect?: number | null;
}): string {
  const width = clampWidthPct(input.widthPct);
  const align = readAlign(input.align);
  const aspect = clampAspect(input.aspect);

  const parts = [`width:${width}%`, "max-width:100%", "height:auto"];
  /* `height:auto` defers to `aspect-ratio` where one is set, and an <img>'s
     default `object-fit` is `fill` — the stretch the owner asked for, with no
     further property needed. */
  if (aspect !== null) parts.push(`aspect-ratio:${aspect}`);

  if (align === "center") {
    /* Block with automatic side margins — the standard centring that survives
       into print, where `text-align` on a parent does not always. */
    parts.push("display:block", "margin-left:auto", "margin-right:auto");
  } else {
    parts.push(`float:${align}`);
    /* Breathing room on the side the text runs down, and none on the outside
       edge, so a floated image lines up with the margin rather than sitting
       one gap inside it. */
    parts.push(
      align === "left" ? "margin:0 1rem 0.5rem 0" : "margin:0 0 0.5rem 1rem",
    );
  }

  return parts.join(";");
}

/**
 * Read a stored style back into the two facts.
 *
 * The HTML is the record — a document written before this existed, or edited
 * in another tool, still has to open. Anything unreadable falls back to the
 * defaults rather than refusing the image.
 */
export function readImageStyle(style: string | null | undefined): {
  widthPct: number;
  align: ImageAlign;
  /** Width over height where the image was freely stretched, else null. */
  aspect: number | null;
} {
  const s = String(style ?? "");
  const width = /width\s*:\s*([\d.]+)%/i.exec(s);
  const floated = /float\s*:\s*(left|right)/i.exec(s);
  const ratio = /aspect-ratio\s*:\s*([\d.]+)/i.exec(s);
  return {
    widthPct: width ? clampWidthPct(width[1]) : DEFAULT_WIDTH_PCT,
    align: floated ? readAlign(floated[1].toLowerCase()) : DEFAULT_ALIGN,
    aspect: ratio ? clampAspect(ratio[1]) : null,
  };
}

/**
 * The width a drag lands on, as a percentage of the column.
 *
 * Taken from the pointer's distance rather than a delta, so the corner stays
 * under the finger through a long drag instead of drifting away from it.
 * Dragging from the right edge grows to the right; from the left edge, the
 * arithmetic is mirrored so the image grows the way the hand moves.
 */
export function widthFromDrag(input: {
  /** Pointer x, in page coordinates. */
  pointerX: number;
  /** The image's left and right edges before the drag, in page coordinates. */
  leftX: number;
  rightX: number;
  /** The text column's width in pixels — what 100% means. */
  columnPx: number;
  /** Which handle is being dragged. */
  edge: "left" | "right";
}): number {
  if (!(input.columnPx > 0)) return DEFAULT_WIDTH_PCT;
  const px =
    input.edge === "right"
      ? input.pointerX - input.leftX
      : input.rightX - input.pointerX;
  return clampWidthPct((px / input.columnPx) * 100);
}

/* ── Handles ─────────────────────────────────────────────────────────────── */

/**
 * The eight grips, named by where they sit.
 *
 * Corners and sides both resize; what differs is which edges stay put. A
 * bottom-right drag holds the top-left corner still, a left drag holds the
 * right edge still, and so on — an image that jumps away from the hand is the
 * complaint every resize implementation gets wrong first.
 */
export const HANDLES = [
  "nw", "n", "ne",
  "w", /* centre */ "e",
  "sw", "s", "se",
] as const;
export type Handle = (typeof HANDLES)[number];

/** Which way this grip pulls. */
export function handleAxis(h: Handle): {
  horizontal: -1 | 0 | 1;
  vertical: -1 | 0 | 1;
} {
  return {
    horizontal: h.includes("w") ? -1 : h.includes("e") ? 1 : 0,
    vertical: h.startsWith("n") ? -1 : h.startsWith("s") ? 1 : 0,
  };
}

/** The cursor a grip should show — the diagonal ones differ by direction. */
export function handleCursor(h: Handle): string {
  const { horizontal, vertical } = handleAxis(h);
  if (horizontal === 0) return "ns-resize";
  if (vertical === 0) return "ew-resize";
  return horizontal === vertical ? "nwse-resize" : "nesw-resize";
}

/**
 * The width a drag from ANY of the eight grips lands on.
 *
 * **Aspect ratio is never broken**, so every grip changes one number: the
 * width. A vertical grip is therefore read through the image's own aspect —
 * dragging the bottom edge down by 50px on a 2:1 image widens it by 100px,
 * which is what "resize from the bottom" has to mean when the shape is fixed.
 *
 * Measured from the OPPOSITE edge, so that edge stays still and the grip stays
 * under the finger. A corner is measured horizontally; its vertical component
 * is a consequence of the aspect and needs no arithmetic of its own.
 */
export function widthFromHandleDrag(input: {
  handle: Handle;
  pointerX: number;
  pointerY: number;
  /** The image's box before the drag, in page coordinates. */
  rect: { left: number; right: number; top: number; bottom: number };
  /** The text column's width in pixels — what 100% means. */
  columnPx: number;
}): number {
  const { rect, columnPx } = input;
  if (!(columnPx > 0)) return DEFAULT_WIDTH_PCT;

  const { horizontal, vertical } = handleAxis(input.handle);
  const height = rect.bottom - rect.top;
  const width = rect.right - rect.left;

  /* A purely vertical grip: the new height, converted through the aspect the
     image already has. Guarded, because a zero-height box would divide by it. */
  if (horizontal === 0) {
    if (!(height > 0) || !(width > 0)) return DEFAULT_WIDTH_PCT;
    const nextHeight =
      vertical === 1 ? input.pointerY - rect.top : rect.bottom - input.pointerY;
    return clampWidthPct(((nextHeight * (width / height)) / columnPx) * 100);
  }

  const px =
    horizontal === 1 ? input.pointerX - rect.left : rect.right - input.pointerX;
  return clampWidthPct((px / columnPx) * 100);
}

/* ── Crop ────────────────────────────────────────────────────────────────── */

/**
 * The visible part of an image, as percentages of the whole.
 *
 * **Non-destructive, and deliberately so.** The alternative — cutting the
 * pixels and uploading the result — would create a second file in Drive for
 * every crop, leave the original orphaned, and make an accidental crop
 * permanent. Storing the rectangle means the upload and storage path is
 * untouched, the original is always recoverable, and a crop can be widened
 * again later.
 */
export interface Crop {
  /** Left edge, 0–100, as a percentage of the natural width. */
  x: number;
  /** Top edge, 0–100. */
  y: number;
  /** Visible width, 1–100. */
  w: number;
  /** Visible height, 1–100. */
  h: number;
}

export const FULL_CROP: Crop = { x: 0, y: 0, w: 100, h: 100 };

/** The smallest crop that still shows something. */
export const MIN_CROP_PCT = 5;

/** Is this image cropped at all? */
export function isCropped(crop: Crop): boolean {
  return crop.x > 0 || crop.y > 0 || crop.w < 100 || crop.h < 100;
}

/**
 * A crop the image can hold: inside its bounds, and never inverted.
 *
 * Clamped rather than refused. A drag that leaves the image, or a stored value
 * from a document edited elsewhere, produces the nearest rectangle that makes
 * sense instead of an image that will not render.
 */
export function clampCrop(value: unknown): Crop {
  const c = (value ?? {}) as Partial<Crop>;
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  let x = Math.min(100 - MIN_CROP_PCT, Math.max(0, num(c.x, 0)));
  let y = Math.min(100 - MIN_CROP_PCT, Math.max(0, num(c.y, 0)));
  const w = Math.min(100 - x, Math.max(MIN_CROP_PCT, num(c.w, 100)));
  const h = Math.min(100 - y, Math.max(MIN_CROP_PCT, num(c.h, 100)));
  /* Re-seated if the size pushed the origin out of bounds. */
  x = Math.min(x, 100 - w);
  y = Math.min(y, 100 - h);

  return {
    x: +x.toFixed(3),
    y: +y.toFixed(3),
    w: +w.toFixed(3),
    h: +h.toFixed(3),
  };
}

/**
 * How to draw a cropped image with CSS alone.
 *
 * The wrapper hides the overflow and the image inside it is scaled up and
 * shifted, so the chosen rectangle fills the frame. Percentages throughout,
 * so it holds at any rendered size — the same markup prints, exports and
 * reopens correctly, which a pixel offset would not.
 *
 * `aspect-ratio` on the wrapper is what gives it a height without knowing the
 * image's pixel dimensions: the crop's own proportions against the image's
 * natural ones. Absent natural dimensions it falls back to the crop's shape,
 * which is right for a square-ish photograph and close enough to load with.
 */
export function cropStyles(input: {
  crop: Crop;
  naturalWidth?: number | null;
  naturalHeight?: number | null;
}): { frame: string; image: string } {
  const crop = clampCrop(input.crop);

  const nw = Number(input.naturalWidth);
  const nh = Number(input.naturalHeight);
  const naturalAspect =
    Number.isFinite(nw) && Number.isFinite(nh) && nw > 0 && nh > 0
      ? nw / nh
      : 1;

  /* The visible rectangle's own aspect: the natural one, stretched by how much
     of each dimension survives the crop. */
  const aspect = naturalAspect * (crop.w / crop.h);

  return {
    frame: [
      "position:relative",
      "overflow:hidden",
      `aspect-ratio:${aspect.toFixed(4)}`,
    ].join(";"),
    image: [
      "position:absolute",
      /* Scaled so the visible slice fills the frame: showing 50% of the width
         means drawing at 200%. BOTH axes explicit — with `height:auto` the
         image kept its own proportions inside the frame, so a frame whose
         shape differed (a crop, or a free stretch) showed the picture small
         in its corner with blank space around it. Explicit height means the
         slice fills the frame whatever shape the frame has, distorting when
         the owner stretched it, which is what a stretch means. */
      `width:${cropScalePct(crop)}%`,
      `height:${((100 / crop.h) * 100).toFixed(3)}%`,
      /* `translate` percentages are of the ELEMENT's own size — one reference
         for both axes, which is what keeps the slice from drifting as the
         frame resizes. */
      "left:0",
      "top:0",
      `transform:translate(${cropTranslate(crop).x}%,${cropTranslate(crop).y}%)`,
    ].join(";"),
  };
}

/** How far the image is scaled up so the visible slice fills the frame. */
export function cropScalePct(crop: Crop): number {
  return +((100 / clampCrop(crop).w) * 100).toFixed(3);
}

/**
 * The shift, as a percentage of the IMAGE's own size.
 *
 * Expressed through `transform: translate`, where a percentage is of the
 * element rather than of its container — so both axes use one reference and
 * neither drifts when the frame resizes.
 */
export function cropTranslate(crop: Crop): { x: number; y: number } {
  const c = clampCrop(crop);
  return {
    x: +(-c.x).toFixed(3),
    y: +(-c.y).toFixed(3),
  };
}

/* ── Free resize ─────────────────────────────────────────────────────────── */

/**
 * How stretched the image is: width over height, or null for its own shape.
 *
 * **OWNER DECISION, 17 Aug 2026 — the aspect lock is REVERSED.** The first
 * build kept the photograph's shape through every grip; the owner then asked
 * for the opposite, in terms that leave no room: "Width and height must be
 * independently adjustable. Do not automatically maintain the original aspect
 * ratio."
 *
 * Stored as a ratio rather than a height: the width is a percentage of the
 * text column, so a fixed pixel height would stop meaning anything the moment
 * the column changed — print, a narrower window, a phone. A ratio scales with
 * the width it belongs to. Rendered as CSS `aspect-ratio`, which an `<img>`
 * honours by stretching (its default `object-fit` is `fill`), and which
 * round-trips through the saved HTML like everything else here.
 */
export const MIN_ASPECT = 0.05;
export const MAX_ASPECT = 20;

/** A usable ratio, or null for "the image's own shape". */
export function clampAspect(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return +Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, n)).toFixed(3);
}

/**
 * Where a drag from any of the eight grips lands, both dimensions free.
 *
 * - a side grip changes ITS axis and holds the other still;
 * - a corner changes both;
 * - every measurement is from the opposite edge, so that edge stays put and
 *   the grip stays under the finger.
 *
 * Holding an axis still is what "independent" means mechanically: a wider
 * image must not get taller, so the height is pinned by recomputing the ratio
 * against the clamped new width rather than carrying the old ratio.
 */
export function resizeFromHandleDrag(input: {
  handle: Handle;
  pointerX: number;
  pointerY: number;
  rect: { left: number; right: number; top: number; bottom: number };
  columnPx: number;
}): { widthPct: number; aspect: number | null } {
  const { rect, columnPx } = input;
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (!(columnPx > 0) || !(width > 0) || !(height > 0)) {
    return { widthPct: DEFAULT_WIDTH_PCT, aspect: null };
  }

  const { horizontal, vertical } = handleAxis(input.handle);

  const nextWidthPx =
    horizontal === 0
      ? width
      : horizontal === 1
        ? input.pointerX - rect.left
        : rect.right - input.pointerX;
  const nextHeightPx =
    vertical === 0
      ? height
      : vertical === 1
        ? input.pointerY - rect.top
        : rect.bottom - input.pointerY;

  const widthPct = clampWidthPct((nextWidthPx / columnPx) * 100);
  /* The ratio is taken against the width AS CLAMPED, so a drag past the
     column's edge pins the height the hand asked for instead of stretching
     it to keep a ratio the clamp just broke. */
  const clampedWidthPx = (widthPct / 100) * columnPx;
  const aspect = clampAspect(clampedWidthPx / Math.max(1, nextHeightPx));

  return { widthPct, aspect };
}
