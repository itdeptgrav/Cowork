/**
 * Workbook serialization — the on-the-wire, on-disk shape of a workbook.
 *
 * This is the boundary between the live engine and any store. It is PURE — no
 * React, no server, no database — so the browser serializes to send and the
 * server deserializes to persist, both from the same code, and neither depends
 * on the other's runtime.
 *
 * The shape is deliberately SPARSE and SEPARABLE, so it maps onto a document
 * database without ever building "one enormous document":
 *
 *  · workbook metadata (id, title, owner, revision) — the record wrapper, not
 *    here; this module owns the CONTENT.
 *  · per-sheet metadata (name, dimensions, freeze, hidden lines, resizes);
 *  · sparse cells — only the cells someone actually filled or formatted, each a
 *    `{ ref, value, style }` triple, never a dense grid;
 *  · a shared style table — the flyweight registry, so ten thousand bold cells
 *    reference one style, not ten thousand copies.
 *
 * A store backed by MongoDB would split `sheets` and each sheet's `cells` into
 * their own documents (cells chunked by row band to stay under the 16 MB limit);
 * the file-backed adapter writes the whole thing as one JSON. Either way the
 * shape is the same, which is the point of putting it here.
 */

import { createWorksheet, type Workbook, type Worksheet } from "./model";
import { StyleRegistry, type CellStyle } from "./style";
import type { Rect } from "./coordinates";
import type { SheetFilter } from "./filter";
import type { Validation } from "./validation";
import type { ConditionalFormat } from "./conditional";
import type { CommentMap } from "./comments";
import type { RowGroup } from "./datatools";

/** One populated cell: its A1 ref, its raw value, and its style id (into the
    shared style table). `value` is omitted for a styled-but-empty cell; `style`
    is omitted for an unstyled one. */
export interface SerializedCell {
  ref: string;
  value?: string;
  style?: number;
}

export interface SerializedSheet {
  id: string;
  name: string;
  hidden?: boolean;
  rowCount: number;
  colCount: number;
  defaultRowHeight: number;
  defaultColWidth: number;
  frozenRows: number;
  frozenCols: number;
  /** Sparse size overrides, keyed by index. */
  rowHeights: Record<number, number>;
  colWidths: Record<number, number>;
  /** Hidden line indices. */
  hiddenRows: number[];
  hiddenCols: number[];
  /** Only the filled or formatted cells. */
  cells: SerializedCell[];
  /** Advanced features — present only when configured (Phase 10). */
  filter?: SheetFilter;
  validations?: Validation[];
  conditionalFormats?: ConditionalFormat[];
  /** Advanced UI features — present only when configured (Phase 11). */
  merges?: Rect[];
  links?: Record<string, string>;
  comments?: CommentMap;
  rowGroups?: RowGroup[];
}

/** The serializable CONTENT of a workbook (its metadata wrapper lives in the
    store record). */
export interface SerializedWorkbook {
  version: 1;
  activeSheetId: string;
  /** The shared style table — index is the style id cells reference. */
  styles: CellStyle[];
  sheets: SerializedSheet[];
}

function indicesOf(map: Record<number, unknown>): number[] {
  return Object.keys(map)
    .map(Number)
    .sort((a, b) => a - b);
}

