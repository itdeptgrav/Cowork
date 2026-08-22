/**
 * A sheet's addressing and its stored shape.
 *
 * Kept apart from the component so the two hard parts separate: this decides
 * what a cell is called and how a sheet is written down, and can be tested
 * without a DOM or a formula engine.
 *
 * ## Cells are stored sparsely, and RAW
 *
 * `{ "A1": "=SUM(B1:B9)", "B1": "3" }`. Two properties, both load-bearing:
 *
 *  · **Sparse** — a 1000×26 grid with four values in it is four entries, not
 *    26,000 nulls. A rectangular array would put a megabyte in Firestore for an
 *    almost-empty sheet.
 *  · **Raw** — what somebody typed, never what it evaluated to. A computed
 *    value is derived from its inputs, and persisting it lets a stale number
 *    outlive the cells it came from. Everything is recomputed on load.
 */

export const DEFAULT_ROWS = 200;
export const DEFAULT_COLS = 26;

/** Bounds, so a corrupt stored sheet cannot ask for a billion cells. */
export const MAX_ROWS = 5000;
export const MAX_COLS = 52;

export type CellMap = Record<string, string>;

/** How a NUMBER is displayed. Presentation only — the stored value is untouched. */
export type NumberFormat = "currency" | "percent" | "comma" | "plain";

/** Which of a cell's four edges carry a drawn line. */
export interface BorderSides {
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
}

/**
 * Read a cell's `border` field, tolerating the OLD shape a document written
 * before the Borders menu grew individual sides could still have on disk:
 * a bare string, `"all"` or `"bottom"`, where the field is now an object.
 * Older documents keep rendering correctly without a migration script; every
 * new write already uses the object shape, so this is read-side only.
 */
export function normalizeBorder(raw: unknown): BorderSides | undefined {
  if (raw === "all") return { top: true, right: true, bottom: true, left: true };
  if (raw === "bottom") return { bottom: true };
  if (raw && typeof raw === "object") {
    const b = raw as BorderSides;
    return b.top || b.right || b.bottom || b.left ? b : undefined;
  }
  return undefined;
}

/** Formatting a cell carries. Presentation only — never the value. */
export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  align?: "left" | "center" | "right";
  /** Vertical alignment within the cell. */
  valign?: "top" | "middle" | "bottom";
  /** Text-indent steps, from the increase/decrease-indent controls. */
  indent?: number;
  /** A CSS colour for the text. */
  color?: string;
  /** A CSS colour for the cell fill. */
  bg?: string;
  /** A drawn border, per side — which sides is the whole feature; see `BorderSides`. */
  border?: BorderSides;
  /** Font family, from the toolbar's list. */
  font?: string;
  /** Font size in points/px. */
  size?: number;
  /** Wrap long text instead of clipping it. */
  wrap?: boolean;
  /** How a numeric cell is displayed. Text is never reformatted. */
  format?: NumberFormat;
  /** Fixed decimal places, from the increase/decrease-decimal controls. */
  decimals?: number;
}

export type StyleMap = Record<string, CellStyle>;

export type ChartType =
  "column" | "bar" | "line" | "area" | "pie" | "doughnut" | "scatter" | "combo";

/**
 * A chart placed on the sheet, drawn from a data range.
 *
 * It is an **embedded object**: it floats over the cells at a pixel position in
 * the grid's own content space (so it scrolls with the sheet), at a size the user
 * drags, in a paint order they can change. Every placement/config field is
 * optional so an older sheet — a bare `{id,type,range,title}` — still reads, and
 * the grid falls back to a default box for anything missing.
 */
export interface ChartSpec {
  id: string;
  type: ChartType;
  /** The data range, e.g. `A1:B10`. */
  range: string;
  title: string;
  /** Placement, in content pixels from the grid's top-left. */
  x?: number;
  y?: number;
  /** Size in pixels. */
  w?: number;
  h?: number;
  /** Paint order — a higher `z` sits in front. */
  z?: number;
  /** Show the series legend. Defaults on. */
  legend?: boolean;
  /** Draw the value/category axes and gridlines. Defaults on. */
  axes?: boolean;
  /** Read each series from a column (default) or from a row. */
  orientation?: "cols" | "rows";
  /** Stack column/bar/area series instead of grouping them. */
  stacked?: boolean;
}

export type ConditionalKind =
  /* Numeric comparison. */
  | "greater"
  | "greaterEqual"
  | "less"
  | "lessEqual"
  | "equal"
  | "notEqual"
  | "between"
  | "notBetween"
  /* Text. */
  | "textContains"
  | "textStarts"
  | "textEnds"
  /* Blanks & errors. */
  | "blank"
  | "notBlank"
  | "error"
  /* Duplicate / unique across the range. */
  | "duplicate"
  | "unique"
  /* Rank within the range. */
  | "top"
  | "bottom"
  | "topPercent"
  | "bottomPercent"
  /* Relative to the range's average. */
  | "aboveAvg"
  | "belowAvg"
  /* Visual scales. */
  | "colorScale"
  | "dataBar"
  | "iconSet";

/** The set of icons an icon-set rule draws. */
export type IconSet = "arrows" | "traffic" | "flags";

/** The formatting a highlight rule paints onto a matching cell. */
export interface ConditionalStyle {
  bg?: string;
  textColor?: string;
  bold?: boolean;
  italic?: boolean;
  border?: boolean;
}

/**
 * A conditional-formatting rule over a range.
 *
 * The first six fields are the original shape and stay valid untouched; the rest
 * are the redesign's additions and are all optional, so an old stored rule reads
 * back exactly as before (missing `enabled` ⇒ on, missing `order` ⇒ its position,
 * missing `style` ⇒ the legacy `color` fill).
 */
export interface ConditionalRule {
  id: string;
  range: string;
  kind: ConditionalKind;
  /** Threshold / between-low / rank N / rank percent. */
  value?: number;
  /** The high bound for between. */
  value2?: number;
  /** Legacy highlight fill / the bar colour for data bars. Still honoured. */
  color?: string;
  /** The needle for the text rules. */
  text?: string;
  /** Off rules are kept but not applied. Absent ⇒ on. */
  enabled?: boolean;
  /** Lower applies first; ties fall back to array position. */
  order?: number;
  /** Stop evaluating later rules on this cell once this one matches. */
  stopIfTrue?: boolean;
  /** The rich formatting a highlight rule applies (supersedes `color`). */
  style?: ConditionalStyle;
  /** Which glyphs an `iconSet` rule uses. */
  iconSet?: IconSet;
  /** Optional colour-scale endpoints (and midpoint), else the default heat map. */
  minColor?: string;
  midColor?: string;
  maxColor?: string;
}

export interface SheetData {
  cells: CellMap;
  styles: StyleMap;
  rows: number;
  cols: number;
  charts?: ChartSpec[];
  conditionals?: ConditionalRule[];
  /** Row indices (0-based) hidden by a filter. Absent or empty ⇒ nothing hidden. */
  hidden?: number[];
  /** Row index (0-based) → pixel height, for rows the user dragged to resize. Absent index ⇒ DEFAULT_ROW_HEIGHT. */
  rowHeights?: Record<number, number>;
  /** Column index (0-based) → pixel width, for columns the user dragged to resize. Absent index ⇒ DEFAULT_COL_WIDTH. */
  columnWidths?: Record<number, number>;
  /** Merged rectangles, as range strings ("B2:C3"), always normalized (top-left:bottom-right)
   * and never overlapping one another. Purely a DISPLAY concern — every covered cell keeps
   * its own stored value; a merge just means only the top-left one renders and it spans the
   * others. That is deliberately different from Excel, which discards the covered cells'
   * content on merge — there is no reason a merge should be destructive here. */
  mergedRanges?: string[];
  /** A pasted-in image, keyed by the cell it was dropped on. Anything MORE than one cell —
   * an image that spans a merge, floats free, or overlaps neighbours the way a chart does —
   * is future scope; this is deliberately the "Google Sheets image-in-cell" version, not the
   * "Excel floating picture" version. */
  images?: Record<string, CellImage>;
}

/** A cell's pasted-in image. `fileId` is load-bearing (see `DriveImage`/`driveImageSources`);
 * `url` is the fallback source and what survives if the id's format ever changes. */
export interface CellImage {
  fileId: string | null;
  url: string;
  name: string;
}

/** Resize bounds — generous enough for a wrapped paragraph or a wide heading, tight enough that a fat-finger drag can't produce an unusable sheet. */
export const MIN_ROW_HEIGHT = 16;
export const MAX_ROW_HEIGHT = 400;
export const MIN_COL_WIDTH = 32;
export const MAX_COL_WIDTH = 480;

