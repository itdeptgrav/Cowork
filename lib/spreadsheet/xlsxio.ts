/**
 * XLSX import and export, via SheetJS (`xlsx`, Apache-2.0 — already a project
 * dependency).
 *
 * CSV and JSON are small enough to own outright; the XLSX container is a ZIP of
 * XML parts, so this leans on SheetJS rather than reimplementing it. This module
 * imports the library, so it is deliberately KEPT OUT of the engine's barrel
 * (`index.ts`) — callers `import()` it on demand, so the ~1 MB library is only
 * fetched when someone actually imports or exports a spreadsheet.
 *
 * ## What round-trips, and what does not (documented once, here)
 *
 *  · **Values and formulas** round-trip. A formula is written to the cell's `.f`
 *    field (SheetJS convention: no leading `=`), never pre-evaluated, so it
 *    recomputes wherever the file is next opened.
 *  · **Multiple sheets and their names** round-trip. Names are sanitised to
 *    Excel's rules on export (≤31 chars, none of `: \ / ? * [ ]`) and de-duped
 *    on import so cross-sheet references stay unambiguous.
 *  · **Basic formatting** — bold, italic, underline and the number-format kind —
 *    is WRITTEN. But the `xlsx` Community Edition on npm does not parse cell
 *    styles back on `read` (confirmed against this version, not assumed), so a
 *    round trip THROUGH THIS LIBRARY loses bold/italic/underline even though the
 *    file a real Excel opens is not missing them. Number formats do read back
 *    (via `.z`) and are mapped to the nearest of our format kinds.
 *  · **NOT preserved:** cell/text colours, borders, alignment, wrapping, column
 *    widths, row heights, freeze panes, filters, data validation, conditional
 *    formatting, merged cells, hyperlinks and comments. They have XLSX
 *    equivalents but are out of this exchange's scope; a reader sees values,
 *    formulas and the basics above, and nothing here pretends otherwise.
 *  · Cells beyond a generous cap (rows/columns far past what a hand-built sheet
 *    reaches) are skipped rather than materialised, so a pathological file
 *    cannot exhaust memory.
 */

import * as XLSX from "xlsx";
import {
  DEFAULT_COL_COUNT,
  DEFAULT_ROW_COUNT,
  getCellStyleId,
  getCellValue,
  type Workbook,
  type Worksheet,
} from "./model";
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from "./metrics";
import { parseCellRef } from "./coordinates";
import { isFormula } from "./values";
import {
  StyleRegistry,
  type CellStyle,
  type NumberFormat,
  type NumberFormatKind,
} from "./style";
import type { SerializedCell, SerializedSheet, SerializedWorkbook } from "./persistence";

/** Beyond these a cell is dropped on import — well past any real hand-built
    sheet, but a hard ceiling against a crafted file claiming millions of cells. */
const MAX_IMPORT_ROWS = 200_000;
const MAX_IMPORT_COLS = 4_096;

export type XlsxImportResult =
  | { ok: true; workbook: SerializedWorkbook }
  | { ok: false; error: string };

/* --- Export ---------------------------------------------------------------- */

/** Excel sheet names: ≤31 chars, none of `: \ / ? * [ ]`. */
function safeSheetName(name: string, index: number): string {
  const cleaned = (name || `Sheet${index + 1}`).replace(/[:\\/?*[\]]/g, " ").trim();
  return (cleaned || `Sheet${index + 1}`).slice(0, 31);
}

/** An Excel number-format code for one of our format kinds, or undefined for
    "automatic" (which Excel calls "General" and needs no code). */
function formatCode(nf: NumberFormat): string | undefined {
  const decimals = typeof nf.decimals === "number" ? nf.decimals : undefined;
  const dp = (d: number) => (d > 0 ? `.${"0".repeat(d)}` : "");
  switch (nf.kind) {
    case "number":
      return `#,##0${dp(decimals ?? 0)}`;
    case "currency":
      return `"${nf.currency ?? "$"}"#,##0${dp(decimals ?? 2)}`;
    case "percent":
      return `0${dp(decimals ?? 2)}%`;
    case "scientific":
      return `0${dp(decimals ?? 2)}E+00`;
    case "date":
      return "yyyy-mm-dd";
    case "time":
      return "hh:mm:ss";
    case "datetime":
      return "yyyy-mm-dd hh:mm:ss";
    default:
      return undefined;
  }
}

/** One stored raw cell string as a SheetJS cell. */
function cellFor(raw: string): XLSX.CellObject {
  if (isFormula(raw)) return { t: "n", f: raw.slice(1) };
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  if (upper === "TRUE" || upper === "FALSE") return { t: "b", v: upper === "TRUE" };
  if (trimmed !== "" && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(trimmed)) {
    return { t: "n", v: Number(trimmed) };
  }
  return { t: "s", v: raw };
}

