/**
 * Cell styling — the style model, and the registry that keeps it small.
 *
 * Formatting is stored SEPARATELY from a cell's value or formula (Phase 5 spec):
 * a worksheet holds a sparse `ref → styleId` map, and the styles themselves live
 * here, in a registry keyed by id. The point is the flyweight — ten thousand
 * bold cells reference the SAME style record by id, not ten thousand copies of
 * `{ bold: true }`. Interning makes that automatic: two equal styles canonicalise
 * to one string key and therefore one id.
 *
 * A style is a bag of optional properties; ABSENT means "inherit the default".
 * `normalizeStyle` is the canonical form — every property that is off, empty or
 * default is dropped — so the empty style is `{}` (id 0) and toggling bold off a
 * cell that had only bold returns it to id 0. That canonical form is also the
 * serialisation (`serializeStyle`), which is what the registry interns on and
 * what a persistence layer would write.
 *
 * Pure and DOM-free: turning a style into CSS is the view's job, not this
 * module's.
 */

export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";

/** The stroke a border edge draws. Width and dash are implied by the name. */
export type BorderLineStyle =
  | "thin"
  | "medium"
  | "thick"
  | "dashed"
  | "dotted"
  | "double";

export interface Border {
  style: BorderLineStyle;
  color: string;
}

export type Edge = "top" | "right" | "bottom" | "left";
export type Borders = Partial<Record<Edge, Border>>;
/** The four edges in a fixed order — so a normalised borders object serialises
    the same way every time, whatever order it was built in. */
export const EDGES: readonly Edge[] = ["top", "right", "bottom", "left"];

export type NumberFormatKind =
  | "automatic"
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "time"
  | "datetime"
  | "scientific"
  /* Excel's remaining built-ins. `accounting` differs from `currency` in
     where the symbol sits and how negatives and zero read; `text` is the escape
     hatch that shows a number exactly as typed. */
  | "accounting"
  | "shortDate"
  | "longDate"
  | "fraction"
  | "text";

export interface NumberFormat {
  kind: NumberFormatKind;
  /** Fixed decimal places; absent uses the format's own default. */
  decimals?: number;
  /** The currency symbol, for the currency format only. */
  currency?: string;
}

/** Everything that can be set on a cell. Absent = the default. */
export interface CellStyle {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  background?: string;
  align?: HAlign;
  valign?: VAlign;
  wrap?: boolean;
  borders?: Borders;
  numberFormat?: NumberFormat;
}

export type StyleId = number;

/** The default style, and its permanent id in every registry. */
export const EMPTY_STYLE: CellStyle = {};
export const DEFAULT_STYLE_ID: StyleId = 0;

/** The boolean/mark properties that toggle. */
export type Mark = "bold" | "italic" | "underline" | "strikethrough";

/**
 * The canonical form of a style: every off/empty/default property dropped, and
 * the survivors written in a FIXED order. Two logically-equal styles produce an
 * identical object here, which is what makes interning and serialisation exact.
 */
export function normalizeStyle(s: CellStyle): CellStyle {
  const out: CellStyle = {};
  if (s.fontFamily) out.fontFamily = s.fontFamily;
  if (typeof s.fontSize === "number" && s.fontSize > 0) out.fontSize = s.fontSize;
  if (s.bold) out.bold = true;
  if (s.italic) out.italic = true;
  if (s.underline) out.underline = true;
  if (s.strikethrough) out.strikethrough = true;
  if (s.color) out.color = s.color;
  if (s.background) out.background = s.background;
  if (s.align) out.align = s.align;
  if (s.valign) out.valign = s.valign;
  if (s.wrap) out.wrap = true;
  if (s.borders) {
    const b: Borders = {};
    for (const edge of EDGES) {
      const e = s.borders[edge];
      if (e && e.style) b[edge] = { style: e.style, color: e.color || "#000000" };
    }
    if (Object.keys(b).length > 0) out.borders = b;
  }
  if (s.numberFormat && s.numberFormat.kind && s.numberFormat.kind !== "automatic") {
    const nf: NumberFormat = { kind: s.numberFormat.kind };
    if (typeof s.numberFormat.decimals === "number") nf.decimals = s.numberFormat.decimals;
    if (s.numberFormat.currency) nf.currency = s.numberFormat.currency;
    out.numberFormat = nf;
  }
  return out;
}

