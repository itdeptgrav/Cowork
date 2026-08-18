import type { DocumentPageSetup, PageOrientation, PaperSize } from "@/lib/domain";

/**
 * Page setup — paper, orientation, margins.
 *
 * ## Why this is a stored property of the document and not a view preference
 *
 * The measure a person writes to is part of the document: a report laid out for
 * A4 with 1" margins reads differently at Letter, and two people editing the
 * same text through different margins would see line breaks fall in different
 * places while believing they were looking at the same page. Zoom is the view
 * preference — it changes nothing about the document and is deliberately NOT
 * stored here.
 *
 * ## Inches, everywhere
 *
 * Paper is specified in inches and millimetres depending on where in the world
 * it was standardised, and margins are authored in inches by every word
 * processor this has to feel like. One unit through the whole module, converted
 * to pixels at exactly one place (`PX_PER_INCH`), because a second conversion is
 * how a ruler stops agreeing with the page it is measuring.
 */

/** CSS reference pixels per inch. The definition, not a tuned constant. */
export const PX_PER_INCH = 96;

export const PAPER: Record<
  PaperSize,
  { label: string; widthIn: number; heightIn: number }
> = {
  letter: { label: "Letter (8.5\" × 11\")", widthIn: 8.5, heightIn: 11 },
  legal: { label: "Legal (8.5\" × 14\")", widthIn: 8.5, heightIn: 14 },
  tabloid: { label: "Tabloid (11\" × 17\")", widthIn: 11, heightIn: 17 },
  a4: { label: "A4 (210 × 297 mm)", widthIn: 8.27, heightIn: 11.69 },
  a5: { label: "A5 (148 × 210 mm)", widthIn: 5.83, heightIn: 8.27 },
};

/** The order the picker offers them in — most used first, not alphabetical. */
export const PAPER_ORDER: PaperSize[] = ["letter", "a4", "legal", "tabloid", "a5"];

export const DEFAULT_PAGE_SETUP: DocumentPageSetup = {
  paper: "letter",
  orientation: "portrait",
  margins: { top: 1, right: 1, bottom: 1, left: 1 },
  header: "",
  footer: "",
  pageNumbers: false,
};

/**
 * A header or footer line the page can hold.
 *
 * One line — a newline pasted into the field would push its second line into
 * the text area on print — and bounded, because these repeat on every page and
 * a runaway string repeats with them.
 */
export const MAX_HEADER_FOOTER_CHARS = 200;
export function readHeaderFooterText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\r\n]+/g, " ")
    .slice(0, MAX_HEADER_FOOTER_CHARS)
    .trim();
}

/**
 * The narrowest column of text this will allow.
 *
 * Margins are the field a person can make nonsense of — 4" each side of a
 * Letter page leaves half an inch of text. Two inches is roughly 25 characters,
 * which is already unusable; anything below it is certainly a mistake rather
 * than a choice.
 */
export const MIN_MEASURE_IN = 2;

/** The widest a single margin may be. Anything more cannot leave a measure. */
export const MAX_MARGIN_IN = 6;

export function pageSizeIn(setup: DocumentPageSetup): {
  widthIn: number;
  heightIn: number;
} {
  const paper = PAPER[setup.paper] ?? PAPER.letter;
  /* Landscape is the same sheet turned, so the numbers swap rather than being
     stored twice. A second table of landscape sizes is a second thing to keep
     right. */
  return setup.orientation === "landscape"
    ? { widthIn: paper.heightIn, heightIn: paper.widthIn }
    : { widthIn: paper.widthIn, heightIn: paper.heightIn };
}

/** The text column: paper width less both side margins. */
export function contentWidthIn(setup: DocumentPageSetup): number {
  return pageSizeIn(setup).widthIn - setup.margins.left - setup.margins.right;
}

/** The text block's height: paper height less both vertical margins. */
export function contentHeightIn(setup: DocumentPageSetup): number {
  return pageSizeIn(setup).heightIn - setup.margins.top - setup.margins.bottom;
}

