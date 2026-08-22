/**
 * CSV import/export for one sheet tab — RFC 4180, hand-rolled.
 *
 * No dependency: a CSV reader/writer is a small, well-specified state machine,
 * and pulling in a package for it would be a heavier and less inspectable
 * choice than the ~60 lines below. The two hard parts of RFC 4180, both
 * handled properly rather than approximated:
 *
 *  · **Writing** — a field is quoted only when it needs to be (contains a
 *    comma, a quote, or a newline); an embedded quote is doubled. `split(",")`
 *    would be enough for a naive writer, but never for a reader.
 *  · **Reading** — a real state-machine parser, not `split(",")`/`split("\n")`.
 *    A quoted field may itself contain literal commas and literal newlines,
 *    which is exactly the case a two-line split cannot represent.
 *
 * `writeCsv` reads the sheet's USED RANGE — the bounding box of its non-empty
 * cells — the same address functions (`parseRef`/`cellRef`) `grid.ts` uses
 * everywhere else, rather than a second column/row convention invented here.
 * An empty sheet exports to an empty string rather than `sheet.rows` ×
 * `sheet.cols` of blank commas.
 */

import { cellRef, parseRef, type SheetData } from "./grid.ts";

interface UsedRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** The bounding box of the sheet's non-empty cells, or null when it has none. */
function usedRange(sheet: SheetData): UsedRange | null {
  let top = Infinity;
  let left = Infinity;
  let bottom = -1;
  let right = -1;
  for (const [ref, value] of Object.entries(sheet.cells)) {
    if (value === "") continue;
    const pos = parseRef(ref);
    if (!pos) continue;
    if (pos.row < top) top = pos.row;
    if (pos.col < left) left = pos.col;
    if (pos.row > bottom) bottom = pos.row;
    if (pos.col > right) right = pos.col;
  }
  return bottom < 0 ? null : { top, left, bottom, right };
}

/** One field, quoted per RFC 4180 only when it needs to be. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * The sheet's used range as CSV text — CRLF line endings, per RFC 4180.
 * An empty sheet (no non-empty cells) writes to `""`.
 */
export function writeCsv(sheet: SheetData): string {
  const range = usedRange(sheet);
  if (!range) return "";
  const lines: string[] = [];
  for (let row = range.top; row <= range.bottom; row++) {
    const fields: string[] = [];
    for (let col = range.left; col <= range.right; col++) {
      fields.push(csvField(sheet.cells[cellRef(row, col)] ?? ""));
    }
    lines.push(fields.join(","));
  }
  return lines.join("\r\n");
}

/**
 * CSV text as a grid of raw fields — a real RFC 4180 parser.
 *
 * A small state machine rather than a split: inside a quoted field, commas
 * and newlines (`\r`, `\n`, `\r\n`) are literal characters, not delimiters,
 * and `""` is an escaped quote. `\r\n`, `\r` and bare `\n` are all accepted as
 * a row break outside quotes, since a file saved on any platform should open
 * the same way here.
 */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  /* Whether the current field has been STARTED — set the moment a quote opens,
     so a field whose whole content is `""` (a quoted empty string) is
     distinguishable from no field at all. Plain characters make `field`
     non-empty, which already marks the field as real; only a quoted empty
     leaves no other trace. */
  let fieldStarted = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      fieldStarted = true;
      i++;
    } else if (ch === ",") {
      endField();
      i++;
    } else if (ch === "\r") {
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
    } else if (ch === "\n") {
      endRow();
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  /* A trailing field/row not yet closed by a line break — the common case of
     a file with no final newline. RFC 4180 makes `""` a one-field record, so
     `fieldStarted` matters here: after consuming a quoted empty field both
     `field` and `row` are empty, exactly as they are after a row break, and
     only the flag tells the two apart. Nothing to flush when the text ended
     exactly on a row break. */
  if (fieldStarted || field !== "" || row.length > 0) endRow();

  return rows;
}
