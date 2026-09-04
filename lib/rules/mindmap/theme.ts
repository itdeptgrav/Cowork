import type {
  MindNode,
  MindNodeStyle,
  MindPriority,
  MindProgress,
  MindThemeKind,
} from "../../domain/mindmap.ts";

/**
 * How a map looks: themes, depth colours, shapes and markers.
 *
 * Pure, so the canvas and the SVG export draw from ONE answer. Before this
 * file the canvas had its own depth hues and the exporter had a copy with hex
 * fallbacks, and the two had already drifted by one shade. Now both ask here.
 *
 * ## Themes are palettes, not stylesheets
 *
 * A theme is six colours for six depths plus a card fill and a text colour.
 * Everything else — radius, stroke, type — stays the product's own, so a
 * "vivid" map is still recognisably a Cowork map and not a different app. The
 * default theme is the FIELD palette the design system sanctions for exactly
 * this and for avatar monograms; the others are for people who want a map to
 * read at a glance as "the marketing one" and "the ops one".
 *
 * Colours are plain CSS values rather than custom properties, because the
 * export writes them into a standalone SVG that has no stylesheet to resolve
 * a `var()` against. `field` is the one exception: it reads the page's own
 * tokens when a document is available, so it follows dark mode, and falls
 * back to the light values the stylesheet defines.
 */

export interface MindTheme {
  id: MindThemeKind;
  label: string;
  /** One per depth, cycling. Index 0 is the root. */
  depths: string[];
  card: string;
  text: string;
  /** The connector and hairline colour. */
  line: string;
  /** Named swatches offered by the colour picker, in this theme's key. */
  swatches: string[];
}

const FIELD_FALLBACK = ["#b39cc6", "#8b9fbc", "#d9a4b0", "#e6c79c", "#f2e6d2", "#a9c4b5"];

export const THEMES: Record<MindThemeKind, MindTheme> = {
  field: {
    id: "field",
    label: "Field",
    depths: FIELD_FALLBACK,
    card: "#eeeef0",
    text: "#0a0a0a",
    line: "rgba(10,10,10,0.18)",
    swatches: ["#b39cc6", "#8b9fbc", "#d9a4b0", "#e6c79c", "#a9c4b5", "#f2e6d2", "#c9c9cf"],
  },
  mono: {
    id: "mono",
    label: "Mono",
    depths: ["#111111", "#3a3a3a", "#5c5c5c", "#7d7d7d", "#9e9e9e", "#bdbdbd"],
    card: "#f6f6f6",
    text: "#111111",
    line: "rgba(0,0,0,0.22)",
    swatches: ["#111111", "#3a3a3a", "#5c5c5c", "#7d7d7d", "#9e9e9e", "#bdbdbd", "#e2e2e2"],
  },
  vivid: {
    id: "vivid",
    label: "Vivid",
    depths: ["#6c5ce7", "#00b894", "#e17055", "#0984e3", "#fdcb6e", "#e84393"],
    card: "#ffffff",
    text: "#1a1a2e",
    line: "rgba(26,26,46,0.22)",
    swatches: ["#6c5ce7", "#00b894", "#e17055", "#0984e3", "#fdcb6e", "#e84393", "#2d3436"],
  },
  warm: {
    id: "warm",
    label: "Warm",
    depths: ["#b5462d", "#d9822b", "#e6b33f", "#8f6b3a", "#c98a6b", "#e9c9a8"],
    card: "#fbf5ee",
    text: "#2b1d12",
    line: "rgba(43,29,18,0.22)",
    swatches: ["#b5462d", "#d9822b", "#e6b33f", "#8f6b3a", "#c98a6b", "#e9c9a8", "#f3e4d3"],
  },
  cool: {
    id: "cool",
    label: "Cool",
    depths: ["#1f4e79", "#2e86ab", "#4fb0c6", "#6fc3b8", "#8fd3a6", "#bfe3c9"],
    card: "#f2f7fa",
    text: "#0f2233",
    line: "rgba(15,34,51,0.22)",
    swatches: ["#1f4e79", "#2e86ab", "#4fb0c6", "#6fc3b8", "#8fd3a6", "#bfe3c9", "#e2eef3"],
  },
  night: {
    id: "night",
    label: "Night",
    depths: ["#a29bfe", "#55efc4", "#fab1a0", "#74b9ff", "#ffeaa7", "#fd79a8"],
    card: "#1e1f26",
    text: "#f1f1f4",
    line: "rgba(241,241,244,0.22)",
    swatches: ["#a29bfe", "#55efc4", "#fab1a0", "#74b9ff", "#ffeaa7", "#fd79a8", "#3a3b46"],
  },
};

export const THEME_IDS = Object.keys(THEMES) as MindThemeKind[];

export function themeOf(id: MindThemeKind | undefined): MindTheme {
  return THEMES[id ?? "field"] ?? THEMES.field;
}

/** The theme's colour for a depth, cycling past the palette's end. */
export function depthColour(theme: MindTheme, depth: number): string {
  return theme.depths[Math.max(0, depth) % theme.depths.length];
}

/**
 * The stripe/accent colour for one card: its own fill if it has one, else the
 * theme's colour for its depth. This is the ONE rule for "what colour is this
 * card", used by the canvas, the minimap and the export alike.
 */
export function accentOf(node: MindNode, depth: number, theme: MindTheme): string {
  return node.style?.fill || depthColour(theme, depth);
}

/** Title size in pixels for a card's `size`. `m` is the canvas default. */
export function fontSizeOf(style: MindNodeStyle | undefined): number {
  switch (style?.size) {
    case "s":
      return 11.5;
    case "l":
      return 15;
    case "xl":
      return 18;
    default:
      return 13;
  }
}

/** Corner radius for a shape, in px against the card's height. */
export function radiusOf(style: MindNodeStyle | undefined, height: number): number {
  switch (style?.shape) {
    case "rect":
      return 3;
    case "pill":
    case "ellipse":
      return height / 2;
    case "underline":
      return 0;
    default:
      return 10;
  }
}

/** The glyph and colour for a priority marker. XMind's numbered badges. */
export function priorityMarker(p: MindPriority): { label: string; colour: string } {
  const colours: Record<MindPriority, string> = {
    1: "#d63031",
    2: "#e17055",
    3: "#fdcb6e",
    4: "#00b894",
    5: "#0984e3",
  };
  return { label: String(p), colour: colours[p] };
}

/** The fraction of a full circle a progress marker fills. */
export function progressFraction(p: MindProgress): number {
  return p / 100;
}

/**
 * A readable text colour for a fill — the theme's, unless the fill is dark
 * enough that dark text would vanish on it. Used when a card sets `fill` but
 * not `text`, which is the common case.
 */
export function textOn(fill: string | undefined, theme: MindTheme): string {
  if (!fill) return theme.text;
  const rgb = parseColour(fill);
  if (!rgb) return theme.text;
  const [r, g, b] = rgb;
  /* Relative luminance, sRGB-ish. 0.55 splits the field palette sensibly. */
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum < 0.55 ? "#ffffff" : "#0a0a0a";
}

/** `#rgb`, `#rrggbb`, or `rgb(a)(…)` → [r, g, b]. Anything else is null. */
export function parseColour(value: string): [number, number, number] | null {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}
