/**
 * CSV import and export — one sheet as comma-separated text.
 *
 * RFC 4180 is small enough to own outright rather than pull a parser for: a
 * field may be quoted; a quoted field may contain commas, line breaks and
 * doubled quotes (`""` → `"`); rows end at a bare newline. This module is the
 * pure half — text ↔ a grid of raw strings, and a grid ↔ a worksheet — with no
 * React and no engine, so it is fully testable on strings alone.
 *
 * Numbers are preserved by carrying the field's TEXT through unchanged: a cell
 * "1000" stays "1000", which the engine reads as the number 1000, and export
 * writes each cell's plain displayed value (a `valueAt` the caller supplies),
 * never a thousands-separated or currency-formatted form that would not read
 * back as a number. A field beginning with `=` imports as a formula, the same
 * as typing it — CSV carries no formulas of its own, so this is the only
 * sensible reading and is called out here rather than silently assumed.
 *
 * UTF-8 is the browser's `File.text()` default; a leading byte-order mark is
 * stripped on parse so a BOM-prefixed export from another tool imports cleanly.
 */

import { parseCellRef, type CellPos } from "./coordinates";
import {
  applyCellWrites,
  createWorksheet,
  DEFAULT_ROW_COUNT,
  DEFAULT_COL_COUNT,
  type CellWrite,
  type Worksheet,
} from "./model";

/**
 * Parse CSV text into a rectangular-ish grid of raw field strings (rows may be
 * ragged; the caller decides how to place them). Never throws — malformed input
 * is read as best it can be, so a bad file cannot crash an import.
 */
export function parseCsv(input: string): string[][] {
  /* Strip a UTF-8 BOM so a field never begins with the zero-width mark. */
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  /* Whether the current row has any content yet — so a trailing newline does
     not manufacture a spurious empty final row. */
  let rowStarted = false;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    rowStarted = false;
  };

  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      rowStarted = true;
    } else if (ch === ",") {
      endField();
      rowStarted = true;
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      endRow();
      if (text[i + 1] === "\n") i++; // treat CRLF as one terminator
    } else {
      field += ch;
      rowStarted = true;
    }
  }
  /* Flush the last field/row unless the text ended exactly on a terminator. */
  if (rowStarted || field !== "" || row.length > 0) endRow();
  return rows;
}

/** One field, quoted only when it must be (contains a comma, quote or newline);
    embedded quotes are doubled — the exact inverse of the parser. */
function encodeField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Serialize a grid of field strings as RFC 4180 CSV (CRLF row endings). */
export function serializeCsv(rows: string[][]): string {
  return rows.map((r) => r.map(encodeField).join(",")).join("\r\n");
}

/** The largest row/column any populated cell reaches — the sheet's used range. */
function usedExtent(ws: Worksheet): { rows: number; cols: number } {
  let maxRow = -1;
  let maxCol = -1;
  for (const ref of Object.keys(ws.cells)) {
    const pos = parseCellRef(ref);
    if (!pos) continue;
    if (pos.row > maxRow) maxRow = pos.row;
    if (pos.col > maxCol) maxCol = pos.col;
  }
  return { rows: maxRow + 1, cols: maxCol + 1 };
}

/**
 * A worksheet's used range as CSV, using `valueAt` for each cell's exported
 * text — the caller passes the DISPLAYED value (computed, plain-number), so a
 * formula exports its result and a number exports without formatting. An empty
 * sheet exports the empty string.
 */
export function worksheetToCsv(
  ws: Worksheet,
  valueAt: (row: number, col: number) => string,
): string {
  const { rows, cols } = usedExtent(ws);
  if (rows === 0 || cols === 0) return "";
  const grid: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const line: string[] = [];
    for (let c = 0; c < cols; c++) line.push(valueAt(r, c));
    grid.push(line);
  }
  return serializeCsv(grid);
}

/**
 * A CSV string as a new worksheet with the given id and name. Fields land as
 * RAW values (a leading `=` therefore becomes a formula); the sheet is sized to
 * hold the data, never smaller than a default sheet.
 */
export function csvToWorksheet(id: string, name: string, text: string): Worksheet {
  const grid = parseCsv(text);
  const height = grid.length;
  const width = grid.reduce((w, r) => Math.max(w, r.length), 0);
  const ws = createWorksheet(
    id,
    name,
    Math.max(DEFAULT_ROW_COUNT, height),
    Math.max(DEFAULT_COL_COUNT, width),
  );
  /* One batched write — a per-cell `setCellValue` would copy the whole map for
     every field, making a large CSV import quadratic. */
  const writes: CellWrite[] = [];
  for (let r = 0; r < height; r++) {
    const line = grid[r];
    for (let c = 0; c < line.length; c++) {
      if (line[c] !== "") writes.push({ row: r, col: c, value: line[c] });
    }
  }
  return applyCellWrites(ws, writes);
}

/** The positions a CSV grid would fill — for tests and callers that want the
    parsed shape without building a worksheet. */
export function csvPositions(text: string): CellPos[] {
  const grid = parseCsv(text);
  const out: CellPos[] = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== "") out.push({ row: r, col: c });
    }
  }
  return out;
}