/**
 * A column's letter. 0 → A, 25 → Z, 26 → AA.
 *
 * Bijective base-26, which is not the same as ordinary base-26 and is the usual
 * bug here: there is no zero digit, so 26 is "AA" rather than "BA".
 */
export function columnLabel(index: number): string {
  let n = index;
  let out = "";
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

/** The inverse. "AA" → 26. Returns -1 on anything that is not a column. */
export function columnIndex(label: string): number {
  const text = label.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(text)) return -1;
  let n = 0;
  for (const ch of text) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** "A1" for (0,0). */
export function cellRef(row: number, col: number): string {
  return `${columnLabel(col)}${row + 1}`;
}

/** The inverse, or null. */
export function parseRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref.trim());
  if (!m) return null;
  const col = columnIndex(m[1]);
  const row = Number(m[2]) - 1;
  if (col < 0 || row < 0 || !Number.isFinite(row)) return null;
  return { row, col };
}

/** Whether what somebody typed is a formula. */
export function isFormula(raw: string): boolean {
  return raw.trimStart().startsWith("=");
}

/** The blank sheet returned whenever there is nothing readable. */
function emptySheet(): SheetData {
  return { cells: {}, styles: {}, rows: DEFAULT_ROWS, cols: DEFAULT_COLS };
}

/**
 * Parse one ALREADY-DECODED sheet object into SheetData, tolerating anything.
 *
 * Split out of `readSheet` so a workbook can reuse it for each of its sheets;
 * `readSheet` is the thin JSON wrapper below.
 */
function parseSheet(input: unknown): SheetData {
  if (!input || typeof input !== "object") return emptySheet();
  const raw = input as Partial<SheetData>;
  const cells: CellMap = {};
  for (const [ref, value] of Object.entries(raw.cells ?? {})) {
    /* Both halves checked: a key that is not a reference cannot be placed on
         the grid, and a non-string value would reach the engine as an object.
       The key is re-encoded through cellRef(parseRef(…)) rather than merely
       uppercased: "A01" parses to the same cell as "A1", but every grid
       lookup goes through cellRef, which only ever writes "A1" — a key kept
       as "A01" would be an orphan the screen can never show. */
    const pos = parseRef(ref);
    if (pos && typeof value === "string") cells[cellRef(pos.row, pos.col)] = value;
  }
  const styles: StyleMap = {};
  for (const [ref, style] of Object.entries(raw.styles ?? {})) {
    const pos = parseRef(ref);
    if (pos && style && typeof style === "object") {
      styles[cellRef(pos.row, pos.col)] = style as CellStyle;
    }
  }
  const chartTypes = [
    "column",
    "bar",
    "line",
    "area",
    "pie",
    "doughnut",
    "scatter",
    "combo",
  ];
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const charts: ChartSpec[] = [];
  for (const c of Array.isArray(raw.charts) ? raw.charts : []) {
    const spec = c as Partial<ChartSpec>;
    if (
      spec &&
      typeof spec.id === "string" &&
      typeof spec.range === "string" &&
      typeof spec.type === "string" &&
      chartTypes.includes(spec.type)
    ) {
      charts.push({
        id: spec.id,
        type: spec.type as ChartType,
        range: spec.range,
        title: typeof spec.title === "string" ? spec.title : "Chart",
        /* Embedded-object placement & config — only kept when well-typed, so a
             corrupt field falls back to the grid's default rather than throwing. */
        ...(num(spec.x) !== undefined ? { x: num(spec.x) } : {}),
        ...(num(spec.y) !== undefined ? { y: num(spec.y) } : {}),
        ...(num(spec.w) !== undefined ? { w: num(spec.w) } : {}),
        ...(num(spec.h) !== undefined ? { h: num(spec.h) } : {}),
        ...(num(spec.z) !== undefined ? { z: num(spec.z) } : {}),
        ...(typeof spec.legend === "boolean" ? { legend: spec.legend } : {}),
        ...(typeof spec.axes === "boolean" ? { axes: spec.axes } : {}),
        ...(spec.orientation === "rows" || spec.orientation === "cols"
          ? { orientation: spec.orientation }
          : {}),
        ...(typeof spec.stacked === "boolean" ? { stacked: spec.stacked } : {}),
      });
    }
  }
  const condKinds = [
    "greater",
    "greaterEqual",
    "less",
    "lessEqual",
    "equal",
    "notEqual",
    "between",
    "notBetween",
    "textContains",
    "textStarts",
    "textEnds",
    "blank",
    "notBlank",
    "error",
    "duplicate",
    "unique",
    "top",
    "bottom",
    "topPercent",
    "bottomPercent",
    "aboveAvg",
    "belowAvg",
    "colorScale",
    "dataBar",
    "iconSet",
  ];
  const iconSets = ["arrows", "traffic", "flags"];
  const readCondStyle = (s: unknown): ConditionalStyle | undefined => {
    if (!s || typeof s !== "object") return undefined;
    const o = s as Record<string, unknown>;
    const out: ConditionalStyle = {};
    if (typeof o.bg === "string") out.bg = o.bg;
    if (typeof o.textColor === "string") out.textColor = o.textColor;
    if (o.bold === true) out.bold = true;
    if (o.italic === true) out.italic = true;
    if (o.border === true) out.border = true;
    return Object.keys(out).length ? out : undefined;
  };
  const conditionals: ConditionalRule[] = [];
  for (const c of Array.isArray(raw.conditionals) ? raw.conditionals : []) {
    const rule = c as Partial<ConditionalRule>;
    if (
      rule &&
      typeof rule.id === "string" &&
      typeof rule.range === "string" &&
      typeof rule.kind === "string" &&
      condKinds.includes(rule.kind)
    ) {
      const style = readCondStyle(rule.style);
      conditionals.push({
        id: rule.id,
        range: rule.range,
        kind: rule.kind as ConditionalKind,
        ...(num(rule.value) !== undefined ? { value: num(rule.value) } : {}),
        ...(num(rule.value2) !== undefined ? { value2: num(rule.value2) } : {}),
        ...(typeof rule.color === "string" ? { color: rule.color } : {}),
        ...(typeof rule.text === "string" ? { text: rule.text } : {}),
        /* Read permissively but emit sparsely: `enabled` defaults to on, so
             only an explicit `false` is worth storing. */
        ...(rule.enabled === false ? { enabled: false } : {}),
        ...(num(rule.order) !== undefined ? { order: num(rule.order) } : {}),
        ...(typeof rule.stopIfTrue === "boolean"
          ? { stopIfTrue: rule.stopIfTrue }
          : {}),
        ...(style ? { style } : {}),
        ...(typeof rule.iconSet === "string" && iconSets.includes(rule.iconSet)
          ? { iconSet: rule.iconSet as IconSet }
          : {}),
        ...(typeof rule.minColor === "string"
          ? { minColor: rule.minColor }
          : {}),
        ...(typeof rule.midColor === "string"
          ? { midColor: rule.midColor }
          : {}),
        ...(typeof rule.maxColor === "string"
          ? { maxColor: rule.maxColor }
          : {}),
      });
    }
  }
  const hidden = Array.isArray(raw.hidden)
    ? Array.from(new Set(raw.hidden.filter((n): n is number => typeof n === "number" && n >= 0)))
    : [];

  const readSizeMap = (
    input: unknown,
    lo: number,
    hi: number,
  ): Record<number, number> => {
    const out: Record<number, number> = {};
    if (!input || typeof input !== "object") return out;
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0) continue;
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      out[index] = clamp(value, lo, hi);
    }
    return out;
  };
  const rowHeights = readSizeMap(raw.rowHeights, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
  const columnWidths = readSizeMap(raw.columnWidths, MIN_COL_WIDTH, MAX_COL_WIDTH);

  const rows = clamp(raw.rows ?? DEFAULT_ROWS, 1, MAX_ROWS);
  const cols = clamp(raw.cols ?? DEFAULT_COLS, 1, MAX_COLS);

  /* Kept sorted and non-overlapping on the way IN, not just on the way out of
   * `mergeCells` — a hand-edited or corrupted document could otherwise hand
   * the renderer two merges claiming the same cell, and colSpan/rowSpan on a
   * cell HTML has already double-claimed is undefined behaviour, not a
   * graceful one. Later entries losing to earlier ones on overlap is
   * arbitrary but deterministic, which is all correctness requires here. */
  const mergedRanges: string[] = [];
  const mergedClaimed = new Set<string>();
  for (const entry of Array.isArray(raw.mergedRanges) ? raw.mergedRanges : []) {
    if (typeof entry !== "string") continue;
    const rect = rangeToRect(entry);
    if (!rect || rect.top === rect.bottom && rect.left === rect.right) continue;
    if (rect.bottom >= rows || rect.right >= cols) continue;
    let overlaps = false;
    for (let r = rect.top; r <= rect.bottom && !overlaps; r++)
      for (let c = rect.left; c <= rect.right; c++)
        if (mergedClaimed.has(`${r},${c}`)) {
          overlaps = true;
          break;
        }
    if (overlaps) continue;
    for (let r = rect.top; r <= rect.bottom; r++)
      for (let c = rect.left; c <= rect.right; c++) mergedClaimed.add(`${r},${c}`);
    mergedRanges.push(rangeLabel(rect));
  }

  const images: Record<string, CellImage> = {};
  if (raw.images && typeof raw.images === "object") {
    for (const [ref, value] of Object.entries(raw.images as Record<string, unknown>)) {
      const pos = parseRef(ref);
      if (!pos || !value || typeof value !== "object") continue;
      const v = value as Partial<CellImage>;
      if (typeof v.url !== "string" || !v.url) continue;
      images[cellRef(pos.row, pos.col)] = {
        fileId: typeof v.fileId === "string" ? v.fileId : null,
        url: v.url,
        name: typeof v.name === "string" ? v.name : "image",
      };
    }
  }

  return {
    cells,
    styles,
    rows,
    cols,
    ...(charts.length ? { charts } : {}),
    ...(conditionals.length ? { conditionals } : {}),
    ...(hidden.length ? { hidden } : {}),
    ...(Object.keys(rowHeights).length ? { rowHeights } : {}),
    ...(Object.keys(columnWidths).length ? { columnWidths } : {}),
    ...(mergedRanges.length ? { mergedRanges } : {}),
    ...(Object.keys(images).length ? { images } : {}),
  };
}

