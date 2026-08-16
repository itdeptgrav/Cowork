/**
 * Find and replace — locating text across a sheet, and rewriting it.
 *
 * Two things vary, and both are options a person sets: whether the match is
 * case-sensitive, and whether it looks at the DISPLAYED value of each cell (what
 * the grid shows, so a formula matches on its result) or at the raw content
 * (what was typed, so a formula matches on its text). The module takes a
 * `displayAt` accessor rather than the engine, so it stays pure and testable.
 *
 * Find returns the matching cells in reading order (row-major), which is what
 * "find next" and "find previous" step through. Replace only ever edits RAW
 * content — a computed result is not something you can write back — so when the
 * search is over displayed values, a formula cell can be FOUND but is left for
 * the reader to edit rather than silently rewritten.
 */

import { parseCellRef } from "./coordinates";
import type { Worksheet } from "./model";
import type { CellEdit } from "./history";

export interface SearchOptions {
  /** Match upper/lower case exactly. */
  matchCase: boolean;
  /** Search the raw cell content (formulas included) rather than displayed values. */
  inFormulas: boolean;
}

/** A cell a search matched. */
export interface CellMatch {
  row: number;
  col: number;
}

function isFormulaRaw(raw: string): boolean {
  return raw.startsWith("=");
}

/** Whether `haystack` contains `needle`, honouring case sensitivity. */
export function textContains(haystack: string, needle: string, matchCase: boolean): boolean {
  if (needle === "") return false;
  if (matchCase) return haystack.includes(needle);
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** The text a cell is searched by, under the current option. */
function cellText(
  ws: Worksheet,
  row: number,
  col: number,
  raw: string,
  opts: SearchOptions,
  displayAt: (row: number, col: number) => string,
): string {
  return opts.inFormulas ? raw : displayAt(row, col);
}

/**
 * Every cell whose search-text contains the query, in reading order. Only
 * populated cells can match — an empty cell has no text under either option — so
 * this walks the sparse store, never the whole grid.
 */
export function findMatches(
  ws: Worksheet,
  query: string,
  opts: SearchOptions,
  displayAt: (row: number, col: number) => string,
): CellMatch[] {
  if (query === "") return [];
  const matches: CellMatch[] = [];
  for (const ref of Object.keys(ws.cells)) {
    const pos = parseCellRef(ref);
    if (!pos) continue;
    const raw = ws.cells[ref].value;
    const text = cellText(ws, pos.row, pos.col, raw, opts, displayAt);
    if (textContains(text, query, opts.matchCase)) matches.push(pos);
  }
  matches.sort((a, b) => (a.row - b.row) || (a.col - b.col));
  return matches;
}

/** The index of the next match after `from` (wrapping), or -1 when there are
    none. `forward` false steps to the previous match. */
export function stepMatch(count: number, from: number, forward: boolean): number {
  if (count === 0) return -1;
  if (from < 0) return forward ? 0 : count - 1;
  return forward ? (from + 1) % count : (from - 1 + count) % count;
}

/** Replace every occurrence of `query` in `text`, honouring case sensitivity. */
export function replaceInText(
  text: string,
  query: string,
  replacement: string,
  matchCase: boolean,
): string {
  if (query === "") return text;
  if (matchCase) return text.split(query).join(replacement);
  /* Case-insensitive: scan and splice, so the ORIGINAL casing of the surrounding
     text is preserved and only the matched runs are swapped. */
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (lowerText.startsWith(lowerQuery, i)) {
      out += replacement;
      i += query.length;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

/**
 * Whether a cell is a candidate for replacement, and what its new raw value
 * would be — or null when it does not match or cannot be rewritten.
 *
 * Replacement always edits raw content. When searching displayed values, a
 * FORMULA cell is skipped (its result is not writable); a literal cell's
 * displayed value is its raw value, so replacing there is well defined.
 */
export function replaceCellRaw(
  raw: string,
  display: string,
  query: string,
  replacement: string,
  opts: SearchOptions,
): string | null {
  if (opts.inFormulas) {
    if (!textContains(raw, query, opts.matchCase)) return null;
    const next = replaceInText(raw, query, replacement, opts.matchCase);
    return next === raw ? null : next;
  }
  /* Displayed-value search: only literal cells can be rewritten. */
  if (isFormulaRaw(raw)) return null;
  if (!textContains(display, query, opts.matchCase)) return null;
  const next = replaceInText(raw, query, replacement, opts.matchCase);
  return next === raw ? null : next;
}

/**
 * The edits a "replace all" performs across the sheet — one per cell whose raw
 * value changes. Empty when nothing matches, so the caller records no command.
 */
export function replaceAllEdits(
  ws: Worksheet,
  query: string,
  replacement: string,
  opts: SearchOptions,
  displayAt: (row: number, col: number) => string,
): CellEdit[] {
  if (query === "") return [];
  const edits: CellEdit[] = [];
  for (const ref of Object.keys(ws.cells)) {
    const pos = parseCellRef(ref);
    if (!pos) continue;
    const raw = ws.cells[ref].value;
    const next = replaceCellRaw(raw, displayAt(pos.row, pos.col), query, replacement, opts);
    if (next !== null) edits.push({ row: pos.row, col: pos.col, raw: next });
  }
  return edits;
}
