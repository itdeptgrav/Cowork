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
  /** A drawn border: every side, or just the bottom (a header rule). */
  border?: "all" | "bottom";
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

export interface SheetData {
  cells: CellMap;
  styles: StyleMap;
  rows: number;
  cols: number;
}

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

/**
 * Read a stored sheet, tolerating anything.
 *
 * The JSON comes from Firestore and from a CRDT, so it is not guaranteed to be
 * the shape this wrote. Anything unreadable yields an EMPTY sheet rather than
 * throwing — a spreadsheet that will not open is worse than one that opens
 * blank, because the second still lets somebody paste their data back in.
 */
export function readSheet(json: string | null | undefined): SheetData {
  const empty: SheetData = {
    cells: {},
    styles: {},
    rows: DEFAULT_ROWS,
    cols: DEFAULT_COLS,
  };
  if (!json) return empty;
  try {
    const raw = JSON.parse(json) as Partial<SheetData>;
    if (!raw || typeof raw !== "object") return empty;
    const cells: CellMap = {};
    for (const [ref, value] of Object.entries(raw.cells ?? {})) {
      /* Both halves checked: a key that is not a reference cannot be placed on
         the grid, and a non-string value would reach the engine as an object. */
      if (parseRef(ref) && typeof value === "string") cells[ref.toUpperCase()] = value;
    }
    const styles: StyleMap = {};
    for (const [ref, style] of Object.entries(raw.styles ?? {})) {
      if (parseRef(ref) && style && typeof style === "object") {
        styles[ref.toUpperCase()] = style as CellStyle;
      }
    }
    return {
      cells,
      styles,
      rows: clamp(raw.rows ?? DEFAULT_ROWS, 1, MAX_ROWS),
      cols: clamp(raw.cols ?? DEFAULT_COLS, 1, MAX_COLS),
    };
  } catch {
    return empty;
  }
}

/**
 * Write a sheet.
 *
 * Empty cells and empty styles are DROPPED rather than stored: clearing a cell
 * must shrink the document, or a sheet that has been filled and emptied stays
 * as large as it ever was.
 */
export function writeSheet(data: SheetData): string {
  const cells: CellMap = {};
  for (const [ref, value] of Object.entries(data.cells)) {
    if (value !== "") cells[ref] = value;
  }
  const styles: StyleMap = {};
  for (const [ref, style] of Object.entries(data.styles)) {
    if (style && Object.values(style).some((v) => v !== undefined && v !== false)) {
      styles[ref] = style;
    }
  }
  return JSON.stringify({ cells, styles, rows: data.rows, cols: data.cols });
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
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(10)));
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
 * Upper case, as HyperFormula registers them. Not the whole library — the ones
 * people reach for without looking them up, so a menu of eight is useful rather
 * than a scroll of two hundred.
 */
export const COMMON_FUNCTIONS: readonly string[] = [
  "ABS", "AND", "AVERAGE", "CEILING", "CONCATENATE", "COUNT", "COUNTA",
  "COUNTIF", "DATE", "DAY", "FLOOR", "HLOOKUP", "IF", "IFERROR", "INDEX",
  "INT", "ISBLANK", "LEFT", "LEN", "LOWER", "MATCH", "MAX", "MEDIAN", "MID",
  "MIN", "MOD", "MONTH", "NOW", "NOT", "OR", "POWER", "PRODUCT", "PROPER",
  "RIGHT", "ROUND", "ROUNDDOWN", "ROUNDUP", "SQRT", "SUM", "SUMIF", "TEXT",
  "TODAY", "TRIM", "UPPER", "VLOOKUP", "YEAR",
];

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
 * `(` — `LOG10(` is a function, not cell `LOG10` — and leaves plain text alone,
 * which is what keeps it small and predictable.
 */
export function offsetReferences(
  formula: string,
  dRow: number,
  dCol: number,
): string {
  if (!isFormula(formula)) return formula;
  return formula.replace(
    /* `(?![\w(])` — not followed by a word char or `(`. Excluding digits stops
       the quantifier backtracking (`LOG10(` matching as `LOG1`); excluding `(`
       skips function names. */
    /(\$?)([A-Za-z]+)(\$?)(\d+)(?![\w(])/g,
    (whole, colAbs: string, colLetters: string, rowAbs: string, rowDigits: string) => {
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
      return value.toLocaleString("en-IN", fixed ?? { maximumFractionDigits: 2 });
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
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
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