/**
 * Read a stored sheet, tolerating anything.
 *
 * The JSON comes from Firestore and from a CRDT, so it is not guaranteed to be
 * the shape this wrote. Anything unreadable yields an EMPTY sheet rather than
 * throwing — a spreadsheet that will not open is worse than one that opens
 * blank, because the second still lets somebody paste their data back in.
 */
export function readSheet(json: string | null | undefined): SheetData {
  if (!json) return emptySheet();
  try {
    return parseSheet(JSON.parse(json));
  } catch {
    return emptySheet();
  }
}

/** A sheet as its stored plain object — empties dropped (see writeSheet). */
function sheetToObject(data: SheetData): Record<string, unknown> {
  const cells: CellMap = {};
  for (const [ref, value] of Object.entries(data.cells)) {
    if (value !== "") cells[ref] = value;
  }
  const styles: StyleMap = {};
  for (const [ref, style] of Object.entries(data.styles)) {
    if (
      style &&
      Object.values(style).some((v) => v !== undefined && v !== false)
    ) {
      styles[ref] = style;
    }
  }
  return {
    cells,
    styles,
    rows: data.rows,
    cols: data.cols,
    ...(data.charts?.length ? { charts: data.charts } : {}),
    ...(data.conditionals?.length ? { conditionals: data.conditionals } : {}),
    ...(data.hidden?.length ? { hidden: data.hidden } : {}),
    ...(data.rowHeights && Object.keys(data.rowHeights).length
      ? { rowHeights: data.rowHeights }
      : {}),
    ...(data.columnWidths && Object.keys(data.columnWidths).length
      ? { columnWidths: data.columnWidths }
      : {}),
    ...(data.mergedRanges?.length ? { mergedRanges: data.mergedRanges } : {}),
    ...(data.images && Object.keys(data.images).length
      ? { images: data.images }
      : {}),
  };
}

/**
 * Write a sheet.
 *
 * Empty cells and empty styles are DROPPED rather than stored: clearing a cell
 * must shrink the document, or a sheet that has been filled and emptied stays
 * as large as it ever was.
 */
export function writeSheet(data: SheetData): string {
  return JSON.stringify(sheetToObject(data));
}

/* ── Workbooks (multiple sheet tabs) ──────────────────────────────────────── */

/** A named sheet within a workbook — the tab and its data. */
export interface SheetTab extends SheetData {
  id: string;
  name: string;
  /** An optional tab colour (any CSS colour). */
  color?: string;
}

/** A document's sheets, in tab order, and which one was last active. */
export interface Workbook {
  sheets: SheetTab[];
  activeId?: string;
}

/** A ceiling on tabs, mirroring the row/col bounds. */
export const MAX_SHEETS = 32;

/** A fresh document: one blank sheet. */
export function blankWorkbook(): Workbook {
  const id = "sheet-1";
  return { sheets: [{ id, name: "Sheet 1", ...emptySheet() }], activeId: id };
}

/**
 * Read a stored workbook, tolerating anything — and transparently upgrading the
 * LEGACY single-sheet shape.
 *
 * A document written before tabs stored one bare SheetData (`{cells,rows,…}`);
 * one written after stores `{sheets:[…]}`. A `sheets` array reads as a workbook;
 * anything else is wrapped as a single tab — so every old document opens as a
 * one-tab workbook with no migration step, and never as a blank.
 */
export function readWorkbook(json: string | null | undefined): Workbook {
  if (!json) return blankWorkbook();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return blankWorkbook();
  }
  if (!raw || typeof raw !== "object") return blankWorkbook();
  const obj = raw as { sheets?: unknown; activeId?: unknown };
  if (!Array.isArray(obj.sheets)) {
    const id = "sheet-1";
    return {
      sheets: [{ id, name: "Sheet 1", ...parseSheet(raw) }],
      activeId: id,
    };
  }
  const sheets: SheetTab[] = [];
  const seen = new Set<string>();
  for (const s of obj.sheets.slice(0, MAX_SHEETS)) {
    if (!s || typeof s !== "object") continue;
    const t = s as { id?: unknown; name?: unknown; color?: unknown };
    let id =
      typeof t.id === "string" && t.id ? t.id : `sheet-${sheets.length + 1}`;
    while (seen.has(id)) id = `${id}-${sheets.length + 1}`;
    seen.add(id);
    sheets.push({
      id,
      name:
        typeof t.name === "string" && t.name
          ? t.name
          : `Sheet ${sheets.length + 1}`,
      ...(typeof t.color === "string" ? { color: t.color } : {}),
      ...parseSheet(s),
    });
  }
  if (sheets.length === 0) return blankWorkbook();
  const activeId =
    typeof obj.activeId === "string" &&
    sheets.some((s) => s.id === obj.activeId)
      ? obj.activeId
      : sheets[0].id;
  return { sheets, activeId };
}

/** Write a workbook to its stored JSON — each sheet compacted, empties dropped. */
export function writeWorkbook(wb: Workbook): string {
  return JSON.stringify({
    sheets: wb.sheets.map((s) => ({
      id: s.id,
      name: s.name,
      ...(s.color ? { color: s.color } : {}),
      ...sheetToObject(s),
    })),
    ...(wb.activeId ? { activeId: wb.activeId } : {}),
  });
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * How a computed value is shown.
 *
 * HyperFormula returns numbers, strings, booleans and error objects. A cell
 * that failed must show its ERROR CODE — `#DIV/0!` — rather than blank or
 * `[object Object]`: the code is what tells somebody which formula to fix.
 */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? String(value)
      : String(Number(value.toFixed(10)));
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") {
    const e = value as { value?: unknown; error?: unknown; type?: unknown };
    if (typeof e.value === "string") return e.value;
    if (typeof e.type === "string") return `#${e.type}`;
    return "#ERROR!";
  }
  return String(value);
}

/** Whether a displayed value should sit right, as numbers do in every sheet. */
export function isNumericDisplay(value: unknown): boolean {
  return typeof value === "number";
}

/* ── Selection ────────────────────────────────────────────────────────────── */

export interface CellPos {
  row: number;
  col: number;
}
export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** The rectangle two corners span, in any order, as top/left/bottom/right. */
export function normalizeRange(a: CellPos, b: CellPos): Rect {
  return {
    top: Math.min(a.row, b.row),
    bottom: Math.max(a.row, b.row),
    left: Math.min(a.col, b.col),
    right: Math.max(a.col, b.col),
  };
}

/** Is a cell inside the rectangle? */
export function inRect(row: number, col: number, r: Rect): boolean {
  return row >= r.top && row <= r.bottom && col >= r.left && col <= r.right;
}

/** The A1-style reference for the range, e.g. `A1:C3`, or the single cell. */
export function rangeLabel(r: Rect): string {
  const a = cellRef(r.top, r.left);
  const b = cellRef(r.bottom, r.right);
  return a === b ? a : `${a}:${b}`;
}

