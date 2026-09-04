/**
 * Live collaboration for workbooks — the CRDT half, without React.
 *
 * ## The shape of the shared document
 *
 * Four Yjs maps, all flat and all holding STRINGS, because a string merges
 * trivially and survives any client version:
 *
 *  - `cells`   — `<sheetId>␁<A1 ref>` → the raw cell text (a formula, a number
 *                as typed, a word). Deleted when the cell is cleared.
 *  - `styles`  — the same key → the cell's style as its canonical JSON. The
 *                style REGISTRY is per client (ids differ), so what travels is
 *                the style itself; a receiver interns it into its own registry.
 *  - `sheets`  — `<sheetId>` → JSON of everything about a sheet that is not
 *                a cell: name, size, hidden lines, freeze, filter, validation,
 *                conditional formats, merges, links, comments, groups, charts,
 *                protection, page setup. Last writer wins for the whole sheet,
 *                which is right for what are settings rather than content.
 *  - `workbook` — `order` (JSON list of sheet ids), `names`, `pivots`.
 *
 * ## How it stays in step
 *
 * The local workbook is immutable and every change yields a new object, so
 * a change is found by comparing the previous and next workbook: only sheets
 * whose maps changed identity are walked, and only differing keys are
 * written — one keystroke is one `cells.set`. Remote transactions arrive as
 * Yjs events naming the changed keys, which are applied the same way in
 * reverse. Both directions are one transaction, tagged with an origin so a
 * client never re-applies its own writes.
 *
 * Nothing here touches the formula engine or React; `useWorkbookCollab`
 * wires the two.
 */

import * as Y from "yjs";
import { cellRef, parseCellRef } from "./coordinates";
import type { Cell, Workbook, Worksheet } from "./model";
import { createWorksheet } from "./model";
import { deserializeStyle, serializeStyle, type CellStyle, type StyleRegistry } from "./style";
import { readNames } from "./names";
import { readPivots } from "./pivot";
import { readCharts } from "./charts";
import { readProtection } from "./protection";
import { readBands } from "./banding";
import { readPageSetup } from "./printHtml";

export const SEP = "";
export const LOCAL_ORIGIN = "local-workbook";

export interface WorkbookMaps {
  cells: Y.Map<string>;
  styles: Y.Map<string>;
  sheets: Y.Map<string>;
  workbook: Y.Map<string>;
}

export function mapsOf(doc: Y.Doc): WorkbookMaps {
  return {
    cells: doc.getMap<string>("cells"),
    styles: doc.getMap<string>("styles"),
    sheets: doc.getMap<string>("sheets"),
    workbook: doc.getMap<string>("workbook"),
  };
}

export function docIsEmpty(maps: WorkbookMaps): boolean {
  return maps.sheets.size === 0 && maps.cells.size === 0 && maps.workbook.size === 0;
}

export function keyOf(sheetId: string, ref: string): string {
  return `${sheetId}${SEP}${ref}`;
}

export function splitKey(key: string): { sheetId: string; ref: string } | null {
  const at = key.indexOf(SEP);
  if (at === -1) return null;
  return { sheetId: key.slice(0, at), ref: key.slice(at + 1) };
}

/** A sheet without its cells — what the `sheets` map carries. */
export function sheetMeta(ws: Worksheet): string {
  const { cells: _cells, cellStyles: _styles, ...meta } = ws;
  void _cells;
  void _styles;
  return JSON.stringify(meta);
}

