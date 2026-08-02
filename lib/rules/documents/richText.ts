/**
 * Inline emphasis and block styling for assistant-written documents.
 *
 * ## Why markers in the text rather than a structured `spans` array
 *
 * A model asked for `{text: "Dear ", marks: []}, {text: "Mayfair", marks:
 * ["bold"]}` produces it correctly perhaps most of the time, and the failure
 * mode is a malformed array that costs the whole document. `**bold**` is a
 * notation every model writes fluently and unprompted, it survives being
 * truncated, and a marker that fails to pair degrades to a literal asterisk
 * rather than to a parse error. The parsing is deterministic and lives here,
 * where it is tested, instead of in a component.
 *
 * ## One parse, two renderers
 *
 * {@link parseInline} returns plain data — no React, no ProseMirror. The
 * panel's preview maps it to `<span>`s and the executor maps it to Tiptap
 * text nodes, so what somebody approves and what lands in the document are
 * the same string of spans by construction rather than by two
 * implementations agreeing.
 */

export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/**
 * `**bold**`, `*italic*`, `__underline__`.
 *
 * Bold is matched before italic because `**` starts with `*` and the
 * alternation is tried left to right at each position — reversing them would
 * read `**x**` as an italic empty string wrapped in stray asterisks.
 */
const INLINE = /\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*/g;

export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let last = 0;

  for (const match of text.matchAll(INLINE)) {
    const at = match.index;
    if (at > last) spans.push({ text: text.slice(last, at) });

    if (match[1] !== undefined) spans.push({ text: match[1], bold: true });
    else if (match[2] !== undefined) spans.push({ text: match[2], underline: true });
    else if (match[3] !== undefined) spans.push({ text: match[3], italic: true });

    last = at + match[0].length;
  }

  if (last < text.length) spans.push({ text: text.slice(last) });
  /* Never an empty span: ProseMirror rejects a zero-length text node, and an
     empty `<span>` in the preview is invisible clutter. */
  return spans.filter((s) => s.text.length > 0);
}

/** Alignment a block may carry. Anything else is dropped rather than guessed at. */
export type BlockAlign = "left" | "center" | "right" | "justify";

export function parseAlign(value: unknown): BlockAlign | undefined {
  return value === "left" || value === "center" || value === "right" || value === "justify"
    ? value
    : undefined;
}

/**
 * A colour the document may actually carry.
 *
 * Hex only, and validated rather than passed through: this string ends up in
 * a `style` attribute, and accepting arbitrary CSS from a model response is
 * how `color: red; background: url(…)` gets into a document. Named colours
 * are refused too — not because they are dangerous, but because the set is
 * large, inconsistently supported, and impossible to sanity-check.
 */
export function parseHexColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const hex = value.trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex) ? hex : undefined;
}

/** Point size, clamped to what is legible on a page. */
export function parseFontSize(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const pt = Math.round(value);
  if (pt < 6 || pt > 96) return undefined;
  return pt;
}