/* ── Formula name completion ──────────────────────────────────────────────── */

/**
 * The common spreadsheet functions, offered by name completion.
 *
 * Upper case, as HyperFormula registers them. Not the whole library of 400+ —
 * the ones people reach for without looking them up, so a prefix menu of eight
 * is useful rather than a scroll of two hundred. **Every name here is one the
 * engine actually evaluates** (verified against the registered set), so
 * autocomplete never offers a function that would come back `#NAME?`. The
 * spill/dynamic-array functions the engine lacks — SORT, UNIQUE — are added as
 * custom plugins elsewhere, not listed here until they resolve.
 */
export const COMMON_FUNCTIONS: readonly string[] = [
  "ABS",
  "AND",
  "AVERAGE",
  "AVERAGEIF",
  "CEILING",
  "CONCATENATE",
  "COUNT",
  "COUNTA",
  "COUNTIF",
  "COUNTIFS",
  "DATE",
  "DATEDIF",
  "DAY",
  "EDATE",
  "EOMONTH",
  "FILTER",
  "FIND",
  "FLOOR",
  "HLOOKUP",
  "HOUR",
  "IF",
  "IFERROR",
  "IFS",
  "INDEX",
  "INT",
  "ISBLANK",
  "LEFT",
  "LEN",
  "LOWER",
  "MATCH",
  "MAX",
  "MAXIFS",
  "MEDIAN",
  "MID",
  "MIN",
  "MINIFS",
  "MINUTE",
  "MOD",
  "MONTH",
  "NETWORKDAYS",
  "NOT",
  "NOW",
  "OR",
  "POWER",
  "PRODUCT",
  "PROPER",
  "RIGHT",
  "ROUND",
  "ROUNDDOWN",
  "ROUNDUP",
  "SEARCH",
  "SECOND",
  "SQRT",
  "STDEV",
  "SUBSTITUTE",
  "SUM",
  "SUMIF",
  "SUMIFS",
  "SUMPRODUCT",
  "SWITCH",
  "TEXT",
  "TEXTJOIN",
  "TIME",
  "TODAY",
  "TRANSPOSE",
  "TRIM",
  "UPPER",
  "VALUE",
  "VLOOKUP",
  "WEEKDAY",
  "WORKDAY",
  "XLOOKUP",
  "YEAR",
];

/**
 * A spreadsheet error code in plain English, or null for an ordinary value.
 *
 * `displayValue` turns a failed formula into its code — `#DIV/0!`, `#REF!` — and
 * the code is what tells somebody *which* formula to fix, but only if they know
 * what it means. This maps each to a one-line explanation for a hover tooltip, so
 * the cell reads "#REF!" and the tooltip says a reference points at a cell that
 * no longer exists. Anything not starting with `#` is a normal value → null.
 */
export function explainError(shown: string): string | null {
  if (!shown.startsWith("#")) return null;
  switch (shown) {
    case "#DIV/0!":
      return "Dividing by zero, or by an empty cell — check the denominator.";
    case "#REF!":
      return "A reference points at a cell that no longer exists.";
    case "#NAME?":
      return "An unrecognised name — check the function spelling or a missing quote.";
    case "#VALUE!":
      return "The wrong kind of value — a number was expected where text was found.";
    case "#N/A":
      return "No match was found (common with VLOOKUP / MATCH / XLOOKUP).";
    case "#NUM!":
      return "A number is invalid or too large for this calculation.";
    case "#NULL!":
      return "The two ranges given do not intersect.";
    case "#CYCLE!":
    case "#CIRCULAR!":
      return "A formula refers back to itself — a circular reference.";
    default:
      return "This formula could not be calculated.";
  }
}

/**
 * The function name a formula is part-way through typing, for autocomplete.
 *
 * The trailing run of letters after the `=`, an operator, an open paren or a
 * comma — so `=SU` offers `SUM` and `=SUM(A1)+AV` offers `AVERAGE`. Null when the
 * run is the tail of a cell reference (`A1`, `B12`) or the text is not a formula,
 * so no menu appears where a function name would make no sense.
 */
export function formulaFunctionPrefix(text: string): string | null {
  if (!isFormula(text)) return null;
  const m = /([A-Za-z]+)$/.exec(text);
  if (!m) return null;
  const before = text[text.length - m[1].length - 1];
  /* A letter run glued to a digit/letter/dot before it is part of a reference or
     a longer token, not a fresh function name. `=`, `(`, `,` and operators are
     the boundaries a name legitimately follows. */
  if (before && /[0-9A-Za-z.]/.test(before)) return null;
  return m[1].toUpperCase();
}

/**
 * Whether a formula, as typed so far, is waiting for a cell REFERENCE.
 *
 * True right after `=`, an open paren, a comma, or an operator — the positions
 * where, in a real spreadsheet, clicking a cell drops its reference in and keeps
 * you editing. False for a plain value and for a formula already ending in
 * something concrete (`=A1`, `=SUM(A1:B2)`), where an ordinary click should
 * select a cell rather than point at one.
 */
export function formulaAcceptsReference(text: string): boolean {
  if (!isFormula(text)) return false;
  const trimmed = text.replace(/\s+$/, "");
  const last = trimmed[trimmed.length - 1];
  return last !== undefined && "=(,+-*/^&<>%:".includes(last);
}

/**
 * A formula with its RELATIVE references shifted — the heart of fill-down and of
 * copying a formula across a range. `=A1+$B$1` moved one row down becomes
 * `=A2+$B$1`: the unanchored `A1` follows, the `$`-anchored `$B$1` stays put.
 * Rows and columns clamp at the top-left edge so a reference never goes negative.
 *
 * A scan, not a parser. It skips anything shaped like a reference but followed by
 * `(` — `LOG10(` is a function, not cell `LOG10` — leaves plain text alone, and
 * steps over quoted string literals whole, so `=CONCATENATE("A1",B2)` shifts
 * `B2` but never the `"A1"` the user typed as text. `""` inside a literal is an
 * escaped quote; an unterminated literal runs to the end of the formula, which
 * matches how a sheet lexes it. That is what keeps it small and predictable.
 */
export function offsetReferences(
  formula: string,
  dRow: number,
  dCol: number,
): string {
  if (!isFormula(formula)) return formula;
  return formula.replace(
    /* First alternative: a double-quoted string literal (`""` = escaped quote,
       missing close = runs to the end), matched whole so the reference pattern
       never sees its contents. Second: a reference. `(?![\w(])` — not followed
       by a word char or `(`. Excluding digits stops the quantifier
       backtracking (`LOG10(` matching as `LOG1`); excluding `(` skips
       function names. */
    /"(?:[^"]|"")*"?|(\$?)([A-Za-z]+)(\$?)(\d+)(?![\w(])/g,
    (
      whole,
      colAbs: string | undefined,
      colLetters: string | undefined,
      rowAbs: string | undefined,
      rowDigits: string | undefined,
    ) => {
      /* The string-literal alternative has no capture groups — leave it as-is. */
      if (colLetters === undefined || rowDigits === undefined) return whole;
      const col = columnIndex(colLetters);
      if (col < 0) return whole;
      const row = Number(rowDigits) - 1;
      const newCol = colAbs ? col : Math.max(0, col + dCol);
      const newRow = rowAbs ? row : Math.max(0, row + dRow);
      return `${colAbs}${columnLabel(newCol)}${rowAbs}${newRow + 1}`;
    },
  );
}

/** Function names matching a prefix, sorted, capped for a usable menu. */
export function matchFunctionNames(
  prefix: string,
  names: readonly string[] = COMMON_FUNCTIONS,
  limit = 8,
): string[] {
  const p = prefix.toUpperCase();
  if (!p) return [];
  return names
    .filter((n) => n.toUpperCase().startsWith(p))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
}

/**
 * A pasted clipboard payload as a grid of raw cell strings.
 *
 * Excel, Google Sheets and the like put a copied block on the clipboard as
 * TAB-separated columns and NEWLINE-separated rows — so pasting a 3×2 selection
 * arrives as three lines of two tab-joined values. A single copied cell is just
 * that one value with no separators, which falls out of the same parse as a 1×1
 * grid. The trailing newline those apps append is dropped so a paste does not
 * clear the empty row just below the block; interior blank rows are kept.
 */
export function parseClipboardTable(text: string): string[][] {
  if (!text) return [];
  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  if (rows.length > 1 && rows[rows.length - 1] === "") rows.pop();
  return rows.map((line) => line.split("\t"));
}

/* ── Number formats & the selection summary ───────────────────────────────── */

