/**
 * The paint roller: copy one place's character formatting, apply it to the
 * next text selected. Single-use, like a plain click on Docs' own roller.
 *
 * ## What is — and is not — formatting
 *
 * The painter carries the marks that describe how text LOOKS: bold, italic,
 * underline, strikethrough, sub/superscript, inline code, colour, highlight,
 * font and size. It must never carry marks that describe what text IS:
 *
 * - a **link** — painting a URL onto unrelated words creates a link nobody
 *   meant, pointing somewhere the new text has nothing to do with;
 * - a **comment** — comment marks anchor a thread to specific words, and
 *   duplicating one puts the thread on text it was never about;
 * - the **search highlight** — transient chrome owned by find-and-replace.
 *
 * Excluding by name rather than including by name, so a new visual mark added
 * later is painted without anybody remembering this file — while the
 * excluded three fail CLOSED: they are identity, not style.
 */

/** Mark types the painter must never copy or clear. */
export const UNPAINTABLE_MARKS = ["link", "comment", "searchHighlight"] as const;

export function isPaintable(markTypeName: string): boolean {
  return !UNPAINTABLE_MARKS.includes(
    markTypeName as (typeof UNPAINTABLE_MARKS)[number],
  );
}

/**
 * What one press of the roller holds: the names and attributes of the marks
 * at the copy point, minus the unpaintable ones.
 *
 * Attributes ride along because most of the interesting marks are nothing
 * WITHOUT them — a textStyle mark is its colour, font and size.
 */
export interface PaintedFormat {
  marks: { type: string; attrs: Record<string, unknown> }[];
}

export function paintableFormat(
  marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[],
): PaintedFormat {
  return {
    marks: marks
      .filter((m) => isPaintable(m.type.name))
      .map((m) => ({ type: m.type.name, attrs: { ...m.attrs } })),
  };
}