/** The canonical string form — the intern key and the persisted representation. */
export function serializeStyle(s: CellStyle): string {
  return JSON.stringify(normalizeStyle(s));
}

/** Read a style back from its canonical string, re-normalising defensively. */
export function deserializeStyle(json: string): CellStyle {
  return normalizeStyle(JSON.parse(json) as CellStyle);
}

/** Merge a patch over a base and canonicalise — how a format toolbar edits a
    style. A property set back to its default in the patch drops out. */
export function mergeStyle(base: CellStyle, patch: CellStyle): CellStyle {
  return normalizeStyle({ ...base, ...patch });
}

/** Whether a style is the default (nothing set). */
export function isEmptyStyle(s: CellStyle): boolean {
  return serializeStyle(s) === "{}";
}

/**
 * The style store. `id 0` is always the empty style; every other id is a
 * distinct, interned style. It only ever grows — ids are permanent, which is
 * what lets a copied or undone cell keep referring to a style by id without the
 * registry pulling it out from under it.
 */
export class StyleRegistry {
  private styles: CellStyle[] = [EMPTY_STYLE];
  private index = new Map<string, StyleId>([["{}", DEFAULT_STYLE_ID]]);

  /** The id for a style, creating one if this style is new. Equal styles share
      an id (the flyweight — no duplicate records across the sheet). */
  intern(style: CellStyle): StyleId {
    const norm = normalizeStyle(style);
    const key = JSON.stringify(norm);
    const existing = this.index.get(key);
    if (existing !== undefined) return existing;
    const id = this.styles.length;
    this.styles.push(norm);
    this.index.set(key, id);
    return id;
  }

  /** The style for an id — the empty style for an unknown id, never undefined. */
  get(id: StyleId): CellStyle {
    return this.styles[id] ?? EMPTY_STYLE;
  }

  /** How many distinct styles exist — one (just the default) on a fresh sheet. */
  size(): number {
    return this.styles.length;
  }

  /** The whole table, for persistence. Ids are the array indices. */
  serialize(): string {
    return JSON.stringify(this.styles);
  }

  /** Rebuild a registry from `serialize()`, preserving every id. */
  static deserialize(json: string): StyleRegistry {
    const reg = new StyleRegistry();
    const arr = JSON.parse(json) as CellStyle[];
    reg.styles = [];
    reg.index = new Map();
    arr.forEach((style, id) => {
      const norm = normalizeStyle(style);
      reg.styles[id] = norm;
      reg.index.set(JSON.stringify(norm), id);
    });
    if (reg.styles.length === 0) {
      reg.styles.push(EMPTY_STYLE);
      reg.index.set("{}", DEFAULT_STYLE_ID);
    }
    return reg;
  }
}

/**
 * The edges a border preset touches on each cell of a range. `all`/`none` hit
 * every edge of every cell; `outer` and the single-side presets hit only the
 * relevant perimeter edges. The caller then either sets those edges to a border
 * (all/outer/side) or clears them (none).
 */
export type BorderPreset = "all" | "outer" | "none" | "top" | "right" | "bottom" | "left";

export function borderEdgesForPreset(
  range: { top: number; left: number; bottom: number; right: number },
  preset: BorderPreset,
): { row: number; col: number; edges: Edge[] }[] {
  const out: { row: number; col: number; edges: Edge[] }[] = [];
  for (let r = range.top; r <= range.bottom; r++) {
    for (let c = range.left; c <= range.right; c++) {
      const edges: Edge[] = [];
      const onTop = r === range.top;
      const onBottom = r === range.bottom;
      const onLeft = c === range.left;
      const onRight = c === range.right;
      switch (preset) {
        case "all":
        case "none":
          edges.push("top", "right", "bottom", "left");
          break;
        case "outer":
          if (onTop) edges.push("top");
          if (onBottom) edges.push("bottom");
          if (onLeft) edges.push("left");
          if (onRight) edges.push("right");
          break;
        case "top":
          if (onTop) edges.push("top");
          break;
        case "bottom":
          if (onBottom) edges.push("bottom");
          break;
        case "left":
          if (onLeft) edges.push("left");
          break;
        case "right":
          if (onRight) edges.push("right");
          break;
      }
      if (edges.length > 0) out.push({ row: r, col: c, edges });
    }
  }
  return out;
}