/**
 * A number as a chosen format shows it — a presentation layer over a value that
 * itself never changes, so the stored `1234.5` reads `₹1,234.50` or `123450%`
 * without the cell holding anything but `1234.5`.
 *
 *  · `currency` — ₹, grouped, two decimals.
 *  · `percent`  — value ×100 with a `%`, so `0.2` reads `20%`.
 *  · `comma`    — grouped thousands, up to two decimals.
 *  · `plain`/absent — `displayValue`'s shortest honest form.
 *
 * Only ever handed a finite number by its callers; anything else falls through
 * to `displayValue`, which is where non-numeric cells are already handled.
 */
export function formatNumber(
  value: number,
  format: NumberFormat | undefined,
  decimals?: number,
): string {
  if (!Number.isFinite(value)) return displayValue(value);
  /* Fixed decimals, when the increase/decrease-decimal controls have set them,
     pin BOTH bounds so `2` reads `1.20`, not `1.2`. */
  const fixed =
    typeof decimals === "number" && decimals >= 0
      ? {
          minimumFractionDigits: Math.min(10, decimals),
          maximumFractionDigits: Math.min(10, decimals),
        }
      : null;
  switch (format) {
    case "currency":
      return (
        "₹" +
        value.toLocaleString(
          "en-IN",
          fixed ?? { minimumFractionDigits: 2, maximumFractionDigits: 2 },
        )
      );
    case "percent":
      return (
        (value * 100).toLocaleString(
          "en-IN",
          fixed ?? { maximumFractionDigits: 2 },
        ) + "%"
      );
    case "comma":
      return value.toLocaleString(
        "en-IN",
        fixed ?? { maximumFractionDigits: 2 },
      );
    default:
      /* No named format but decimals set (the decimal buttons on a plain
         number): fixed places, no grouping. Otherwise the shortest honest form. */
      return fixed
        ? value.toLocaleString("en-US", { ...fixed, useGrouping: false })
        : displayValue(value);
  }
}

export interface CellSummary {
  /** Numeric cells only — a range of labels summarises to a count of zero. */
  count: number;
  sum: number;
  avg: number | null;
  min: number | null;
  max: number | null;
}

/**
 * Sum / average / count / min / max over the numbers in a selection.
 *
 * The figures a spreadsheet drops into its status bar the instant a range is
 * selected — computed from the values the cells EVALUATED to, so a column of
 * `=A1*2` summarises by its results. Non-numbers are ignored rather than counted
 * as zero, matching what Sheets shows.
 */
export function summarize(values: readonly number[]): CellSummary {
  const nums = values.filter(
    (v) => typeof v === "number" && Number.isFinite(v),
  );
  if (nums.length === 0)
    return { count: 0, sum: 0, avg: null, min: null, max: null };
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    count: nums.length,
    sum,
    avg: sum / nums.length,
    min: Math.min(...nums),
    max: Math.max(...nums),
  };
}

/* ── Charts ───────────────────────────────────────────────────────────────── */

/** A range string (`A1:C10`, or a single `A1`) as a rectangle, or null. */
export function rangeToRect(range: string): Rect | null {
  const [a, b] = range.split(":");
  const first = parseRef(a ?? "");
  const second = b ? parseRef(b) : first;
  if (!first || !second) return null;
  return normalizeRange(first, second);
}

export interface ChartSeries {
  name: string;
  values: number[];
}
export interface ChartModel {
  labels: string[];
  series: ChartSeries[];
}

/**
 * The data a chart draws, pulled from its range.
 *
 * With the default `cols` orientation the first COLUMN is the category labels and
 * each further column is a series whose name is its header (the top cell) when
 * that row reads as text; `rows` transposes that, so a wide block laid out with
 * series along each row charts the same way. A single line of data charts its own
 * values against 1..n. Non-numbers read as gaps (0). The caller passes the
 * accessor, so the numbers are the EVALUATED ones — a chart of `=A1*2` plots the
 * result, not the formula.
 */
export function chartData(
  range: string,
  cell: (row: number, col: number) => { text: string; number: number | null },
  orientation: "cols" | "rows" = "cols",
): ChartModel {
  const rect = rangeToRect(range);
  if (!rect) return { labels: [], series: [] };
  const height = rect.bottom - rect.top + 1;
  const width = rect.right - rect.left + 1;

  /* Read the block as R rows of C "line slots": in `cols` a line is a column, in
     `rows` a line is a row. `at(i, j)` walks slot `j` down line-index `i`, so the
     extraction below is written once and transposition is just this accessor. */
  const R = orientation === "rows" ? width : height;
  const C = orientation === "rows" ? height : width;
  const at = (i: number, j: number) =>
    orientation === "rows"
      ? cell(rect.top + j, rect.left + i)
      : cell(rect.top + i, rect.left + j);

  /* One line of values: charted against 1..n; a text lead cell names the series. */
  if (C === 1) {
    const head = at(0, 0);
    const headed = head.number === null && head.text !== "";
    const startI = headed ? 1 : 0;
    const values: number[] = [];
    const labels: string[] = [];
    for (let i = startI; i < R; i++) {
      values.push(at(i, 0).number ?? 0);
      labels.push(String(i - startI + 1));
    }
    return {
      labels,
      series: [{ name: headed ? head.text : "Series 1", values }],
    };
  }

  /* A header line is present when the lead slot's series cells are text. */
  let headed = false;
  for (let j = 1; j < C; j++) {
    const v = at(0, j);
    if (v.text !== "" && v.number === null) {
      headed = true;
      break;
    }
  }
  const startI = headed ? 1 : 0;
  const labels: string[] = [];
  for (let i = startI; i < R; i++)
    labels.push(at(i, 0).text || String(i - startI + 1));
  const series: ChartSeries[] = [];
  for (let j = 1; j < C; j++) {
    const name = headed ? at(0, j).text || `Series ${j}` : `Series ${j}`;
    const values: number[] = [];
    for (let i = startI; i < R; i++) values.push(at(i, j).number ?? 0);
    series.push({ name, values });
  }
  return { labels, series };
}

/* ── Conditional formatting ───────────────────────────────────────────────── */

export interface ConditionalResult {
  /** A background fill to apply. */
  bg?: string;
  /** The text colour to apply. */
  textColor?: string;
  bold?: boolean;
  italic?: boolean;
  /** Draw a border around the cell. */
  border?: boolean;
  /** A data bar: a fraction 0..1 of the cell width, and its colour. */
  bar?: { pct: number; color: string };
  /** An icon-set glyph and its colour, drawn before the value. */
  icon?: { ch: string; color: string };
}

/**
 * What a rule needs to know about its whole range to judge one cell.
 *
 * Some rules are cell-local (greater than 5), but rank, average, duplicate and
 * the scales need the range measured first — so the caller does ONE capped pass
 * per rule and hands the summary in, rather than every cell re-scanning.
 */
export interface RuleStats {
  min: number;
  max: number;
  /** Mean of the numeric values. */
  mean: number;
  /** How many numeric values there are. */
  count: number;
  /** The numeric values, sorted high→low, for top/bottom N & percentiles. */
  sortedDesc: number[];
  /** Occurrences of each displayed non-empty value, for duplicate/unique. */
  textCounts: Map<string, number>;
}

/** What a cell presents to a rule: its numeric value (or null) and shown text. */
export interface CellContext {
  value: number | null;
  text: string;
}

/** A red→yellow→green heat colour for `t` in 0..1 (low red, high green). */
export function colorScale(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const stops: readonly (readonly [
    number,
    readonly [number, number, number],
  ])[] = [
    [0, [248, 105, 107]],
    [0.5, [255, 235, 132]],
    [1, [99, 190, 123]],
  ];
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (x >= stops[i][0] && x <= stops[i + 1][0]) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  const f = (x - lo[0]) / (hi[0] - lo[0] || 1);
  const ch = (i: number) => Math.round(lo[1][i] + (hi[1][i] - lo[1][i]) * f);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

/** Blend two `#rrggbb` colours, `t` in 0..1. */
function mixHex(a: string, b: string, t: number): string {
  const parse = (h: string): [number, number, number] => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h.trim());
    return m
      ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
      : [128, 128, 128];
  };
  const x = Math.max(0, Math.min(1, t));
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const ch = (u: number, v: number) => Math.round(u + (v - u) * x);
  return `rgb(${ch(r1, r2)}, ${ch(g1, g2)}, ${ch(b1, b2)})`;
}

/** The heat colour for a scale rule — the rule's own endpoints, or the default. */
function scaleColor(t: number, rule: ConditionalRule): string {
  const x = Math.max(0, Math.min(1, t));
  if (rule.minColor || rule.maxColor || rule.midColor) {
    const lo = rule.minColor ?? "#f8696b";
    const hi = rule.maxColor ?? "#63be7b";
    if (rule.midColor)
      return x < 0.5
        ? mixHex(lo, rule.midColor, x * 2)
        : mixHex(rule.midColor, hi, (x - 0.5) * 2);
    return mixHex(lo, hi, x);
  }
  return colorScale(x);
}

