/**
 * JSON workbook import and export — the whole workbook as one JSON document.
 *
 * Export is the persisted shape (`SerializedWorkbook`) pretty-printed: a
 * complete, self-contained workbook — every sheet, the shared style table, and
 * the advanced features — that `deserializeWorkbook` reads straight back.
 *
 * Import is the guarded inverse. A file from disk is UNTRUSTED: it may not be
 * JSON, may be JSON of the wrong shape, or may be missing the fields the
 * deserializer walks. So `importWorkbookJson` never throws and never hands the
 * deserializer something that would — it normalises what it can (coercing types,
 * filling defaults) and rejects, with a message, only what is fundamentally not
 * a workbook. A malformed file becomes an error to show, not a crash.
 */

import {
  DEFAULT_COL_COUNT,
  DEFAULT_ROW_COUNT,
  MAX_IMPORT_COLS,
  MAX_IMPORT_ROWS,
} from "./model";
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from "./metrics";
import type { SerializedCell, SerializedSheet, SerializedWorkbook } from "./persistence";

/** Export a workbook to a pretty-printed JSON string. */
export function exportWorkbookJson(data: SerializedWorkbook): string {
  return JSON.stringify(data, null, 2);
}

export type JsonImportResult =
  | { ok: true; workbook: SerializedWorkbook }
  | { ok: false; error: string };

/* --- Small, total coercions ------------------------------------------------ */

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function str(x: unknown, fallback: string): string {
  return typeof x === "string" ? x : fallback;
}
function num(x: unknown, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}
/** A sheet dimension as a usable count: at least 1, capped at the same ceiling
    the xlsx importer enforces — a claimed 0×-5 grid or a claimed billion-row
    one both come out loadable. */
function dimension(x: unknown, fallback: number, max: number): number {
  return Math.min(max, Math.max(1, Math.floor(num(x, fallback))));
}
function numberRecord(x: unknown): Record<number, number> {
  if (!isObject(x)) return {};
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(x)) {
    const key = Number(k);
    if (Number.isInteger(key) && typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}
function numberArray(x: unknown): number[] {
  return Array.isArray(x) ? x.filter((n): n is number => typeof n === "number") : [];
}

function normalizeCells(x: unknown): SerializedCell[] {
  if (!Array.isArray(x)) return [];
  const out: SerializedCell[] = [];
  for (const c of x) {
    if (!isObject(c) || typeof c.ref !== "string") continue;
    const cell: SerializedCell = { ref: c.ref };
    if (typeof c.value === "string" && c.value !== "") cell.value = c.value;
    if (typeof c.style === "number" && Number.isInteger(c.style) && c.style !== 0) cell.style = c.style;
    out.push(cell);
  }
  return out;
}

/** Pass an advanced-feature block through only when it is at least the right
    container kind, so a malformed block is dropped rather than crashing render.
    Deep validation of every rule belongs to those features' own guards. */
function passthroughArray<T>(x: unknown): T[] | undefined {
  return Array.isArray(x) && x.length ? (x as T[]) : undefined;
}
function passthroughObject<T>(x: unknown): T | undefined {
  return isObject(x) && Object.keys(x).length ? (x as T) : undefined;
}

function normalizeSheet(x: unknown, index: number): SerializedSheet {
  const s = isObject(x) ? x : {};
  const sheet: SerializedSheet = {
    id: str(s.id, `sheet-${index + 1}`),
    name: str(s.name, `Sheet${index + 1}`),
    rowCount: dimension(s.rowCount, DEFAULT_ROW_COUNT, MAX_IMPORT_ROWS),
    colCount: dimension(s.colCount, DEFAULT_COL_COUNT, MAX_IMPORT_COLS),
    defaultRowHeight: num(s.defaultRowHeight, DEFAULT_ROW_HEIGHT),
    defaultColWidth: num(s.defaultColWidth, DEFAULT_COL_WIDTH),
    frozenRows: num(s.frozenRows, 0),
    frozenCols: num(s.frozenCols, 0),
    rowHeights: numberRecord(s.rowHeights),
    colWidths: numberRecord(s.colWidths),
    hiddenRows: numberArray(s.hiddenRows),
    hiddenCols: numberArray(s.hiddenCols),
    cells: normalizeCells(s.cells),
  };
  if (s.hidden === true) sheet.hidden = true;
  const filter = passthroughObject<NonNullable<SerializedSheet["filter"]>>(s.filter);
  if (filter) sheet.filter = filter;
  const validations = passthroughArray<NonNullable<SerializedSheet["validations"]>[number]>(s.validations);
  if (validations) sheet.validations = validations;
  const conditionalFormats = passthroughArray<
    NonNullable<SerializedSheet["conditionalFormats"]>[number]
  >(s.conditionalFormats);
  if (conditionalFormats) sheet.conditionalFormats = conditionalFormats;
  const merges = passthroughArray<NonNullable<SerializedSheet["merges"]>[number]>(s.merges);
  if (merges) sheet.merges = merges;
  const links = passthroughObject<NonNullable<SerializedSheet["links"]>>(s.links);
  if (links) sheet.links = links;
  const comments = passthroughObject<NonNullable<SerializedSheet["comments"]>>(s.comments);
  if (comments) sheet.comments = comments;
  const rowGroups = passthroughArray<NonNullable<SerializedSheet["rowGroups"]>[number]>(
    s.rowGroups,
  );
  if (rowGroups) sheet.rowGroups = rowGroups;
  return sheet;
}

/**
 * Parse and validate a JSON workbook file. Returns the normalised, safe-to-load
 * workbook, or a human-readable error. Never throws.
 */
export function importWorkbookJson(text: string): JsonImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }
  if (!isObject(parsed)) {
    return { ok: false, error: "This file is not a workbook." };
  }
  if (!Array.isArray(parsed.sheets) || parsed.sheets.length === 0) {
    return { ok: false, error: "This workbook has no sheets." };
  }

  const sheets = parsed.sheets.map((s, i) => normalizeSheet(s, i));
  /* The style table is id-indexed, so a corrupt ENTRY is replaced by the empty
     style in place rather than filtered out — dropping it would renumber every
     later id and mis-style unrelated cells. Only plain objects pass through;
     null/number/string/array entries (which would throw inside the style
     deserializer) degrade to {}. */
  const styles = Array.isArray(parsed.styles)
    ? parsed.styles.map((s) => (isObject(s) ? s : {}))
    : [];
  const activeSheetId =
    typeof parsed.activeSheetId === "string" &&
    sheets.some((s) => s.id === parsed.activeSheetId)
      ? parsed.activeSheetId
      : sheets[0].id;

  return {
    ok: true,
    workbook: { version: 1, activeSheetId, styles, sheets },
  };
}
