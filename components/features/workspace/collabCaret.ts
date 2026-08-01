/**
 * How a remote editor's presence is drawn.
 *
 * The extension's default is a full-opacity `<div>` label with no stylesheet
 * behind it, so it lays out as a block: a solid, full-width coloured bar with a
 * name sitting in the text — which is the "amateur and distracting" look. This
 * replaces it with the convention every mature editor shares:
 *
 *  · a **thin caret** in the person's colour, the width of an insertion point;
 *  · a **name flag** above it, in their colour, kept on the caret so you can
 *    always see who is where;
 *  · a **soft selection wash** rather than a solid block, so the text a person
 *    has selected stays readable underneath their highlight.
 *
 * The flag and the wash are styled in `globals.css` (`.collab-caret*`,
 * `.collab-selection`); this module only builds the DOM and hands the colours
 * across as custom properties.
 */

interface CollabUser {
  name?: string | null;
  color?: string | null;
}

/** The muted default, matching `caretColour`'s palette, when a peer sent none. */
const FALLBACK = "#8b9fbc";

/** The r,g,b of a `#rrggbb` colour — the fallback's when it is not one. */
function channels(hex: string | null | undefined): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  const n = parseInt(match ? match[1] : FALLBACK.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * A readable ink for a name sitting ON `hex`.
 *
 * The caret palette is deliberately muted, so white-on-colour is often too faint
 * to read. Perceived luminance decides: near-black on the light half, white on
 * the dark, which keeps every flag legible whatever colour a person drew.
 */
function inkFor(hex: string | null | undefined): string {
  const [r, g, b] = channels(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#16181c" : "#ffffff";
}

/** `hex` at `alpha`, as an `rgba()` the selection wash can sit behind text. */
function rgba(hex: string | null | undefined, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The caret widget: a coloured line carrying a name flag.
 *
 * Returns a bare element for the cursor plugin to place; all of the appearance,
 * and the flag's fade, lives in the stylesheet so it can animate.
 */
export function caretRender(user: CollabUser): HTMLElement {
  const color = user.color || FALLBACK;

  const caret = document.createElement("span");
  caret.className = "collab-caret";
  caret.style.setProperty("--collab-color", color);
  caret.style.setProperty("--collab-ink", inkFor(color));

  const label = document.createElement("span");
  label.className = "collab-caret__label";
  /* textContent, never innerHTML: a display name is user data and a document is
     shared, so a name is exactly the string an injection would travel in. */
  label.textContent = user.name || "Someone";

  caret.appendChild(label);
  return caret;
}

/**
 * The selection wash: a light tint of the person's colour.
 *
 * A quarter-opacity is enough to read as "theirs" while leaving the text legible
 * — the default's near-half opacity over a dark page reads as a solid bar.
 */
export function caretSelection(user: CollabUser): {
  style: string;
  class: string;
} {
  return {
    style: `background-color: ${rgba(user.color, 0.22)}`,
    class: "collab-selection",
  };
}