const ICON_SETS: Record<IconSet, { ch: string; color: string }[]> = {
  arrows: [
    { ch: "▼", color: "#e0655f" },
    { ch: "▶", color: "#e6a23c" },
    { ch: "▲", color: "#4caf82" },
  ],
  traffic: [
    { ch: "●", color: "#e0655f" },
    { ch: "●", color: "#e6a23c" },
    { ch: "●", color: "#4caf82" },
  ],
  flags: [
    { ch: "⚑", color: "#e0655f" },
    { ch: "⚑", color: "#e6a23c" },
    { ch: "⚑", color: "#4caf82" },
  ],
};

/** Split the range into thirds and pick the icon for where `t` (0..1) lands. */
function pickIcon(set: IconSet, t: number): { ch: string; color: string } {
  const bucket = t >= 2 / 3 ? 2 : t >= 1 / 3 ? 1 : 0;
  return ICON_SETS[set][bucket];
}

/** The formatting a highlight rule paints — its rich style, or a fallback fill. */
function highlight(
  rule: ConditionalRule,
  fallbackBg: string,
): ConditionalResult {
  const s = rule.style;
  const res: ConditionalResult = {};
  /* A chosen style wins; else the legacy `color`; else the kind's default fill,
     but only when no explicit style was set (so "just colour the text" stays so). */
  const bg = s?.bg ?? rule.color ?? (s ? undefined : fallbackBg);
  if (bg) res.bg = bg;
  if (s?.textColor) res.textColor = s.textColor;
  if (s?.bold) res.bold = true;
  if (s?.italic) res.italic = true;
  if (s?.border) res.border = true;
  return res;
}

/** How many items a rank rule includes (N, or N% of the count). */
function rankCount(rule: ConditionalRule, stats: RuleStats): number {
  const raw = rule.value ?? 10;
  if (rule.kind === "topPercent" || rule.kind === "bottomPercent")
    return Math.max(1, Math.ceil((stats.count * raw) / 100));
  return Math.max(1, Math.floor(raw));
}

/**
 * The formatting a conditional rule gives a cell, or null when it does not fire.
 *
 * `ctx` is the cell (its numeric value, or null, and its shown text); `stats` is
 * the rule's whole range, measured once by the caller. The six original kinds
 * keep their old fills, so a legacy rule looks identical; the rest are opt-in.
 */
export function evalConditional(
  rule: ConditionalRule,
  ctx: CellContext,
  stats: RuleStats,
): ConditionalResult | null {
  const { value: v, text } = ctx;
  const RED = "#ffc7ce";
  const YELLOW = "#ffeb9c";
  const GREEN = "#c6efce";
  switch (rule.kind) {
    case "greater":
      return v !== null && v > (rule.value ?? 0) ? highlight(rule, RED) : null;
    case "greaterEqual":
      return v !== null && v >= (rule.value ?? 0) ? highlight(rule, RED) : null;
    case "less":
      return v !== null && v < (rule.value ?? 0) ? highlight(rule, RED) : null;
    case "lessEqual":
      return v !== null && v <= (rule.value ?? 0) ? highlight(rule, RED) : null;
    case "equal":
      return v !== null && v === (rule.value ?? 0)
        ? highlight(rule, YELLOW)
        : null;
    case "notEqual":
      return v !== null && v !== (rule.value ?? 0)
        ? highlight(rule, YELLOW)
        : null;
    case "between":
      return v !== null && v >= (rule.value ?? 0) && v <= (rule.value2 ?? 0)
        ? highlight(rule, GREEN)
        : null;
    case "notBetween":
      return v !== null && (v < (rule.value ?? 0) || v > (rule.value2 ?? 0))
        ? highlight(rule, GREEN)
        : null;
    case "textContains":
      return rule.text && text.toLowerCase().includes(rule.text.toLowerCase())
        ? highlight(rule, YELLOW)
        : null;
    case "textStarts":
      return rule.text && text.toLowerCase().startsWith(rule.text.toLowerCase())
        ? highlight(rule, YELLOW)
        : null;
    case "textEnds":
      return rule.text && text.toLowerCase().endsWith(rule.text.toLowerCase())
        ? highlight(rule, YELLOW)
        : null;
    case "blank":
      return text === "" ? highlight(rule, RED) : null;
    case "notBlank":
      return text !== "" ? highlight(rule, GREEN) : null;
    case "error":
      return explainError(text) !== null ? highlight(rule, RED) : null;
    case "duplicate":
      return text !== "" && (stats.textCounts.get(text) ?? 0) > 1
        ? highlight(rule, RED)
        : null;
    case "unique":
      return text !== "" && (stats.textCounts.get(text) ?? 0) === 1
        ? highlight(rule, GREEN)
        : null;
    case "top":
    case "topPercent": {
      if (v === null || stats.count === 0) return null;
      const n = Math.min(rankCount(rule, stats), stats.sortedDesc.length);
      return v >= stats.sortedDesc[n - 1] ? highlight(rule, GREEN) : null;
    }
    case "bottom":
    case "bottomPercent": {
      if (v === null || stats.count === 0) return null;
      const n = Math.min(rankCount(rule, stats), stats.sortedDesc.length);
      return v <= stats.sortedDesc[stats.sortedDesc.length - n]
        ? highlight(rule, RED)
        : null;
    }
    case "aboveAvg":
      return v !== null && v > stats.mean ? highlight(rule, GREEN) : null;
    case "belowAvg":
      return v !== null && v < stats.mean ? highlight(rule, RED) : null;
    case "colorScale": {
      if (v === null) return null;
      const t =
        stats.max === stats.min
          ? 0.5
          : (v - stats.min) / (stats.max - stats.min);
      return { bg: scaleColor(t, rule) };
    }
    case "dataBar": {
      if (v === null) return null;
      const top = Math.max(stats.max, 0);
      const pct = top <= 0 ? 0 : Math.max(0, Math.min(1, v / top));
      return { bar: { pct, color: rule.color ?? "#5b9bd5" } };
    }
    case "iconSet": {
      if (v === null) return null;
      /* A degenerate range (every value equal) maps to the NEUTRAL midpoint —
         the same choice colour scales make — so identical data doesn't falsely
         read as all-high or all-low. */
      const t =
        stats.max === stats.min
          ? 0.5
          : (v - stats.min) / (stats.max - stats.min);
      return { icon: pickIcon(rule.iconSet ?? "arrows", t) };
    }
  }
}

/**
 * A human-readable summary of a rule, for the rule-list rows in the panel.
 *
 * "Cell > 100", "Top 10 items", "Text contains 'draft'" — the sentence a person
 * reads to know what a rule does without opening its editor.
 */
export function describeConditional(rule: ConditionalRule): string {
  const n = rule.value ?? 0;
  switch (rule.kind) {
    case "greater":
      return `Cell > ${n}`;
    case "greaterEqual":
      return `Cell ≥ ${n}`;
    case "less":
      return `Cell < ${n}`;
    case "lessEqual":
      return `Cell ≤ ${n}`;
    case "equal":
      return `Cell = ${n}`;
    case "notEqual":
      return `Cell ≠ ${n}`;
    case "between":
      return `Between ${n} and ${rule.value2 ?? 0}`;
    case "notBetween":
      return `Not between ${n} and ${rule.value2 ?? 0}`;
    case "textContains":
      return `Text contains "${rule.text ?? ""}"`;
    case "textStarts":
      return `Text starts with "${rule.text ?? ""}"`;
    case "textEnds":
      return `Text ends with "${rule.text ?? ""}"`;
    case "blank":
      return "Cell is blank";
    case "notBlank":
      return "Cell is not blank";
    case "error":
      return "Cell has an error";
    case "duplicate":
      return "Duplicate values";
    case "unique":
      return "Unique values";
    case "top":
      return `Top ${n || 10} items`;
    case "bottom":
      return `Bottom ${n || 10} items`;
    case "topPercent":
      return `Top ${n || 10}%`;
    case "bottomPercent":
      return `Bottom ${n || 10}%`;
    case "aboveAvg":
      return "Above average";
    case "belowAvg":
      return "Below average";
    case "colorScale":
      return "Colour scale";
    case "dataBar":
      return "Data bar";
    case "iconSet":
      return `Icon set (${rule.iconSet ?? "arrows"})`;
  }
}