function serializeSheet(ws: Worksheet): SerializedSheet {
  /* The union of filled and formatted cells — a cell may carry a style with no
     value (a coloured empty cell), so neither map alone is complete. */
  const refs = new Set<string>([...Object.keys(ws.cells), ...Object.keys(ws.cellStyles)]);
  const cells: SerializedCell[] = [];
  for (const ref of refs) {
    const value = ws.cells[ref]?.value ?? "";
    const style = ws.cellStyles[ref] ?? 0;
    const cell: SerializedCell = { ref };
    if (value !== "") cell.value = value;
    if (style !== 0) cell.style = style;
    cells.push(cell);
  }
  cells.sort((a, b) => a.ref.localeCompare(b.ref));

  return {
    id: ws.id,
    name: ws.name,
    ...(ws.hidden ? { hidden: true } : {}),
    rowCount: ws.rowCount,
    colCount: ws.colCount,
    defaultRowHeight: ws.defaultRowHeight,
    defaultColWidth: ws.defaultColWidth,
    frozenRows: ws.frozenRows,
    frozenCols: ws.frozenCols,
    rowHeights: { ...ws.rowHeights },
    colWidths: { ...ws.colWidths },
    hiddenRows: indicesOf(ws.hiddenRows),
    hiddenCols: indicesOf(ws.hiddenCols),
    cells,
    ...(ws.filter ? { filter: ws.filter } : {}),
    ...(ws.validations && ws.validations.length ? { validations: ws.validations } : {}),
    ...(ws.conditionalFormats && ws.conditionalFormats.length
      ? { conditionalFormats: ws.conditionalFormats }
      : {}),
    ...(ws.merges && ws.merges.length ? { merges: ws.merges } : {}),
    ...(ws.links && Object.keys(ws.links).length ? { links: ws.links } : {}),
    ...(ws.comments && Object.keys(ws.comments).length ? { comments: ws.comments } : {}),
    ...(ws.rowGroups && ws.rowGroups.length ? { rowGroups: ws.rowGroups } : {}),
  };
}

/** Serialize a live workbook and its style registry to the persistable shape. */
export function serializeWorkbook(wb: Workbook, styles: StyleRegistry): SerializedWorkbook {
  return {
    version: 1,
    activeSheetId: wb.activeSheetId,
    styles: JSON.parse(styles.serialize()) as CellStyle[],
    sheets: wb.worksheets.map(serializeSheet),
  };
}

function deserializeSheet(s: SerializedSheet): Worksheet {
  const ws = createWorksheet(s.id, s.name, s.rowCount, s.colCount);
  const cells: Worksheet["cells"] = {};
  const cellStyles: Worksheet["cellStyles"] = {};
  for (const cell of s.cells) {
    if (cell.value !== undefined && cell.value !== "") cells[cell.ref] = { value: cell.value };
    if (cell.style) cellStyles[cell.ref] = cell.style;
  }
  const hiddenRows: Record<number, true> = {};
  for (const r of s.hiddenRows ?? []) hiddenRows[r] = true;
  const hiddenCols: Record<number, true> = {};
  for (const c of s.hiddenCols ?? []) hiddenCols[c] = true;

  return {
    ...ws,
    hidden: s.hidden || undefined,
    cells,
    cellStyles,
    rowHeights: { ...s.rowHeights },
    colWidths: { ...s.colWidths },
    hiddenRows,
    hiddenCols,
    frozenRows: s.frozenRows ?? 0,
    frozenCols: s.frozenCols ?? 0,
    defaultRowHeight: s.defaultRowHeight,
    defaultColWidth: s.defaultColWidth,
    ...(s.filter ? { filter: s.filter } : {}),
    ...(s.validations ? { validations: s.validations } : {}),
    ...(s.conditionalFormats ? { conditionalFormats: s.conditionalFormats } : {}),
    ...(s.merges ? { merges: s.merges } : {}),
    ...(s.links ? { links: s.links } : {}),
    ...(s.comments ? { comments: s.comments } : {}),
    ...(s.rowGroups ? { rowGroups: s.rowGroups } : {}),
  };
}

/**
 * Rebuild a live workbook and its style registry from the persisted shape. The
 * registry is restored id-for-id, so every cell's style reference stays valid.
 */
export function deserializeWorkbook(data: SerializedWorkbook): {
  workbook: Workbook;
  styleRegistry: StyleRegistry;
} {
  const styleRegistry = StyleRegistry.deserialize(JSON.stringify(data.styles ?? []));
  const worksheets = data.sheets.map(deserializeSheet);
  const activeSheetId =
    worksheets.find((s) => s.id === data.activeSheetId)?.id ?? worksheets[0]?.id ?? "";
  return { workbook: { worksheets, activeSheetId }, styleRegistry };
}
