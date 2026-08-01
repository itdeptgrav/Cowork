/**
 * The type and colour a document can be set in.
 *
 * ## Fonts are stacks, not names
 *
 * `setFontFamily("Georgia")` writes exactly that string into the document's
 * HTML, and a machine without Georgia then falls back to whatever the browser
 * picks — usually a sans-serif, which is the opposite of what was asked for.
 * Each entry here is a stack ending in a generic family, so the intent
 * (serif / sans / mono) survives on a machine that has none of the named faces.
 *
 * ## Why the colours are mid-tones
 *
 * The page here is not white in dark mode — that decision is `--doc-page` and
 * it predates this palette. A colour picker offering near-black and near-white
 * would therefore let somebody write text that is invisible to half the people
 * who open the document, and neither of them would be able to tell why. Every
 * swatch below is legible on both page tones. A custom colour is still offered
 * beside them, because a house style is a real requirement and the person
 * choosing one can see the result; the grid is what protects the ordinary case.
 */

export interface FontChoice {
  label: string;
  /** What is written into the document. */
  stack: string;
}

export const FONT_FAMILIES: FontChoice[] = [
  { label: "Default", stack: "" },
  { label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", stack: "Helvetica, Arial, sans-serif" },
  { label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { label: "Trebuchet MS", stack: "'Trebuchet MS', Tahoma, sans-serif" },
  { label: "Tahoma", stack: "Tahoma, Verdana, sans-serif" },
  { label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { label: "Times New Roman", stack: "'Times New Roman', Times, serif" },
  { label: "Garamond", stack: "Garamond, Georgia, serif" },
  { label: "Palatino", stack: "'Palatino Linotype', Palatino, Georgia, serif" },
  { label: "Courier New", stack: "'Courier New', Courier, monospace" },
  { label: "Consolas", stack: "Consolas, 'SF Mono', Menlo, monospace" },
];

/** Points, as every word processor states them. Rendered as `pt`, not `px`. */
export const FONT_SIZES = [
  6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96,
];

export const DEFAULT_FONT_SIZE_PT = 11;

/** Line spacing, matching the values a word processor offers. */
export const LINE_SPACINGS = [
  { label: "Single", value: "1" },
  { label: "1.15", value: "1.15" },
  { label: "1.5", value: "1.5" },
  { label: "Double", value: "2" },
  { label: "2.5", value: "2.5" },
  { label: "Triple", value: "3" },
];

export interface Swatch {
  label: string;
  value: string;
}

/**
 * Text colours: five hues at three weights, plus two neutrals.
 *
 * Laid out as rows of seven so the grid reads as hue across and weight down,
 * which is how somebody looks for "a slightly darker blue".
 */
export const TEXT_COLOURS: Swatch[][] = [
  [
    { label: "Default", value: "" },
    { label: "Grey", value: "#6b6b76" },
    { label: "Red", value: "#c0392b" },
    { label: "Amber", value: "#b7791f" },
    { label: "Green", value: "#2e7d55" },
    { label: "Blue", value: "#2a6fb8" },
    { label: "Violet", value: "#6b4fc4" },
  ],
  [
    { label: "Slate", value: "#8a8a95" },
    { label: "Deep grey", value: "#4b4b55" },
    { label: "Deep red", value: "#98281c" },
    { label: "Deep amber", value: "#8d5a12" },
    { label: "Deep green", value: "#1f5c3d" },
    { label: "Deep blue", value: "#1d5390" },
    { label: "Deep violet", value: "#4f379b" },
  ],
  [
    { label: "Warm grey", value: "#9a8f86" },
    { label: "Teal", value: "#1f7a7a" },
    { label: "Rose", value: "#c05a7d" },
    { label: "Olive", value: "#6f7a2a" },
    { label: "Cyan", value: "#2b7f9e" },
    { label: "Indigo", value: "#3f4ea8" },
    { label: "Plum", value: "#8b3f7a" },
  ],
];

/**
 * Highlights are light tints only.
 *
 * A highlight sets the background and leaves the text alone, so a dark tint
 * would put the page's own ink on a dark ground. The stylesheet pins highlighted
 * text to a dark ink for the same reason — see `--doc-highlight-ink`.
 */
export const HIGHLIGHT_COLOURS: Swatch[][] = [
  [
    { label: "None", value: "" },
    { label: "Yellow", value: "#fff3a3" },
    { label: "Lime", value: "#d9f5a8" },
    { label: "Mint", value: "#b8f0d4" },
    { label: "Sky", value: "#bfe3ff" },
    { label: "Lilac", value: "#dcd2ff" },
    { label: "Pink", value: "#ffd3e4" },
  ],
  [
    { label: "Sand", value: "#f2e6cf" },
    { label: "Peach", value: "#ffd9c0" },
    { label: "Coral", value: "#ffc9c4" },
    { label: "Sage", value: "#dce8d0" },
    { label: "Ice", value: "#d6eef2" },
    { label: "Stone", value: "#e6e6ea" },
    { label: "Cloud", value: "#f4f4f7" },
  ],
];

/**
 * Paragraph styles.
 *
 * Title and Subtitle are heading levels 1 and 2 rather than styles of their
 * own: the outline, export and every other reader of this document understand
 * heading levels, and a bespoke "title" node would be invisible to all of them.
 */
export const PARAGRAPH_STYLES = [
  { id: "p", label: "Normal text", level: null, sample: "16px" },
  { id: "h1", label: "Title", level: 1 as const, sample: "26px" },
  { id: "h2", label: "Subtitle", level: 2 as const, sample: "21px" },
  { id: "h3", label: "Heading 1", level: 3 as const, sample: "18px" },
  { id: "h4", label: "Heading 2", level: 4 as const, sample: "16px" },
  { id: "h5", label: "Heading 3", level: 5 as const, sample: "14px" },
];

export type HeadingLevel = 1 | 2 | 3 | 4 | 5;