/* ── Structural edits: rows, columns, sort, filter ──────────────────────────
 *
 * Added for the AI assistant's `insert_rows` / `delete_rows` /
 * `insert_columns` / `delete_columns` / `sort_range` / `filter_range` tools —
 * the grid had no programmatic way to do any of these before a person did
 * them by hand, so there was nothing for the assistant's executor to call.
 *
 * **Known limitation, stated once here rather than on every function:**
 * these move CELL VALUES — including formula text — but do not rewrite
 * formula references. A formula that reads `=SUM(B2:B10)` keeps reading
 * `=SUM(B2:B10)` even after a row is inserted above it, which is wrong the
 * instant the insertion happened above row 2. Full reference-repair across
 * structural edits is what a real spreadsheet engine spends a large amount
 * of its own code on; building a correct version of it was out of scope for
 * this pass. `offsetReferences` (above) shifts a formula's OWN references by
 * a uniform delta for fill/paste, which is a different, narrower problem
 * than repairing every formula on the sheet that points at a range that just
 * moved.
 */

function shiftRef(ref: string, atRow: number, dRow: number, atCol: number, dCol: number): string | null {
  const pos = parseRef(ref);
  if (!pos) return null;
  const row = pos.row >= atRow ? pos.row + dRow : pos.row;
  const col = pos.col >= atCol ? pos.col + dCol : pos.col;
  if (row < 0 || col < 0) return null;
  return cellRef(row, col);
}

/**
 * A range string shifted by a structural edit.
 *
 * For an INSERT (positive delta) every edge at or after `at` moves by the
 * delta, so a range the insertion lands inside grows and one below it shifts.
 * For a DELETE (negative delta, with `at` naming the FIRST removed index and
 * `-delta` how many follow) an edge inside the deleted band clips to the
 * band's boundary: a top edge falls to `at` (the first surviving index after
 * the shift), a bottom edge to `at - 1` (the last survivor before the band).
 * A range lying entirely inside the band collapses to null — the caller drops
 * the chart/rule/merge whose data no longer exists.
 */
function shiftRangeString(range: string, atRow: number, dRow: number, atCol: number, dCol: number): string | null {
  const rect = rangeToRect(range);
  if (!rect) return range;
  const lo = (p: number, at: number, d: number): number =>
    d < 0 && p >= at && p < at - d ? at : p >= at ? p + d : p;
  const hi = (p: number, at: number, d: number): number =>
    d < 0 && p >= at && p < at - d ? at - 1 : p >= at ? p + d : p;
  const top = lo(rect.top, atRow, dRow);
  const bottom = hi(rect.bottom, atRow, dRow);
  const left = lo(rect.left, atCol, dCol);
  const right = hi(rect.right, atCol, dCol);
  if (top > bottom || left > right) return null;
  return rangeLabel({ top, bottom, left, right });
}

function shiftChartsAndConditionals(
  data: SheetData,
  atRow: number,
  dRow: number,
  atCol: number,
  dCol: number,
): Pick<SheetData, "charts" | "conditionals" | "mergedRanges"> {
  const charts = (data.charts ?? [])
    .map((c) => {
      const range = shiftRangeString(c.range, atRow, dRow, atCol, dCol);
      return range ? { ...c, range } : null;
    })
    .filter((c): c is ChartSpec => c !== null);
  const conditionals = (data.conditionals ?? [])
    .map((r) => {
      const range = shiftRangeString(r.range, atRow, dRow, atCol, dCol);
      return range ? { ...r, range } : null;
    })
    .filter((r): r is ConditionalRule => r !== null);
  /* A merge that straddled the deleted band collapses to whatever survives —
   * shiftRangeString already clips it to the remaining rows/columns, same as
   * a chart's range would. One that collapses to a single cell (or nothing)
   * is dropped: a "merge" of one cell isn't one. */
  const mergedRanges = (data.mergedRanges ?? [])
    .map((range) => shiftRangeString(range, atRow, dRow, atCol, dCol))
    .filter((range): range is string => {
      if (!range) return false;
      const rect = rangeToRect(range);
      return !!rect && !(rect.top === rect.bottom && rect.left === rect.right);
    });
  /* Emptied lists are returned as explicit `undefined` — same as the callers'
   * `images: undefined` handling — so spreading this AFTER `...data` still
   * OVERWRITES the old field. A conditional `...(charts.length ? … : {})`
   * spread would omit the key instead, quietly resurrecting the stale,
   * unshifted array from `...data` whenever every entry collapsed. */
  return {
    charts: charts.length ? charts : undefined,
    conditionals: conditionals.length ? conditionals : undefined,
    mergedRanges: mergedRanges.length ? mergedRanges : undefined,
  };
}

function remapCellsAndStyles(
  data: SheetData,
  atRow: number,
  dRow: number,
  atCol: number,
  dCol: number,
): Pick<SheetData, "cells" | "styles" | "images"> {
  const cells: CellMap = {};
  for (const [ref, value] of Object.entries(data.cells)) {
    const next = shiftRef(ref, atRow, dRow, atCol, dCol);
    if (next) cells[next] = value;
  }
  const styles: StyleMap = {};
  for (const [ref, style] of Object.entries(data.styles)) {
    const next = shiftRef(ref, atRow, dRow, atCol, dCol);
    if (next) styles[next] = style;
  }
  const images: Record<string, CellImage> = {};
  for (const [ref, image] of Object.entries(data.images ?? {})) {
    const next = shiftRef(ref, atRow, dRow, atCol, dCol);
    if (next) images[next] = image;
  }
  return { cells, styles, ...(Object.keys(images).length ? { images } : {}) };
}

/**
 * Shift a sparse index→size map (rowHeights or columnWidths) the same way `hidden`
 * shifts: entries at or after `at` move by `delta`, entries inside a deleted band
 * (`delta < 0`) are dropped. Returns undefined rather than `{}` when nothing is left,
 * so callers can spread it away instead of writing an empty object to storage.
 */
