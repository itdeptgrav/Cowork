/**
 * XLSX import/export for a whole workbook, via SheetJS (`xlsx`, Apache-2.0).
 *
 * The counterpart to `csv.ts`: CSV is one tab's used range as text, hand-rolled
 * because RFC 4180 is small enough to own outright; the XLSX container format
 * is not — a real ZIP of XML parts — so this leans on SheetJS rather than
 * reimplementing it.
 *
 * ## What round-trips, and what is stated once here rather than per-function
 *
 *  · **Values and formulas** round-trip. A formula is written to the cell's
 *    `.f` field as a formula (SheetJS's own convention: no leading `=`), not
 *    evaluated first — so it re-computes wherever the file is opened next,
 *    the same "raw, never derived" rule `grid.ts`'s own header documents for
 *    the sheet's own storage.
 *  · **Number formats** round-trip through `.z`.
 *  · **Charts and conditional-formatting rules are NOT written.** Both are
 *    Cowork-specific concepts (`ChartSpec`, `ConditionalRule`) with no XLSX
 *    equivalent this module builds — a reader opening the exported file sees
 *    values and formulas, not the chart or the highlight rules that were on
 *    screen. Silently dropping them without saying so anywhere would be worse
 *    than the limitation itself; this comment is that "saying so".
 *  · **Bold/italic are written but do not survive being read back by this
 *    same library.** `cell.s` is set on export, and a real copy of Excel
 *    opening the file shows it — but the `xlsx` package published to the npm
 *    registry (the Community Edition, which is what this dependency actually
 *    is; see `package.json`) does not parse cell styles back out on `read`,
 *    confirmed against this exact version rather than assumed from its
 *    changelog. So `workbookToXlsx` then `xlsxToWorkbook` on the same file
 *    loses bold/italic even though the file itself is not missing anything.
 */

import * as XLSX from "xlsx";
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  isFormula,
  MAX_COLS,
  MAX_ROWS,
  parseRef,
  readWorkbook,
  type CellMap,
  type NumberFormat,
  type StyleMap,
  type Workbook,
} from "./grid.ts";

/** Our four named formats as Excel format-code strings, for `cell.z`. */
const NUMBER_FORMAT_CODE: Record<NumberFormat, string> = {
  currency: '"₹"#,##0.00',
  percent: "0.00%",
  comma: "#,##0.00",
  plain: "General",
};

/**
 * The inverse, by what the format is FOR rather than an exact string match —
 * a workbook built outside Cowork will almost never carry one of the four
 * exact codes above, so this buckets a foreign format string into the
 * closest of our four kinds (or none, for "General"/anything unrecognised).
 */
function formatFromCode(z: string | undefined): NumberFormat | undefined {
  if (!z || z === "General") return undefined;
  if (z.includes("%")) return "percent";
  if (/[$₹€£]/.test(z)) return "currency";
  if (z.includes(",")) return "comma";
  return undefined;
}

/** Excel sheet names: at most 31 characters, none of `: \ / ? * [ ]`. */
function safeSheetName(name: string, index: number): string {
  const cleaned = (name || `Sheet${index + 1}`).replace(/[:\\/?*[\]]/g, " ").trim();
  return (cleaned || `Sheet${index + 1}`).slice(0, 31);
}

/** One stored raw cell string as a SheetJS cell — a formula, a number, or text. */
function cellFor(raw: string): XLSX.CellObject {
  if (isFormula(raw)) return { t: "n", f: raw.slice(1) };
  if (raw !== "" && /^-?\d+(\.\d+)?$/.test(raw.trim())) return { t: "n", v: Number(raw) };
  return { t: "s", v: raw };
}

/** Every tab of `wb` as a SheetJS workbook's bytes — see the module header for what does and does not round-trip. */
export function workbookToXlsx(wb: Workbook): ArrayBuffer {
  const book = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  const tabs = wb.sheets.length > 0 ? wb.sheets : [{ id: "sheet-1", name: "Sheet1", cells: {}, styles: {}, rows: DEFAULT_ROWS, cols: DEFAULT_COLS }];

  tabs.forEach((tab, i) => {
    const ws: XLSX.WorkSheet = {};
    let maxRow = 0;
    let maxCol = 0;
    for (const [ref, raw] of Object.entries(tab.cells)) {
      const pos = parseRef(ref);
      if (!pos || raw === "") continue;
      maxRow = Math.max(maxRow, pos.row);
      maxCol = Math.max(maxCol, pos.col);
      const cell = cellFor(raw);
      const style = tab.styles[ref];
      if (style) {
        const font: Record<string, boolean> = {};
        if (style.bold) font.bold = true;
        if (style.italic) font.italic = true;
        if (Object.keys(font).length) cell.s = { font };
        if (style.format) cell.z = NUMBER_FORMAT_CODE[style.format];
      }
      ws[ref] = cell;
    }
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });

    let name = safeSheetName(tab.name, i);
    let n = 1;
    const base = name;
    while (usedNames.has(name)) name = `${base.slice(0, 28)} (${++n})`;
    usedNames.add(name);
    XLSX.utils.book_append_sheet(book, ws, name);
  });

  return XLSX.write(book, { type: "array", bookType: "xlsx", cellStyles: true }) as ArrayBuffer;
}

/**
 * The inverse — parsed XLSX bytes as a `Workbook`, run through `readWorkbook`
 * (via its JSON-string entry point) so imported data lands through the exact
 * same tab-normalisation, id-uniqueness and rows/cols clamping every other
 * stored workbook goes through, rather than a second shape invented here.
 */
export function xlsxToWorkbook(bytes: ArrayBuffer | Uint8Array): Workbook {
  const book = XLSX.read(bytes, {
    type: "array",
    cellFormula: true,
    cellNF: true,
    cellStyles: true,
  });

  const sheets = book.SheetNames.map((name, i) => {
    const ws = book.Sheets[name] ?? {};
    const cells: CellMap = {};
    const styles: StyleMap = {};
    let maxRow = 0;
    let maxCol = 0;

    for (const key of Object.keys(ws)) {
      if (key.startsWith("!")) continue;
      const pos = parseRef(key);
      /* Cells outside what this app can address are skipped rather than
         clamped in place — a foreign workbook using Excel's full 16,384
         columns should not silently relabel column ZZ as our column AZ. */
      if (!pos || pos.row >= MAX_ROWS || pos.col >= MAX_COLS) continue;
      const cell = ws[key] as XLSX.CellObject;
      if (typeof cell.f === "string" && cell.f) cells[key] = `=${cell.f}`;
      else if (cell.v !== undefined && cell.v !== null && cell.v !== "") cells[key] = String(cell.v);
      else continue;
      maxRow = Math.max(maxRow, pos.row);
      maxCol = Math.max(maxCol, pos.col);
      /* `cell.z` is SheetJS's own `NumberFormat` type — `string | number`,
         the latter for a built-in format's numeric id rather than its code
         string. Only the string form maps to one of our four named formats. */
      const format = formatFromCode(typeof cell.z === "string" ? cell.z : undefined);
      if (format) styles[key] = { format };
    }

    return {
      id: `sheet-${i + 1}`,
      name: name || `Sheet ${i + 1}`,
      cells,
      styles,
      rows: Math.min(MAX_ROWS, Math.max(DEFAULT_ROWS, maxRow + 1)),
      cols: Math.min(MAX_COLS, Math.max(DEFAULT_COLS, maxCol + 1)),
    };
  });

  return readWorkbook(JSON.stringify({ sheets }));
}