/** Read a sheet's meta back, defensively, over a fresh worksheet. */
export function readSheetMeta(id: string, json: string | undefined): Worksheet {
  const base = createWorksheet(id, "Sheet");
  if (!json) return base;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return base;
  }
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const map = (v: unknown): Record<number, number> => {
    const out: Record<number, number> = {};
    if (v && typeof v === "object") {
      for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (typeof n === "number") out[Number(k)] = n;
    }
    return out;
  };
  const flags = (v: unknown): Record<number, true> => {
    const out: Record<number, true> = {};
    if (v && typeof v === "object") for (const k of Object.keys(v as object)) out[Number(k)] = true;
    return out;
  };
  const ws: Worksheet = {
    ...base,
    name: typeof raw.name === "string" && raw.name ? raw.name : base.name,
    hidden: raw.hidden === true ? true : undefined,
    rowCount: num(raw.rowCount, base.rowCount),
    colCount: num(raw.colCount, base.colCount),
    rowHeights: map(raw.rowHeights),
    colWidths: map(raw.colWidths),
    hiddenRows: flags(raw.hiddenRows),
    hiddenCols: flags(raw.hiddenCols),
    frozenRows: num(raw.frozenRows, 0),
    frozenCols: num(raw.frozenCols, 0),
    defaultRowHeight: num(raw.defaultRowHeight, base.defaultRowHeight),
    defaultColWidth: num(raw.defaultColWidth, base.defaultColWidth),
  };
  /* The richer fields are trusted as the sender's own model wrote them —
     they are validated on save by the server and by their readers on load. */
  if (raw.filter && typeof raw.filter === "object") ws.filter = raw.filter as Worksheet["filter"];
  if (Array.isArray(raw.validations)) ws.validations = raw.validations as Worksheet["validations"];
  if (Array.isArray(raw.conditionalFormats)) ws.conditionalFormats = raw.conditionalFormats as Worksheet["conditionalFormats"];
  if (Array.isArray(raw.merges)) ws.merges = raw.merges as Worksheet["merges"];
  if (raw.links && typeof raw.links === "object") ws.links = raw.links as Worksheet["links"];
  if (raw.comments && typeof raw.comments === "object") ws.comments = raw.comments as Worksheet["comments"];
  if (Array.isArray(raw.rowGroups)) ws.rowGroups = raw.rowGroups as Worksheet["rowGroups"];
  const charts = readCharts(raw.charts);
  if (charts) ws.charts = charts;
  const protection = readProtection(raw.protection);
  if (protection) ws.protection = protection;
  const pageSetup = readPageSetup(raw.pageSetup);
  if (pageSetup) ws.pageSetup = pageSetup;
  const banding = readBands(raw.banding);
  if (banding.length) ws.banding = banding;
  if (!ws.hidden) delete ws.hidden;
  return ws;
}

/** Write a whole workbook into an empty doc. */
export function seedDoc(doc: Y.Doc, wb: Workbook, registry: StyleRegistry, origin: unknown = LOCAL_ORIGIN): void {
  const maps = mapsOf(doc);
  doc.transact(() => {
    for (const ws of wb.worksheets) {
      maps.sheets.set(ws.id, sheetMeta(ws));
      for (const [ref, cell] of Object.entries(ws.cells)) if (cell.value !== "") maps.cells.set(keyOf(ws.id, ref), cell.value);
      for (const [ref, id] of Object.entries(ws.cellStyles)) if (id !== 0) maps.styles.set(keyOf(ws.id, ref), serializeStyle(registry.get(id)));
    }
    maps.workbook.set("order", JSON.stringify(wb.worksheets.map((ws) => ws.id)));
    maps.workbook.set("names", JSON.stringify(wb.names ?? []));
    maps.workbook.set("pivots", JSON.stringify(wb.pivots ?? []));
  }, origin);
}

/**
 * Write what changed between two workbooks. Returns how many keys were
 * written, so a caller can tell a no-op from a change.
 */