function shiftSizeMap(
  map: Record<number, number> | undefined,
  at: number,
  delta: number,
): Record<number, number> | undefined {
  if (!map) return undefined;
  const out: Record<number, number> = {};
  for (const [key, size] of Object.entries(map)) {
    const index = Number(key);
    if (delta < 0 && index >= at && index < at - delta) continue;
    const next = index >= at ? index + delta : index;
    if (next >= 0) out[next] = size;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Insert `count` blank rows above `atRow` (0-based). Rows at or below `atRow` shift down. */
export function insertRows(data: SheetData, atRow: number, count: number): SheetData {
  const n = Math.max(1, Math.round(count));
  return {
    ...data,
    ...remapCellsAndStyles(data, atRow, n, 0, 0),
    ...shiftChartsAndConditionals(data, atRow, n, 0, 0),
    rows: clamp(data.rows + n, 1, MAX_ROWS),
    hidden: (data.hidden ?? [])
      .map((r) => (r >= atRow ? r + n : r))
      .filter((r) => r < data.rows + n),
    rowHeights: shiftSizeMap(data.rowHeights, atRow, n),
  };
}

/** Delete `count` rows starting at `atRow` (0-based). Content inside the deleted band is dropped. */
export function deleteRows(data: SheetData, atRow: number, count: number): SheetData {
  const n = Math.max(1, Math.round(count));
  const cells: CellMap = {};
  for (const [ref, value] of Object.entries(data.cells)) {
    const pos = parseRef(ref)!;
    if (pos.row >= atRow && pos.row < atRow + n) continue;
    const next = shiftRef(ref, atRow + n, -n, 0, 0);
    if (next) cells[next] = value;
  }
  const styles: StyleMap = {};
  for (const [ref, style] of Object.entries(data.styles)) {
    const pos = parseRef(ref)!;
    if (pos.row >= atRow && pos.row < atRow + n) continue;
    const next = shiftRef(ref, atRow + n, -n, 0, 0);
    if (next) styles[next] = style;
  }
  const images: Record<string, CellImage> = {};
  for (const [ref, image] of Object.entries(data.images ?? {})) {
    const pos = parseRef(ref)!;
    if (pos.row >= atRow && pos.row < atRow + n) continue;
    const next = shiftRef(ref, atRow + n, -n, 0, 0);
    if (next) images[next] = image;
  }
  return {
    ...data,
    cells,
    styles,
    ...(Object.keys(images).length ? { images } : { images: undefined }),
    /* `atRow`, not `atRow + n`: shiftRangeString takes the band's FIRST removed
       index, and clips/collapses ranges inside the band itself. */
    ...shiftChartsAndConditionals(data, atRow, -n, 0, 0),
    rows: clamp(data.rows - n, 1, MAX_ROWS),
    hidden: (data.hidden ?? [])
      .filter((r) => r < atRow || r >= atRow + n)
      .map((r) => (r >= atRow + n ? r - n : r)),
    rowHeights: shiftSizeMap(data.rowHeights, atRow, -n),
  };
}

/** Insert `count` blank columns before `atCol` (0-based). */
export function insertColumns(data: SheetData, atCol: number, count: number): SheetData {
  const n = Math.max(1, Math.round(count));
  return {
    ...data,
    ...remapCellsAndStyles(data, 0, 0, atCol, n),
    ...shiftChartsAndConditionals(data, 0, 0, atCol, n),
    cols: clamp(data.cols + n, 1, MAX_COLS),
    columnWidths: shiftSizeMap(data.columnWidths, atCol, n),
  };
}

/** Delete `count` columns starting at `atCol` (0-based). */
export function deleteColumns(data: SheetData, atCol: number, count: number): SheetData {
  const n = Math.max(1, Math.round(count));
  const cells: CellMap = {};
  for (const [ref, value] of Object.entries(data.cells)) {
    const pos = parseRef(ref)!;
    if (pos.col >= atCol && pos.col < atCol + n) continue;
    const next = shiftRef(ref, 0, 0, atCol + n, -n);
    if (next) cells[next] = value;
  }
  const styles: StyleMap = {};
  for (const [ref, style] of Object.entries(data.styles)) {
    const pos = parseRef(ref)!;
    if (pos.col >= atCol && pos.col < atCol + n) continue;
    const next = shiftRef(ref, 0, 0, atCol + n, -n);
    if (next) styles[next] = style;
  }
  const images: Record<string, CellImage> = {};
  for (const [ref, image] of Object.entries(data.images ?? {})) {
    const pos = parseRef(ref)!;
    if (pos.col >= atCol && pos.col < atCol + n) continue;
    const next = shiftRef(ref, 0, 0, atCol + n, -n);
    if (next) images[next] = image;
  }
  return {
    ...data,
    cells,
    styles,
    ...(Object.keys(images).length ? { images } : { images: undefined }),
    /* `atCol`, not `atCol + n` — see the matching note in deleteRows. */
    ...shiftChartsAndConditionals(data, 0, 0, atCol, -n),
    cols: clamp(data.cols - n, 1, MAX_COLS),
    columnWidths: shiftSizeMap(data.columnWidths, atCol, -n),
  };
}

/** Set row `row`'s height in pixels (clamped to MIN/MAX_ROW_HEIGHT). */
export function resizeRow(data: SheetData, row: number, height: number): SheetData {
  const clamped = clamp(Math.round(height), MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
  return { ...data, rowHeights: { ...data.rowHeights, [row]: clamped } };
}

/** Set column `col`'s width in pixels (clamped to MIN/MAX_COL_WIDTH). */
export function resizeColumn(data: SheetData, col: number, width: number): SheetData {
  const clamped = clamp(Math.round(width), MIN_COL_WIDTH, MAX_COL_WIDTH);
  return { ...data, columnWidths: { ...data.columnWidths, [col]: clamped } };
}

/**
 * Merge `rect` into one cell. Any EXISTING merge that overlaps `rect` is
 * dropped first — Excel prompts "this will unmerge" in that situation; this
 * just does it, since the alternative (refusing, or silently keeping the old
 * merge and creating a second overlapping one) is worse than the person
 * having to notice their new merge ate an old one. A 1×1 `rect` is a no-op:
 * merging a single cell with itself isn't a merge.
 */
export function mergeCells(data: SheetData, rect: Rect): SheetData {
  if (rect.top === rect.bottom && rect.left === rect.right) return data;
  const kept = (data.mergedRanges ?? []).filter((range) => {
    const other = rangeToRect(range);
    if (!other) return false;
    const disjoint =
      other.right < rect.left ||
      other.left > rect.right ||
      other.bottom < rect.top ||
      other.top > rect.bottom;
    return disjoint;
  });
  return { ...data, mergedRanges: [...kept, rangeLabel(rect)] };
}

/** Remove every merged range that overlaps `rect` — "Unmerge Cells" over the current selection. */
export function unmergeCells(data: SheetData, rect: Rect): SheetData {
  const kept = (data.mergedRanges ?? []).filter((range) => {
    const other = rangeToRect(range);
    if (!other) return false;
    const disjoint =
      other.right < rect.left ||
      other.left > rect.right ||
      other.bottom < rect.top ||
      other.top > rect.bottom;
    return disjoint;
  });
  return { ...data, mergedRanges: kept.length ? kept : undefined };
}

/** The merged range containing (row, col), if any. */
export function mergeAt(data: SheetData, row: number, col: number): Rect | null {
  for (const range of data.mergedRanges ?? []) {
    const rect = rangeToRect(range);
    if (rect && inRect(row, col, rect)) return rect;
  }
  return null;
}

/**
 * Sort the rows of `rect` by the values in `byCol` (an absolute column
 * index, must fall within `rect`). Every column in `rect` moves together
 * with each row — a sort reorders records, not one column in isolation.
 *
 * Formula text moves as an opaque string with its row (see the module note
 * above): `=A1` in a sorted row still reads `=A1` in its new position.
 */
export function sortRange(
  data: SheetData,
  rect: Rect,
  byCol: number,
  direction: "asc" | "desc",
  hasHeaderRow: boolean,
): SheetData {
  const firstRow = hasHeaderRow ? rect.top + 1 : rect.top;
  if (firstRow > rect.bottom) return data;

  const rowIndices = Array.from({ length: rect.bottom - firstRow + 1 }, (_, i) => firstRow + i);
  const keyOf = (row: number): string => data.cells[cellRef(row, byCol)] ?? "";
  const sorted = [...rowIndices].sort((a, b) => {
    const av = keyOf(a);
    const bv = keyOf(b);
    /* Blank key cells sink to the BOTTOM in either direction — Excel and
       Google Sheets both do this, so an ascending sort never floats a run of
       empty rows above the data. Deliberately outside the direction flip. */
    if (av === "" || bv === "") return av === bv ? 0 : av === "" ? 1 : -1;
    const an = Number(av);
    const bn = Number(bv);
    const bothNumeric = Number.isFinite(an) && Number.isFinite(bn);
    const cmp = bothNumeric ? an - bn : av.localeCompare(bv);
    return direction === "asc" ? cmp : -cmp;
  });

  const cells: CellMap = { ...data.cells };
  const styles: StyleMap = { ...data.styles };
  const images: Record<string, CellImage> = { ...(data.images ?? {}) };
  for (const col of range(rect.left, rect.right)) {
    const originalValues = rowIndices.map((row) => data.cells[cellRef(row, col)]);
    const originalStyles = rowIndices.map((row) => data.styles[cellRef(row, col)]);
    /* An image is part of its row's record the same way a value or a style
       is — sorting moves all three together. */
    const originalImages = rowIndices.map((row) => data.images?.[cellRef(row, col)]);
    sorted.forEach((sourceRow, i) => {
      const destRow = rowIndices[i]!;
      const ref = cellRef(destRow, col);
      const sourceIndex = rowIndices.indexOf(sourceRow);
      const value = originalValues[sourceIndex];
      const style = originalStyles[sourceIndex];
      const image = originalImages[sourceIndex];
      if (value === undefined) delete cells[ref];
      else cells[ref] = value;
      if (style === undefined) delete styles[ref];
      else styles[ref] = style;
      if (image === undefined) delete images[ref];
      else images[ref] = image;
    });
  }

  return {
    ...data,
    cells,
    styles,
    ...(Object.keys(images).length ? { images } : { images: undefined }),
  };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export type FilterCondition = "equals" | "contains" | "notEmpty" | "empty";

/**
 * Which rows of `rect` do NOT match the condition on `byCol` — the row
 * indices `filter_range` hides, keeping the header row (if any) visible
 * regardless of whether it matches.
 */
export function rowsNotMatching(
  data: SheetData,
  rect: Rect,
  byCol: number,
  condition: FilterCondition,
  value: string,
  hasHeaderRow: boolean,
): number[] {
  const firstRow = hasHeaderRow ? rect.top + 1 : rect.top;
  const out: number[] = [];
  for (let row = firstRow; row <= rect.bottom; row++) {
    const cell = data.cells[cellRef(row, byCol)] ?? "";
    const matches =
      condition === "notEmpty"
        ? cell.trim() !== ""
        : condition === "empty"
          ? cell.trim() === ""
          : condition === "equals"
            ? cell.trim().toLowerCase() === value.trim().toLowerCase()
            : cell.toLowerCase().includes(value.toLowerCase());
    if (!matches) out.push(row);
  }
  return out;
}