/**
 * Why this setup cannot be applied, or null.
 *
 * A named refusal rather than silently clamping: a person who typed 5" and got
 * 1.5" without being told would reasonably conclude the field is broken.
 */
export function pageSetupRefusal(setup: DocumentPageSetup): string | null {
  const values = [
    setup.margins.top,
    setup.margins.right,
    setup.margins.bottom,
    setup.margins.left,
  ];
  if (values.some((v) => !Number.isFinite(v) || v < 0))
    return "Margins are measured in inches and cannot be negative.";
  if (values.some((v) => v > MAX_MARGIN_IN))
    return `A margin cannot be wider than ${MAX_MARGIN_IN}\".`;
  if (contentWidthIn(setup) < MIN_MEASURE_IN)
    return `These margins leave less than ${MIN_MEASURE_IN}\" to write in. Narrow the left or right margin.`;
  if (contentHeightIn(setup) < MIN_MEASURE_IN)
    return `These margins leave less than ${MIN_MEASURE_IN}\" of page. Narrow the top or bottom margin.`;
  return null;
}

/**
 * Read a stored setup, falling back field by field.
 *
 * Tolerant because this comes back from Firestore untyped, and because
 * documents written before page setup existed have none at all — those must
 * open at the default rather than at a page of `NaN` inches.
 */
export function readPageSetup(raw: unknown): DocumentPageSetup {
  if (!raw || typeof raw !== "object") return DEFAULT_PAGE_SETUP;
  const r = raw as Record<string, unknown>;
  const m = (r.margins ?? {}) as Record<string, unknown>;
  const inches = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_MARGIN_IN
      ? v
      : fallback;
  const next: DocumentPageSetup = {
    paper: (Object.keys(PAPER) as PaperSize[]).includes(r.paper as PaperSize)
      ? (r.paper as PaperSize)
      : DEFAULT_PAGE_SETUP.paper,
    orientation: (["portrait", "landscape"] as PageOrientation[]).includes(
      r.orientation as PageOrientation,
    )
      ? (r.orientation as PageOrientation)
      : DEFAULT_PAGE_SETUP.orientation,
    margins: {
      top: inches(m.top, DEFAULT_PAGE_SETUP.margins.top),
      right: inches(m.right, DEFAULT_PAGE_SETUP.margins.right),
      bottom: inches(m.bottom, DEFAULT_PAGE_SETUP.margins.bottom),
      left: inches(m.left, DEFAULT_PAGE_SETUP.margins.left),
    },
    header: readHeaderFooterText(r.header),
    footer: readHeaderFooterText(r.footer),
    pageNumbers: r.pageNumbers === true,
  };
  /* A stored combination that leaves no measure is treated as unusable rather
     than rendered. It can only come from a write that predates the refusal. */
  return pageSetupRefusal(next) ? DEFAULT_PAGE_SETUP : next;
}

/* ── Zoom ──────────────────────────────────────────────────────────────────
 *
 * A view preference, not a document property. It is listed here because the
 * page geometry and the zoom that scales it have to agree about pixels.
 */

export const ZOOM_STEPS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2] as const;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/**
 * The next zoom step in a direction.
 *
 * Steps rather than a fixed multiplier, so the values a person lands on are the
 * round ones they would have chosen from the menu — 90%, 100%, 125% — instead of
 * 110% and 121%.
 */
export function stepZoom(current: number, direction: 1 | -1): number {
  const steps = ZOOM_STEPS;
  if (direction === 1) {
    const next = steps.find((s) => s > current + 0.001);
    return clampZoom(next ?? current);
  }
  const below = steps.filter((s) => s < current - 0.001);
  return clampZoom(below.length ? below[below.length - 1] : current);
}

/**
 * The zoom that makes the page exactly fill the space available.
 *
 * `available` is in pixels and already excludes whatever gutter the caller
 * wants kept, because only the caller knows what else is on screen.
 */
export function fitZoom(setup: DocumentPageSetup, availableWidthPx: number): number {
  const pageWidthPx = pageSizeIn(setup).widthIn * PX_PER_INCH;
  if (pageWidthPx <= 0) return 1;
  return clampZoom(availableWidthPx / pageWidthPx);
}