function sheetToXlsx(ws: Worksheet, registry: StyleRegistry): XLSX.WorkSheet {
  const sheet: XLSX.WorkSheet = {};
  let maxRow = 0;
  let maxCol = 0;
  const refs = new Set<string>([...Object.keys(ws.cells), ...Object.keys(ws.cellStyles)]);
  for (const ref of refs) {
    const pos = parseCellRef(ref);
    if (!pos) continue;
    const raw = getCellValue(ws, pos.row, pos.col);
    const style = registry.get(getCellStyleId(ws, pos.row, pos.col));
    const hasFont = style.bold || style.italic || style.underline;
    if (raw === "" && !hasFont && !style.numberFormat) continue;

    const cell = cellFor(raw);
    const font: Record<string, boolean> = {};
    if (style.bold) font.bold = true;
    if (style.italic) font.italic = true;
    if (style.underline) font.underline = true;
    if (Object.keys(font).length) cell.s = { font };
    if (style.numberFormat) {
      const code = formatCode(style.numberFormat);
      if (code) cell.z = code;
    }
    sheet[ref] = cell;
    maxRow = Math.max(maxRow, pos.row);
    maxCol = Math.max(maxCol, pos.col);
  }
  sheet["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
  return sheet;
}

/** Every worksheet of `wb` as `.xlsx` bytes — see the module header for exactly
    what does and does not survive. */
export function workbookToXlsx(wb: Workbook, registry: StyleRegistry): ArrayBuffer {
  const book = XLSX.utils.book_new();
  const used = new Set<string>();
  wb.worksheets.forEach((ws, i) => {
    let name = safeSheetName(ws.name, i);
    let n = 1;
    const base = name;
    while (used.has(name)) name = `${base.slice(0, 27)} (${++n})`;
    used.add(name);
    XLSX.utils.book_append_sheet(book, sheetToXlsx(ws, registry), name);
  });
  return XLSX.write(book, { type: "array", bookType: "xlsx", cellStyles: true }) as ArrayBuffer;
}

/* --- Import ---------------------------------------------------------------- */

/** Map an Excel format code to the nearest of our format kinds, or null. `m` is
    ambiguous (month vs minute) so date/time is decided by the surrounding
    tokens: `y`/`d` mean a date, `h`/`s` mean a time. */
function kindFromCode(z: string | undefined): NumberFormatKind | null {
  if (!z || z === "General") return null;
  const s = z.toLowerCase();
  if (s.includes("%")) return "percent";
  if (/[$€£₹]/.test(z)) return "currency";
  if (/e[+-]/.test(s)) return "scientific";
  const hasDate = /[yd]/.test(s);
  const hasTime = /[hs]/.test(s);
  if (hasDate && hasTime) return "datetime";
  if (hasDate) return "date";
  if (hasTime) return "time";
  if (/[0#]/.test(s)) return "number";
  return null;
}

function cellStyleFrom(cell: XLSX.CellObject): CellStyle | null {
  const style: CellStyle = {};
  const kind = kindFromCode(typeof cell.z === "string" ? cell.z : undefined);
  if (kind) style.numberFormat = { kind };
  /* Read styles back too, for the day the library (or a Pro build) provides
     them; the Community Edition returns no `.s`, which simply yields nothing. */
  const font = (cell as { s?: { font?: { bold?: boolean; italic?: boolean; underline?: boolean } } }).s?.font;
  if (font?.bold) style.bold = true;
  if (font?.italic) style.italic = true;
  if (font?.underline) style.underline = true;
  return Object.keys(style).length ? style : null;
}

/** Parse `.xlsx` bytes into a loadable workbook, or a human-readable error.
    Never throws — a corrupt or non-spreadsheet file becomes an error to show. */
export function xlsxToWorkbook(bytes: ArrayBuffer | Uint8Array): XlsxImportResult {
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(bytes, { type: "array", cellFormula: true, cellNF: true, cellStyles: true });
  } catch {
    return { ok: false, error: "This file could not be read as a spreadsheet." };
  }
  if (!book.SheetNames || book.SheetNames.length === 0) {
    return { ok: false, error: "This spreadsheet has no sheets." };
  }

  try {
    const registry = new StyleRegistry();
    const usedNames = new Set<string>();
    const sheets: SerializedSheet[] = book.SheetNames.map((rawName, i) => {
      const ws = book.Sheets[rawName] ?? {};
      const cells: SerializedCell[] = [];
      let maxRow = 0;
      let maxCol = 0;
      for (const key of Object.keys(ws)) {
        if (key.startsWith("!")) continue;
        const pos = parseCellRef(key);
        if (!pos || pos.row >= MAX_IMPORT_ROWS || pos.col >= MAX_IMPORT_COLS) continue;
        const cell = ws[key] as XLSX.CellObject;
        let raw: string;
        if (typeof cell.f === "string" && cell.f) raw = `=${cell.f}`;
        else if (typeof cell.v === "boolean") raw = cell.v ? "TRUE" : "FALSE";
        else if (cell.v !== undefined && cell.v !== null && cell.v !== "") raw = String(cell.v);
        else continue;

        const serialized: SerializedCell = { ref: key, value: raw };
        const style = cellStyleFrom(cell);
        if (style) {
          const id = registry.intern(style);
          if (id !== 0) serialized.style = id;
        }
        cells.push(serialized);
        maxRow = Math.max(maxRow, pos.row);
        maxCol = Math.max(maxCol, pos.col);
      }

      let name = (rawName || `Sheet${i + 1}`).trim() || `Sheet${i + 1}`;
      let n = 1;
      const base = name;
      while (usedNames.has(name.toLowerCase())) name = `${base} (${++n})`;
      usedNames.add(name.toLowerCase());

      return {
        id: `sheet-${i + 1}`,
        name,
        rowCount: Math.min(MAX_IMPORT_ROWS, Math.max(DEFAULT_ROW_COUNT, maxRow + 1)),
        colCount: Math.min(MAX_IMPORT_COLS, Math.max(DEFAULT_COL_COUNT, maxCol + 1)),
        defaultRowHeight: DEFAULT_ROW_HEIGHT,
        defaultColWidth: DEFAULT_COL_WIDTH,
        frozenRows: 0,
        frozenCols: 0,
        rowHeights: {},
        colWidths: {},
        hiddenRows: [],
        hiddenCols: [],
        cells,
      };
    });

    const styles = JSON.parse(registry.serialize()) as CellStyle[];
    return {
      ok: true,
      workbook: { version: 1, activeSheetId: sheets[0].id, styles, sheets },
    };
  } catch {
    return { ok: false, error: "This spreadsheet's contents could not be read." };
  }
}