export function pushLocalChanges(
  doc: Y.Doc,
  prev: Workbook | null,
  next: Workbook,
  registry: StyleRegistry,
  origin: unknown = LOCAL_ORIGIN,
): number {
  if (prev === next) return 0;
  const maps = mapsOf(doc);
  let writes = 0;
  doc.transact(() => {
    const prevById = new Map((prev?.worksheets ?? []).map((ws) => [ws.id, ws]));
    const nextIds = new Set(next.worksheets.map((ws) => ws.id));

    /* Sheets that are gone: every key of theirs goes. */
    for (const ws of prev?.worksheets ?? []) {
      if (nextIds.has(ws.id)) continue;
      maps.sheets.delete(ws.id);
      for (const ref of Object.keys(ws.cells)) {
        maps.cells.delete(keyOf(ws.id, ref));
        writes++;
      }
      for (const ref of Object.keys(ws.cellStyles)) maps.styles.delete(keyOf(ws.id, ref));
      writes++;
    }

    for (const ws of next.worksheets) {
      const before = prevById.get(ws.id);
      if (before === ws) continue;
      if (!before || sheetMeta(before) !== sheetMeta(ws)) {
        maps.sheets.set(ws.id, sheetMeta(ws));
        writes++;
      }
      if (!before || before.cells !== ws.cells) {
        const old = before?.cells ?? {};
        for (const [ref, cell] of Object.entries(ws.cells)) {
          if (old[ref]?.value !== cell.value) {
            if (cell.value === "") maps.cells.delete(keyOf(ws.id, ref));
            else maps.cells.set(keyOf(ws.id, ref), cell.value);
            writes++;
          }
        }
        for (const ref of Object.keys(old)) {
          if (!(ref in ws.cells)) {
            maps.cells.delete(keyOf(ws.id, ref));
            writes++;
          }
        }
      }
      if (!before || before.cellStyles !== ws.cellStyles) {
        const old = before?.cellStyles ?? {};
        for (const [ref, id] of Object.entries(ws.cellStyles)) {
          if (old[ref] !== id) {
            if (id === 0) maps.styles.delete(keyOf(ws.id, ref));
            else maps.styles.set(keyOf(ws.id, ref), serializeStyle(registry.get(id)));
            writes++;
          }
        }
        for (const ref of Object.keys(old)) {
          if (!(ref in ws.cellStyles)) {
            maps.styles.delete(keyOf(ws.id, ref));
            writes++;
          }
        }
      }
    }

    const order = JSON.stringify(next.worksheets.map((ws) => ws.id));
    if (maps.workbook.get("order") !== order) {
      maps.workbook.set("order", order);
      writes++;
    }
    const names = JSON.stringify(next.names ?? []);
    if (maps.workbook.get("names") !== names) {
      maps.workbook.set("names", names);
      writes++;
    }
    const pivots = JSON.stringify(next.pivots ?? []);
    if (maps.workbook.get("pivots") !== pivots) {
      maps.workbook.set("pivots", pivots);
      writes++;
    }
  }, origin);
  return writes;
}

/** The whole workbook as the doc holds it — for a client joining a live room. */
export function readDoc(doc: Y.Doc, registry: StyleRegistry, activeSheetId?: string): Workbook {
  const maps = mapsOf(doc);
  let order: string[] = [];
  try {
    const parsed = JSON.parse(maps.workbook.get("order") ?? "[]");
    if (Array.isArray(parsed)) order = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    order = [];
  }
  for (const id of maps.sheets.keys()) if (!order.includes(id)) order.push(id);
  const sheets = new Map<string, Worksheet>();
  for (const id of order) sheets.set(id, { ...readSheetMeta(id, maps.sheets.get(id)), cells: {}, cellStyles: {} });
  for (const [key, value] of maps.cells.entries()) {
    const k = splitKey(key);
    if (!k || !parseCellRef(k.ref) || value === "") continue;
    const ws = sheets.get(k.sheetId);
    if (ws) ws.cells[k.ref] = { value };
  }
  for (const [key, json] of maps.styles.entries()) {
    const k = splitKey(key);
    if (!k || !parseCellRef(k.ref)) continue;
    const ws = sheets.get(k.sheetId);
    if (!ws) continue;
    try {
      ws.cellStyles[k.ref] = registry.intern(deserializeStyle(json));
    } catch {
      /* An unreadable style is no style. */
    }
  }
  const worksheets = [...sheets.values()];
  const parse = <T,>(key: string, read: (raw: unknown) => T | undefined): T | undefined => {
    try {
      return read(JSON.parse(maps.workbook.get(key) ?? "null"));
    } catch {
      return undefined;
    }
  };
  const names = parse("names", (raw) => readNames(raw)) ?? [];
  const pivots = parse("pivots", (raw) => readPivots(raw));
  const active = worksheets.find((ws) => ws.id === activeSheetId)?.id ?? worksheets[0]?.id ?? "";
  return {
    worksheets: worksheets.length ? worksheets : [createWorksheet("sheet-1", "Sheet1")],
    activeSheetId: worksheets.length ? active : "sheet-1",
    ...(names.length ? { names } : {}),
    ...(pivots ? { pivots } : {}),
  };
}

/** Which map an event came from and which keys it touched — captured INSIDE
    the observer, since Yjs refuses to compute a change set after the handler
    has returned. */
export interface RemoteEvent {
  map: "cells" | "styles" | "sheets" | "workbook";
  keys: string[];
}

export function captureEvent(event: Y.YEvent<Y.Map<string>>, maps: WorkbookMaps): RemoteEvent | null {
  const target = event.target;
  const map =
    target === maps.cells ? "cells" : target === maps.styles ? "styles" : target === maps.sheets ? "sheets" : target === maps.workbook ? "workbook" : null;
  if (!map) return null;
  return { map, keys: [...event.changes.keys.keys()] };
}

export interface RemoteChange {
  /** Cells whose raw value changed, for the formula engine. */
  cells: { sheetId: string; row: number; col: number; value: string }[];
  /** Whether the sheet list, a sheet's meta, or the names changed — the
      engine then re-syncs its sheet table and names. */
  structural: boolean;
  namesChanged: boolean;
}

/**
 * Apply a batch of Yjs map events to a workbook, returning the new workbook
 * and what the engine needs to know. Events from the local origin are the
 * caller's to filter out first.
 */
export function applyRemoteEvents(
  events: RemoteEvent[],
  doc: Y.Doc,
  wb: Workbook,
  registry: StyleRegistry,
): { workbook: Workbook; change: RemoteChange } {
  const maps = mapsOf(doc);
  const change: RemoteChange = { cells: [], structural: false, namesChanged: false };
  const sheets = new Map(wb.worksheets.map((ws) => [ws.id, { ...ws, cells: { ...ws.cells }, cellStyles: { ...ws.cellStyles } }]));
  let order = wb.worksheets.map((ws) => ws.id);
  let names = wb.names;
  let pivots = wb.pivots;

  for (const event of events) {
    const target = maps[event.map];
    for (const key of event.keys) {
      if (target === maps.cells) {
        const k = splitKey(key);
        if (!k) continue;
        const pos = parseCellRef(k.ref);
        if (!pos) continue;
        const ws = sheets.get(k.sheetId);
        if (!ws) continue;
        const value = maps.cells.get(key) ?? "";
        if (value === "") delete ws.cells[k.ref];
        else ws.cells[k.ref] = { value };
        change.cells.push({ sheetId: k.sheetId, row: pos.row, col: pos.col, value });
      } else if (target === maps.styles) {
        const k = splitKey(key);
        if (!k) continue;
        const ws = sheets.get(k.sheetId);
        if (!ws) continue;
        const json = maps.styles.get(key);
        if (!json) delete ws.cellStyles[k.ref];
        else {
          try {
            ws.cellStyles[k.ref] = registry.intern(deserializeStyle(json));
          } catch {
            delete ws.cellStyles[k.ref];
          }
        }
      } else if (target === maps.sheets) {
        const json = maps.sheets.get(key);
        change.structural = true;
        if (!json) sheets.delete(key);
        else {
          const existing = sheets.get(key);
          const meta = readSheetMeta(key, json);
          sheets.set(key, { ...meta, cells: existing?.cells ?? {}, cellStyles: existing?.cellStyles ?? {} });
          if (!existing) {
            /* A sheet that is new to us: its cells and styles may already be
               in the maps, written in the same transaction or earlier. */
            const prefix = `${key}${SEP}`;
            const ws = sheets.get(key)!;
            for (const [ck, v] of maps.cells.entries()) {
              if (ck.startsWith(prefix) && v !== "") {
                const ref = ck.slice(prefix.length);
                const pos = parseCellRef(ref);
                if (pos) {
                  ws.cells[ref] = { value: v };
                  change.cells.push({ sheetId: key, row: pos.row, col: pos.col, value: v });
                }
              }
            }
            for (const [sk, sj] of maps.styles.entries()) {
              if (sk.startsWith(prefix)) {
                try {
                  ws.cellStyles[sk.slice(prefix.length)] = registry.intern(deserializeStyle(sj));
                } catch {
                  /* skip */
                }
              }
            }
          }
        }
      } else if (target === maps.workbook) {
        if (key === "order") {
          try {
            const parsed = JSON.parse(maps.workbook.get("order") ?? "[]");
            if (Array.isArray(parsed)) order = parsed.filter((x): x is string => typeof x === "string");
          } catch {
            /* keep the order we had */
          }
          change.structural = true;
        } else if (key === "names") {
          try {
            names = readNames(JSON.parse(maps.workbook.get("names") ?? "[]"));
          } catch {
            names = [];
          }
          change.namesChanged = true;
        } else if (key === "pivots") {
          try {
            pivots = readPivots(JSON.parse(maps.workbook.get("pivots") ?? "[]"));
          } catch {
            pivots = undefined;
          }
        }
      }
    }
  }

  /* Cells with a style but nothing else still exist on the sheet; a cell that
     lost both is gone — mirror what the local model does. */
  const orderedIds = [...order.filter((id) => sheets.has(id)), ...[...sheets.keys()].filter((id) => !order.includes(id))];
  const worksheets = orderedIds.map((id) => {
    const ws = sheets.get(id)!;
    const cells: Record<string, Cell> = {};
    for (const [ref, cell] of Object.entries(ws.cells)) if (cell.value !== "") cells[ref] = cell;
    const cellStyles: Record<string, number> = {};
    for (const [ref, sid] of Object.entries(ws.cellStyles)) if (sid !== 0) cellStyles[ref] = sid;
    return { ...ws, cells, cellStyles };
  });
  const activeSheetId = worksheets.some((ws) => ws.id === wb.activeSheetId) ? wb.activeSheetId : worksheets[0]?.id ?? wb.activeSheetId;
  const next: Workbook = { worksheets, activeSheetId };
  if (names && names.length) next.names = names;
  if (pivots && pivots.length) next.pivots = pivots;
  return { workbook: next, change };
}

/** What one person publishes about where they are, for the others' cursors. */
export interface PresenceState {
  sheetId: string;
  row: number;
  col: number;
  range: { top: number; left: number; bottom: number; right: number };
}

export interface PeerCursor extends PresenceState {
  clientId: number;
  name: string;
  color: string;
}

/** The other people's cursors out of an awareness state map. */
export function peersFrom(
  states: Map<number, Record<string, unknown>>,
  selfId: number,
): PeerCursor[] {
  const out: PeerCursor[] = [];
  for (const [clientId, state] of states) {
    if (clientId === selfId) continue;
    const user = state.user as { name?: string; color?: string } | undefined;
    const sheet = state.sheet as PresenceState | undefined;
    if (!sheet || typeof sheet.sheetId !== "string" || typeof sheet.row !== "number" || typeof sheet.col !== "number") continue;
    out.push({
      clientId,
      name: user?.name ?? "Someone",
      color: user?.color ?? "#8b9fbc",
      sheetId: sheet.sheetId,
      row: sheet.row,
      col: sheet.col,
      range: sheet.range ?? { top: sheet.row, left: sheet.col, bottom: sheet.row, right: sheet.col },
    });
  }
  return out;
}

/** A style JSON round-trips through the registry — exported for the tests. */
export function styleJson(style: CellStyle): string {
  return serializeStyle(style);
}

export { cellRef };
