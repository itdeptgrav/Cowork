"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { HyperFormula } from "hyperformula";
import { Icon } from "@/components/ui/Icons";
import { DocIcon } from "./docs/DocsIcons";
import { InlineError } from "@/components/ui/Primitives";
import { StageError, StageSkeleton } from "./WorkspaceStage";
import { useQuery } from "@/lib/hooks/useRepository";
import { getRepository } from "@/lib/repositories";
import { notifyRepositoryChanged } from "@/lib/repositories/events";
import {
  canManage,
  editRefusal,
  roleOf,
} from "@/lib/rules/documents/access";
import {
  cellRef,
  chartData,
  columnLabel,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  deleteColumns,
  deleteRows,
  displayValue,
  evalConditional,
  explainError,
  formatNumber,
  formulaAcceptsReference,
  formulaFunctionPrefix,
  inRect,
  insertColumns,
  insertRows,
  isFormula,
  isNumericDisplay,
  MAX_SHEETS,
  matchFunctionNames,
  MIN_COL_WIDTH,
  MIN_ROW_HEIGHT,
  normalizeRange,
  offsetReferences,
  parseClipboardTable,
  parseRef,
  rangeLabel,
  rangeToRect,
  readWorkbook,
  resizeColumn,
  resizeRow,
  summarize,
  writeWorkbook,
  type CellMap,
  type CellPos,
  type CellStyle,
  type ChartSpec,
  type ChartType,
  type ConditionalKind,
  type ConditionalRule,
  type NumberFormat,
  type RuleStats,
  type SheetData,
  type SheetTab,
  type StyleMap,
  type Workbook,
} from "@/lib/rules/sheets/grid";
import { useCollabSession } from "./useCollabSession";
import { documentRoom } from "@/lib/rules/workspace/collabRoom";
import { ShareMenu } from "./ShareMenu";
import {
  SheetChartObject,
  CHART_DEFAULT_W,
  CHART_DEFAULT_H,
} from "./SheetChartObject";
import { ChartPanel } from "./ChartPanel";
import { ConditionalPanel } from "./ConditionalPanel";
import { SheetsAssistant } from "./ai/SheetsAssistant";
import { parseCellDirective, resolveAutosum } from "@/lib/rules/sheets/cellDirectives";
import { SheetContextMenu, type MenuAction } from "./SheetContextMenu";
import { SheetTabBar } from "./docs/SheetTabBar";
import { MenuItem, MenuSeparator, Popover } from "./docs/DocsMenu";
import { readCsv, writeCsv } from "@/lib/rules/sheets/csv";
import type { SelectionState, SheetCommand } from "./sheetCommands";

/**
 * The spreadsheet.
 *
 * ## Three things kept strictly apart
 *
 *  1. **What was typed** — the CRDT's `Y.Map` of raw cell strings. The shared
 *     truth, and the only thing anybody edits.
 *  2. **What it evaluates to** — HyperFormula, rebuilt from (1). Never stored
 *     and never transmitted: a computed value sent between clients is a number
 *     that can outlive the inputs it came from.
 *  3. **How it looks** — a second `Y.Map` of styles, so bolding a cell does not
 *     touch its value and two people can do each independently.
 *
 * ## Only the visible rows are in the DOM
 *
 * A 200 × 26 sheet is 5,200 cells; rendering and re-rendering all of them on
 * every keystroke is what made it crawl. The grid is windowed: it renders the
 * rows in view plus a small overscan, with a spacer above and below holding the
 * scrollbar honest. Most rows/columns are `DEFAULT_CELL_H`/`DEFAULT_CELL_W`, but
 * a user can drag a header to resize one — `rowOffsets`/`colOffsets` (prefix
 * sums over `rowHeightAt`/`colWidthAt`) turn that into a lookup table instead of
 * per-row measurement, which is the thing that makes windowing itself slow.
 */

const DEFAULT_CELL_W = 104;
const DEFAULT_CELL_H = 26;
const HEAD_W = 44;
const OVERSCAN = 8;

/**
 * Tabs share one collab room (`documentRoom(documentId)` is per-DOCUMENT, not
 * per-sheet), so the CELL and STYLE maps stay flat `Y.Map`s keyed
 * `"<sheetId>:<ref>"` rather than one nested map per tab — the smallest change
 * to structures `parseSheet`/`sheetToObject` already understand per-sheet.
 * Charts and conditional rules are `Y.Array`s (order matters — paint order,
 * rule priority), so the same idea is a `sheetId` TAG on each element instead
 * of a key prefix; filtering by tag is this file's problem, not grid.ts's.
 */
type StoredChart = ChartSpec & { sheetId?: string };
type StoredRule = ConditionalRule & { sheetId?: string };

function withoutSheetId<T extends { sheetId?: string }>(item: T): Omit<T, "sheetId"> {
  const copy: Record<string, unknown> = { ...item };
  delete copy.sheetId;
  return copy as Omit<T, "sheetId">;
}

/**
 * One tab's `SheetData`, read from the shared maps when collaborating (else
 * from the tab's own stored fields).
 *
 * `isFirst` carries the ONE-TIME legacy fallback: a document collaborated on
 * before tabs existed has plain, un-prefixed keys and un-tagged chart/rule
 * entries in the room already, and those belong to whatever is now the FIRST
 * tab (the one `readWorkbook` wrapped it as). The migration effect below
 * rewrites them with a prefix/tag the first time a session sees them; this
 * fallback just means nothing looks blank in the moment before that runs.
 */
function sheetDataFor(
  tab: SheetTab,
  isFirst: boolean,
  yCells: Y.Map<string> | null,
  yStyles: Y.Map<CellStyle> | null,
  yCharts: Y.Array<StoredChart> | null,
  yConds: Y.Array<StoredRule> | null,
): SheetData {
  if (!yCells) {
    return {
      cells: tab.cells,
      styles: tab.styles,
      rows: tab.rows,
      cols: tab.cols,
      charts: tab.charts,
      conditionals: tab.conditionals,
      hidden: tab.hidden,
      rowHeights: tab.rowHeights,
      columnWidths: tab.columnWidths,
    };
  }
  const prefix = `${tab.id}:`;
  const cells: CellMap = {};
  for (const [key, value] of yCells.entries()) {
    if (key.startsWith(prefix)) cells[key.slice(prefix.length)] = value;
    else if (isFirst && parseRef(key)) cells[key] = value;
  }
  const styles: StyleMap = {};
  if (yStyles)
    for (const [key, style] of yStyles.entries()) {
      if (key.startsWith(prefix)) styles[key.slice(prefix.length)] = style;
      else if (isFirst && parseRef(key)) styles[key] = style;
    }
  const charts = yCharts
    ? yCharts
        .toArray()
        .filter((c) => c.sheetId === tab.id || (isFirst && !c.sheetId))
        .map(withoutSheetId)
    : (tab.charts ?? []);
  const conditionals = yConds
    ? yConds
        .toArray()
        .filter((r) => r.sheetId === tab.id || (isFirst && !r.sheetId))
        .map(withoutSheetId)
    : (tab.conditionals ?? []);
  return {
    cells,
    styles,
    rows: tab.rows,
    cols: tab.cols,
    ...(charts.length ? { charts } : {}),
    ...(conditionals.length ? { conditionals } : {}),
    ...(tab.hidden?.length ? { hidden: tab.hidden } : {}),
    ...(tab.rowHeights && Object.keys(tab.rowHeights).length ? { rowHeights: tab.rowHeights } : {}),
    ...(tab.columnWidths && Object.keys(tab.columnWidths).length ? { columnWidths: tab.columnWidths } : {}),
  };
}

/** The font-family menu, Excel's list. */
const FONTS = [
  "Calibri",
  "Arial",
  "Times New Roman",
  "Courier New",
  "Verdana",
  "Georgia",
];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];

/** A stable id, falling back to a deterministic one where crypto is absent. */
function newId(fallback: string): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : fallback;
}

export function SheetGrid({
  documentId,
  onClose,
  onNew,
  creating = false,
}: {
  documentId: string;
  /** Back to the list. The grid fills the window, so this is the only way out. */
  onClose?: () => void;
  onNew?: () => void;
  creating?: boolean;
}) {
  const doc = useQuery((r) => r.getDocument(documentId), [documentId]);
  const body = useQuery((r) => r.getDocumentBody(documentId), [documentId]);
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  const collab = useCollabSession(documentRoom(documentId), me.data ?? null);

  const readOnly = doc.data
    ? editRefusal(doc.data, me.data?.id ?? null) !== null
    : false;
  const myRole = doc.data ? roleOf(doc.data, me.data?.id ?? null) : null;

  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  /* The FOCUS cell (`active`) and the other corner of a selection (`anchor`).
     A null anchor is a single-cell selection. */
  const [active, setActive] = useState("A1");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  /* Bumped by the CRDT observers, so the memos below can name it as a dependency
     rather than relying on a render side effect. */
  const [version, setVersion] = useState(0);

  /* Autocomplete: hidden by Escape until the draft next changes, and a cursor
     into the offered names. */
  const [acHidden, setAcHidden] = useState(false);
  const [acIndex, setAcIndex] = useState(0);
  /* Which editor the caret is in — so the suggestion menu appears at the input
     being typed into, and the cell editor does not steal focus from the bar. */
  const [editAt, setEditAt] = useState<"cell" | "bar">("cell");

  /* Formula "pointing": while editing a formula that wants a reference, clicking
     or dragging cells writes their reference into the draft instead of moving the
     selection — `=SUM(` then a drag over A1:A9 becomes `=SUM(A1:A9`. `pointStart`
     marks where in the draft the pointed reference begins, so a drag REPLACES it
     rather than appending a new one every frame. */
  const [pointStart, setPointStart] = useState<number | null>(null);
  const [pointAnchor, setPointAnchor] = useState<CellPos | null>(null);
  const [pointFocus, setPointFocus] = useState<CellPos | null>(null);

  /* Windowing: the scroll offset and the viewport height decide which rows exist. */
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(480);
  /* Whether the BROWSER is showing its own chrome. Not a size the grid can be:
     it fills the window always — see `WorkspaceStage`. */
  const [chromeless, setChromeless] = useState(false);
  const [undoMgr, setUndoMgr] = useState<Y.UndoManager | null>(null);
  /* The right-click menu's viewport position, or null when closed. */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  /* The embedded chart currently selected (its config panel is open), or null. */
  const [selectedChart, setSelectedChart] = useState<string | null>(null);
  /* The conditional-formatting panel, and which rule's editor is expanded. */
  const [cfOpen, setCfOpen] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  /**
   * An `=ai …` typed into a cell, waiting to be handed to the panel.
   *
   * Held here rather than passed straight down because the panel may not be
   * mounted at the moment the cell commits — opening it and delivering the
   * request are two steps, and the request has to survive the gap. Cleared
   * by the panel once it has taken it, so re-opening the panel later does
   * not re-ask a question from ten minutes ago.
   */
  const [cellPrompt, setCellPrompt] = useState<{ ref: string; text: string } | null>(null);
  const [selectedRule, setSelectedRule] = useState<string | null>(null);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* What the footer reports about the write.
     The save itself was already reliable — debounced, flushed on hide and on
     unmount — but it was entirely invisible, so there was no way to know
     whether a change had landed before closing the tab, and no way to force
     one. That is what this, the Ctrl+S handler and the `pagehide` flush below
     are for. */
  const [saveState, setSaveState] = useState<
    "saved" | "pending" | "saving" | "error"
  >("saved");
  /* `saveNow` runs from unmount and from `pagehide`, both of which can happen
     after this component is gone; the guard keeps those from setting state on
     a dead component. */
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const seeded = useRef(false);
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const xlsxInputRef = useRef<HTMLInputElement | null>(null);
  /* Guards the one-time rewrite of a room's pre-tabs keys (plain "A1", untagged
     chart/rule entries) into the "<sheetId>:ref" / sheetId-tagged shape — see
     the migration effect below. */
  const migrated = useRef(false);
  const dragging = useRef(false);
  /* A drag that began on a row/column header. Kept apart from `dragging` so
     sweeping across headers extends whole rows/columns, while the cell grid's
     own `onMouseEnter` stays inert — otherwise passing over the cells would
     collapse the band selection back down to a single cell. */
  const headerDrag = useRef<{ kind: "col" | "row"; from: number } | null>(null);
  const pointing = useRef(false);
  const scrollRaf = useRef(0);

  /* A drag on a row/column header's resize handle. `liveSize` tracks the
     in-progress size on every pointer move so `commitResize` (on pointer up)
     can read it synchronously — state set from the same move would not yet
     have flushed by the time the up-handler runs. Only the guide LINE moves
     during the drag (see `resizeGuide` below); the actual row/column doesn't
     resize, and nothing is written to the sheet, until the pointer releases —
     one commit per drag, not one per pixel of mouse movement. */
  const resizeDrag = useRef<{
    kind: "row" | "col";
    index: number;
    startClient: number;
    startSize: number;
    liveSize: number;
  } | null>(null);
  const [resizeGuide, setResizeGuide] = useState<{ kind: "row" | "col"; edge: number } | null>(null);

  /* The shared maps. Read through the provider's doc so every client mutates the
     same structure rather than a copy of it. Keys/tags are namespaced by sheet
     id — see `sheetDataFor` above — because the room is per-DOCUMENT and every
     tab shares it. */
  const yCells = collab.session?.doc.getMap<string>("cells") ?? null;
  const yStyles = collab.session?.doc.getMap<CellStyle>("styles") ?? null;
  const yCharts = collab.session?.doc.getArray<StoredChart>("charts") ?? null;
  const yConds =
    collab.session?.doc.getArray<StoredRule>("conditionals") ?? null;

  /**
   * The engine, BUILT AND DESTROYED IN ONE EFFECT.
   *
   * The engine used to be built in a `useMemo` and freed in a SEPARATE effect's
   * cleanup. Under React StrictMode (dev) a component is mounted, unmounted and
   * remounted to flush out exactly this class of bug: the cleanup ran
   * `engine.destroy()`, but the memo — keyed on `[]` — was not re-run on the
   * remount, so the live grid was left driving a torn-down engine and the next
   * `setSheetContent` threw. Building and freeing in one effect makes the pair
   * inseparable, and holding it in state re-runs the consumers once it is ready.
   *
   * `sheetIds` maps a TAB's id to the numeric HyperFormula sheet it drives —
   * one HF sheet per tab (a direct fit, not a workaround), so `=Sheet2!A1`
   * resolves the way HyperFormula already knows how to. It starts empty and is
   * kept in step with `workbook.sheets` by the sync effect just below, rather
   * than built once here, because tabs are added/removed/renamed long after
   * mount.
   */
  const [hf, setHf] = useState<{
    engine: HyperFormula;
    /* Optional in its own type, not just in practice — a tab added this render
       has no HF sheet yet (the sync effect below hasn't run), and typing it as
       always-present would make that state uncheckable. */
    sheetIds: Record<string, number | undefined>;
  } | null>(null);

  useEffect(() => {
    const engine = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
    /* Bare TRUE/FALSE as literals — HyperFormula reads them as named
       expressions otherwise, so `=VLOOKUP(3,A1:B2,2,FALSE)` returned `#NAME?`. */
    try {
      engine.addNamedExpression("TRUE", "=TRUE()");
      engine.addNamedExpression("FALSE", "=FALSE()");
    } catch {
      /* Already registered. */
    }
    setHf({ engine, sheetIds: {} });
    return () => {
      engine.destroy();
      setHf(null);
    };
  }, []);

  /* Keep the engine's own sheets in step with the tabs: add one for a new tab,
     rename HF's to match a renamed tab (its numeric id is stable across a
     rename), drop one for a closed tab. A tab's NAME is what a cross-sheet
     formula names, so this — not the tab's id — is what HyperFormula tracks;
     `SheetTabBar` keeps tab names unique so two tabs never fight over one HF
     sheet. Runs after render rather than during it (unlike `engineError`
     below): this is tab bookkeeping, not the hot per-keystroke path. */
  useEffect(() => {
    if (!hf || !workbook) return;
    const { engine, sheetIds } = hf;
    const nextIds = { ...sheetIds };
    let changed = false;
    const liveIds = new Set(workbook.sheets.map((t) => t.id));
    for (const tabId of Object.keys(nextIds)) {
      const hfId = nextIds[tabId];
      if (!liveIds.has(tabId)) {
        try {
          if (hfId !== undefined) engine.removeSheet(hfId);
        } catch {
          /* Already gone. */
        }
        delete nextIds[tabId];
        changed = true;
      }
    }
    for (const tab of workbook.sheets) {
      const existing = nextIds[tab.id];
      if (existing === undefined) {
        try {
          engine.addSheet(tab.name);
          const id = engine.getSheetId(tab.name);
          if (id !== undefined) {
            nextIds[tab.id] = id;
            changed = true;
          }
        } catch {
          /* A name collision or invalid name — `engineError` will surface it
             once the tab's content is fed in below. */
        }
      } else if (engine.getSheetName(existing) !== tab.name) {
        try {
          engine.renameSheet(existing, tab.name);
          changed = true;
        } catch {
          /* Leave the old name; the next sync retries. */
        }
      }
    }
    if (changed) setHf({ engine, sheetIds: nextIds });
  }, [hf, workbook]);

  /* ── Load ──────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (workbook || body.isLoading) return;
    const frame = requestAnimationFrame(() =>
      setWorkbook(readWorkbook(body.data?.cells ?? null)),
    );
    return () => cancelAnimationFrame(frame);
  }, [body.isLoading, body.data?.cells, workbook]);

  /* Carry a pre-collaboration workbook into the CRDT once, only when the shared
     map is genuinely empty, so the second person to open it does not write a
     copy. Every tab is seeded, not just the active one — the room holds the
     whole workbook. */
  useEffect(() => {
    if (!yCells || !workbook || seeded.current || !collab.session) return;
    const apply = () => {
      if (seeded.current) return;
      seeded.current = true;
      if (yCells.size > 0) return;
      collab.session!.doc.transact(() => {
        for (const tab of workbook.sheets) {
          for (const [ref, value] of Object.entries(tab.cells))
            yCells.set(`${tab.id}:${ref}`, value);
          for (const [ref, style] of Object.entries(tab.styles))
            yStyles?.set(`${tab.id}:${ref}`, style);
          if (tab.charts?.length)
            yCharts?.push(tab.charts.map((c) => ({ ...c, sheetId: tab.id })));
          if (tab.conditionals?.length)
            yConds?.push(tab.conditionals.map((r) => ({ ...r, sheetId: tab.id })));
        }
      });
    };
    if (collab.session.provider.synced) apply();
    else collab.session.provider.once("sync", apply);
  }, [yCells, yStyles, yCharts, yConds, workbook, collab.session]);

  /* One-time rewrite of a room that predates tabs: plain "A1" keys become
     "<firstSheetId>:A1", and chart/rule entries with no `sheetId` are tagged
     with it. `sheetDataFor`'s `isFirst` fallback already reads this data
     correctly before this runs, so this is tidying the room's actual shape
     rather than fixing a display bug — it means the SECOND session to open a
     legacy room also sees a namespaced map, not a growing pile of both. */
  useEffect(() => {
    if (!yCells || !workbook || migrated.current || !collab.session) return;
    const firstId = workbook.sheets[0]?.id;
    if (!firstId) return;
    const apply = () => {
      if (migrated.current) return;
      migrated.current = true;
      const legacyCellKeys = Array.from(yCells.keys()).filter((k) => parseRef(k));
      const legacyStyleKeys = yStyles
        ? Array.from(yStyles.keys()).filter((k) => parseRef(k))
        : [];
      const chartsNeedTag = yCharts?.toArray().some((c) => !c.sheetId) ?? false;
      const condsNeedTag = yConds?.toArray().some((r) => !r.sheetId) ?? false;
      if (
        !legacyCellKeys.length &&
        !legacyStyleKeys.length &&
        !chartsNeedTag &&
        !condsNeedTag
      )
        return;
      collab.session!.doc.transact(() => {
        for (const key of legacyCellKeys) {
          const value = yCells.get(key);
          if (value === undefined) continue;
          yCells.delete(key);
          yCells.set(`${firstId}:${key}`, value);
        }
        if (yStyles)
          for (const key of legacyStyleKeys) {
            const style = yStyles.get(key);
            if (style === undefined) continue;
            yStyles.delete(key);
            yStyles.set(`${firstId}:${key}`, style);
          }
        if (yCharts && chartsNeedTag) {
          const tagged = yCharts
            .toArray()
            .map((c) => (c.sheetId ? c : { ...c, sheetId: firstId }));
          yCharts.delete(0, yCharts.length);
          yCharts.insert(0, tagged);
        }
        if (yConds && condsNeedTag) {
          const tagged = yConds
            .toArray()
            .map((r) => (r.sheetId ? r : { ...r, sheetId: firstId }));
          yConds.delete(0, yConds.length);
          yConds.insert(0, tagged);
        }
      });
    };
    if (collab.session.provider.synced) apply();
    else collab.session.provider.once("sync", apply);
  }, [yCells, yStyles, yCharts, yConds, workbook, collab.session]);

  /* Re-render on anybody's change — including our own. */
  useEffect(() => {
    if (!yCells || !yStyles) return;
    const bump = () => setVersion((n) => n + 1);
    yCells.observe(bump);
    yStyles.observe(bump);
    yCharts?.observe(bump);
    yConds?.observe(bump);
    return () => {
      yCells.unobserve(bump);
      yStyles.unobserve(bump);
      yCharts?.unobserve(bump);
      yConds?.unobserve(bump);
    };
  }, [yCells, yStyles, yCharts, yConds]);

  /* Undo/redo over the shared maps AND arrays. It tracks LOCAL edits only (the
     default null origin), so Ctrl+Z never rewinds a collaborator's change out
     from under them. Charts and conditional rules are in scope too, so inserting
     a chart or a rule is undoable like any cell edit. Live sessions only —
     offline there is no CRDT history to walk. Global across the whole workbook,
     same as Excel's: undoing a change made on another tab acts on that tab's
     data even while a different one is active (Excel would flip you to it —
     this doesn't, which is a known rough edge, not a correctness problem). */
  useEffect(() => {
    if (!yCells || !yStyles) return;
    /* Charts and rules share the session, so they exist together with the cell
       and style maps or not at all; the ternary keeps the inferred element type
       a clean union the UndoManager accepts. */
    const scope =
      yCharts && yConds
        ? [yCells, yStyles, yCharts, yConds]
        : [yCells, yStyles];
    const mgr = new Y.UndoManager(scope, { captureTimeout: 350 });
    setUndoMgr(mgr);
    return () => {
      mgr.destroy();
      setUndoMgr(null);
    };
  }, [yCells, yStyles, yCharts, yConds]);

  /* Every tab's SheetData, live: the CRDT's view when collaborating (folded
     through `sheetDataFor`'s namespacing), else each tab's own stored fields.
     Computed for the whole workbook — not just the active tab — because
     HyperFormula needs every sheet's content to resolve a cross-sheet
     reference, not only the one on screen. */
  const allSheetsData = useMemo<Record<string, SheetData>>(() => {
    if (!workbook) return {};
    const out: Record<string, SheetData> = {};
    workbook.sheets.forEach((tab, i) => {
      out[tab.id] = sheetDataFor(tab, i === 0, yCells, yStyles, yCharts, yConds);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands in for yCells/yStyles/yCharts/yConds mutating in place.
  }, [workbook, yCells, yStyles, yCharts, yConds, version]);

  const activeId =
    workbook &&
    (workbook.sheets.some((s) => s.id === workbook.activeId)
      ? workbook.activeId
      : workbook.sheets[0]?.id);
  const activeTab = workbook && activeId ? (workbook.sheets.find((s) => s.id === activeId) ?? null) : null;
  /* The active tab's live SheetData — what the rest of this component reads
     as "the sheet". Kept under the name `sheet` so the render body below,
     written for one sheet, needed no wider rewrite: switching tabs is just
     this lookup changing. */
  const sheet = activeTab ? allSheetsData[activeTab.id] : null;
  const activeHfId = hf && activeTab ? hf.sheetIds[activeTab.id] : undefined;

  const rawCells = sheet?.cells ?? {};
  const rawStyles = sheet?.styles ?? {};
  const rawCharts = sheet?.charts ?? [];
  const rawConds = sheet?.conditionals ?? [];

  const rowHeightAt = (r: number): number => sheet?.rowHeights?.[r] ?? DEFAULT_CELL_H;
  const colWidthAt = (c: number): number => sheet?.columnWidths?.[c] ?? DEFAULT_CELL_W;

  /* Prefix sums: rowOffsets[i] is the pixel Y of row i's top edge — rowOffsets[0]
     is 0, rowOffsets[sheet.rows] is the sheet's total content height. Rebuilt only
     when the shape changes (row count or a resize), not on every scroll frame, so a
     5,000-row sheet doesn't re-sum on each pixel of scrolling. Everywhere the old
     fixed-height code did `index * CELL_H`, this file now does `rowOffsets[index]`. */
  const rowOffsets = useMemo(() => {
    const rows = sheet?.rows ?? 0;
    const offsets = new Array<number>(rows + 1);
    offsets[0] = 0;
    for (let r = 0; r < rows; r++) offsets[r + 1] = offsets[r] + rowHeightAt(r);
    return offsets;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rowHeightAt closes over `sheet`, already a dep.
  }, [sheet?.rows, sheet?.rowHeights]);
  const colOffsets = useMemo(() => {
    const cols = sheet?.cols ?? 0;
    const offsets = new Array<number>(cols + 1);
    offsets[0] = 0;
    for (let c = 0; c < cols; c++) offsets[c + 1] = offsets[c] + colWidthAt(c);
    return offsets;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colWidthAt closes over `sheet`, already a dep.
  }, [sheet?.cols, sheet?.columnWidths]);
  const totalContentH = rowOffsets[rowOffsets.length - 1] ?? 0;
  const totalContentW = colOffsets[colOffsets.length - 1] ?? 0;

  /** The last index whose offset is ⇐ `pos` — i.e. which row/col a pixel position falls in. */
  const indexAtOffset = (offsets: number[], pos: number): number => {
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  /* Feed EVERY sheet into the engine SYNCHRONOUSLY — a memo during render, NOT
     an effect. **This is the "the total doesn't show until I touch something
     else" fix.** An effect runs AFTER the render that reads the engine, so a
     freshly-typed `=SUM(...)` was evaluated against the PREVIOUS content and
     its result surfaced a render late. Computing it here means the cells below
     read an engine that already knows the edit, so the answer is on screen the
     instant Enter lands. Every sheet, not just the active one, so a formula on
     this tab referencing another tab reads that tab's CURRENT content —
     `setSheetContent` is idempotent, so re-feeding an unchanged tab is only
     wasted work, not a correctness risk, and StrictMode's double-invoke stays
     harmless. */
  const engineError = useMemo<string | null>(() => {
    if (!workbook || !hf) return null;
    let firstError: string | null = null;
    for (const tab of workbook.sheets) {
      const hfId = hf.sheetIds[tab.id];
      if (hfId === undefined) continue;
      const data = allSheetsData[tab.id];
      if (!data) continue;
      const grid: string[][] = Array.from({ length: tab.rows }, () =>
        Array.from({ length: tab.cols }, () => ""),
      );
      for (const [ref, value] of Object.entries(data.cells)) {
        const at = parseRef(ref);
        if (at && at.row < tab.rows && at.col < tab.cols) {
          grid[at.row][at.col] = value;
        }
      }
      try {
        hf.engine.setSheetContent(hfId, grid);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "That sheet could not be calculated.";
        firstError ??= tab.id === activeTab?.id ? message : `${tab.name}: ${message}`;
      }
    }
    return firstError;
  }, [workbook, hf, allSheetsData, activeTab?.id]);

  /* ── Save ──────────────────────────────────────────────────────────────── */

  /* The actual write, run either after the debounce or immediately on a flush.
     Cancels any pending timer so a queued save and a flush never race. Saves
     the WHOLE workbook — every tab's live data (`allSheetsData` already has
     it, CRDT-merged or not), not just the one on screen. */
  const saveNow = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!workbook || readOnly) return;
    const next: Workbook = {
      activeId: workbook.activeId,
      sheets: workbook.sheets.map((tab) => ({
        id: tab.id,
        name: tab.name,
        ...(tab.color ? { color: tab.color } : {}),
        ...(allSheetsData[tab.id] ?? tab),
      })),
    };
    if (mounted.current) setSaveState("saving");
    void getRepository()
      .saveDocumentBody(documentId, { cells: writeWorkbook(next) })
      .then(() => {
        if (mounted.current) setSaveState("saved");
      })
      .catch(() => {
        if (mounted.current) setSaveState("error");
        setError("That could not be saved.");
      });
  }, [documentId, workbook, allSheetsData, readOnly]);

  /* Held in a ref so the flush listeners can stay registered once (a stable
     effect) yet always call the latest closure over the current cells. */
  const saveNowRef = useRef(saveNow);
  useEffect(() => {
    saveNowRef.current = saveNow;
  }, [saveNow]);

  /* The live read-only state, checked at flush time — so a role revoked in the
     instant before a tab-hide can't let a stale closure write anyway. */
  const readOnlyRef = useRef(readOnly);
  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("pending");
    saveTimer.current = setTimeout(() => saveNowRef.current(), 1500);
  }, []);

  /* Close the data-loss window: the 1.5s debounce means a tab closed or hidden
     mid-edit would otherwise drop the pending write. Flush it when the tab is
     hidden and once more on unmount — only if a save is actually pending, so we
     never write on a sheet nobody touched. (Ports the DocumentEditor pattern.) */
  useEffect(() => {
    const onHide = () => {
      if (
        document.visibilityState === "hidden" &&
        saveTimer.current &&
        !readOnlyRef.current
      )
        saveNowRef.current();
    };
    /* `visibilitychange` does not reliably fire before a reload or a tab close,
       which left a 1.5s window where the last edit was lost. `pagehide` is the
       one the browsers agree on for that, so it flushes too. */
    const onPageHide = () => {
      if (saveTimer.current && !readOnlyRef.current) saveNowRef.current();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      if (saveTimer.current && !readOnlyRef.current) saveNowRef.current();
    };
  }, []);

  /* ── Viewport (windowing) ──────────────────────────────────────────────── */

  /* Measured, not assumed: a sheet in a small pane windows fewer rows than one
     full-screen, and reading it keeps the overscan honest on either. */
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    setViewportH(el.clientHeight);
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheet, hf, activeTab?.id]);

  /* Keep the focus cell on screen when it moves off it by keyboard — otherwise
     an arrow into a windowed-away row selects a cell nobody can see. */
  useEffect(() => {
    const el = gridRef.current;
    const pos = parseRef(active);
    if (!el || !pos) return;
    const top = rowOffsets[pos.row] ?? 0;
    const h = rowHeightAt(pos.row);
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + h > el.scrollTop + el.clientHeight - h)
      el.scrollTop = top + h - el.clientHeight + h;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only "active" moving should re-scroll; a resize alone shouldn't yank focus back into view.
  }, [active]);

  /* ── Edit ──────────────────────────────────────────────────────────────── */

  /* One tab's slice of a flat, namespaced Yjs key/tag — see `sheetDataFor`. */
  const tabKey = (ref: string): string | null =>
    activeTab ? `${activeTab.id}:${ref}` : null;

  /** Rewrite `workbook.sheets[activeTab]` with a patch — the non-collab path every setter below falls back to. */
  const patchActiveTab = (patch: Partial<SheetTab>) => {
    const id = activeTab?.id;
    if (!id) return;
    setWorkbook((wb) =>
      wb ? { ...wb, sheets: wb.sheets.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : wb,
    );
  };

  const setCell = (ref: string, value: string) => {
    const key = tabKey(ref);
    if (readOnly || !key) return;
    setError(null);
    if (yCells) {
      if (value === "") yCells.delete(key);
      else yCells.set(key, value);
    } else {
      patchActiveTab({ cells: { ...(activeTab?.cells ?? {}), [ref]: value } });
    }
    scheduleSave();
  };

  /* A block write — one CRDT transaction (or one state update) for a whole
     range, so a paste or a range-clear is a single merge everyone sees at once. */
  const writeCells = (entries: [string, string][]) => {
    const id = activeTab?.id;
    if (readOnly || entries.length === 0 || !id) return;
    setError(null);
    if (yCells) {
      collab.session?.doc.transact(() => {
        for (const [ref, value] of entries) {
          if (value === "") yCells.delete(`${id}:${ref}`);
          else yCells.set(`${id}:${ref}`, value);
        }
      });
    } else {
      const cells = { ...(activeTab?.cells ?? {}) };
      for (const [ref, value] of entries) {
        if (value === "") delete cells[ref];
        else cells[ref] = value;
      }
      patchActiveTab({ cells });
    }
    scheduleSave();
  };

  /**
   * Replace the whole ACTIVE tab with an already-computed `SheetData` — the
   * landing spot for `lib/rules/sheets/grid.ts`'s `insertRows`/`deleteRows`/
   * `insertColumns`/`deleteColumns`/`sortRange`, which each take the current
   * `SheetData` and return the new one rather than a patch. Cells, styles,
   * charts and conditionals are CRDT-backed when collaborating, so the swap
   * is delete-everything-then-set-everything inside one transaction, scoped to
   * this tab's keys/tags — the OTHER tabs' entries in the same flat maps are
   * left untouched. `rows`, `cols` and `hidden` are not CRDT-backed (see the
   * top of this file), so they go through `workbook` state either way.
   */
  const applyStructuralEdit = (next: SheetData) => {
    const id = activeTab?.id;
    if (readOnly || !id) return;
    setError(null);
    if (yCells && yStyles) {
      const prefix = `${id}:`;
      collab.session?.doc.transact(() => {
        for (const key of Array.from(yCells.keys()))
          if (key.startsWith(prefix)) yCells.delete(key);
        for (const [ref, value] of Object.entries(next.cells))
          yCells.set(`${prefix}${ref}`, value);
        for (const key of Array.from(yStyles.keys()))
          if (key.startsWith(prefix)) yStyles.delete(key);
        for (const [ref, style] of Object.entries(next.styles))
          yStyles.set(`${prefix}${ref}`, style);
        if (yCharts) {
          const others = yCharts.toArray().filter((c) => c.sheetId !== id);
          const mine = (next.charts ?? []).map((c) => ({ ...c, sheetId: id }));
          yCharts.delete(0, yCharts.length);
          yCharts.insert(0, [...others, ...mine]);
        }
        if (yConds) {
          const others = yConds.toArray().filter((r) => r.sheetId !== id);
          const mine = (next.conditionals ?? []).map((r) => ({ ...r, sheetId: id }));
          yConds.delete(0, yConds.length);
          yConds.insert(0, [...others, ...mine]);
        }
      });
      patchActiveTab({
        rows: next.rows,
        cols: next.cols,
        hidden: next.hidden,
        rowHeights: next.rowHeights,
        columnWidths: next.columnWidths,
      });
    } else {
      patchActiveTab(next);
    }
    scheduleSave();
  };

  /* Formatting applies to the WHOLE selection, as a spreadsheet does — bolding
     A1:C3 bolds all nine. Each cell keeps its other styles; only the patched keys
     change (`null`-valued keys are stripped, so "no fill" is an absence, not a
     stored null the CRDT keeps replicating).

     `refsOverride` lets a caller that already knows exactly which cells it
     means (the AI assistant's `flag_outliers`) bypass the selection entirely,
     rather than going through `selectRange` first — see `styleCells` in
     `sheetCommands.ts` for why that two-step sequence cannot be relied on for
     a non-rectangular set of refs. */
  const toggleStyle = (patch: Partial<CellStyle>, refsOverride?: string[]) => {
    const id = activeTab?.id;
    if (readOnly || !id) return;
    const list = refsOverride ?? (selRect ? rectRefs() : [active]);
    const merge = (cur: CellStyle): CellStyle => {
      const next: CellStyle = { ...cur };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === false) {
          delete (next as Record<string, unknown>)[k];
        } else {
          (next as Record<string, unknown>)[k] = v;
        }
      }
      return next;
    };
    if (yStyles) {
      collab.session?.doc.transact(() => {
        for (const ref of list) {
          const key = `${id}:${ref}`;
          yStyles.set(key, merge((yStyles.get(key) as CellStyle | undefined) ?? {}));
        }
      });
    } else {
      const styles = { ...(activeTab?.styles ?? {}) };
      for (const ref of list) styles[ref] = merge(styles[ref] ?? {});
      patchActiveTab({ styles });
    }
    scheduleSave();
  };

  const resetPointing = () => {
    setPointStart(null);
    setPointAnchor(null);
    setPointFocus(null);
  };

  const commit = () => {
    if (editing) {
      /**
       * Two things you can type into a cell that aren't formulas.
       *
       * `=autosum` resolves HERE, deterministically — no model, no network,
       * no proposal to approve, because it is arithmetic over the cells
       * adjacent to this one rather than a guess about intent. It becomes a
       * real `=SUM(range)` and lands like any other formula, so undo, the
       * formula bar and the engine all treat it as exactly what it is. With
       * nothing adjacent to total, what was typed is left alone rather than
       * writing a `=SUM()` over nothing.
       *
       * `=ai …` is the opposite and stays the opposite: it opens the
       * assistant with the request, and whatever comes back is a proposal
       * with a preview and an Apply button, never a direct write. The cell
       * keeps whatever it held before.
       */
      const directive = sheet ? parseCellDirective(draft) : null;
      if (directive?.kind === "autosum" && sheet) {
        const formula = resolveAutosum(sheet, editing);
        setCell(editing, formula ?? draft);
        if (!formula) setError("There's nothing next to that cell to total.");
      } else if (directive?.kind === "ask") {
        setCellPrompt({ ref: editing, text: directive.text });
        setShowAssistant(true);
      } else {
        setCell(editing, draft);
      }
    }
    setEditing(null);
    setAcHidden(false);
    resetPointing();
  };

  const beginEdit = (ref: string, seed: string, at: "cell" | "bar" = "cell") => {
    setEditing(ref);
    setDraft(seed);
    setEditAt(at);
    setAcHidden(false);
    setAcIndex(0);
    resetPointing();
  };

  const onDraft = (value: string) => {
    /* Typing ends pointing — the reference just placed becomes ordinary text, so
       the next click starts a fresh one rather than replacing it. */
    setDraft(value);
    setAcHidden(false);
    setAcIndex(0);
    resetPointing();
  };

  /**
   * Point a cell (or a dragged range) into the formula being edited.
   *
   * The reference is written from `pointStart` — where it began — to the end, so
   * a click replaces a click and a drag replaces the frame before it, rather than
   * stacking `A1A2A3…` as the cursor moves. The prefix before `pointStart` is the
   * formula the person actually typed and is never touched.
   */
  const pointAt = (row: number, col: number, isDrag: boolean) => {
    const start = pointStart ?? draft.length;
    const anchorCell = isDrag && pointAnchor ? pointAnchor : { row, col };
    const focusCell = { row, col };
    const ref = rangeLabel(normalizeRange(anchorCell, focusCell));
    setPointStart(start);
    setPointAnchor(anchorCell);
    setPointFocus(focusCell);
    setAcHidden(true);
    setDraft((d) => d.slice(0, start) + ref);
  };

  /* ── Selection ─────────────────────────────────────────────────────────── */

  const selectTo = (row: number, col: number, extend: boolean) => {
    if (!sheet) return;
    const r = Math.max(0, Math.min(sheet.rows - 1, row));
    const c = Math.max(0, Math.min(sheet.cols - 1, col));
    if (extend) setAnchor((a) => a ?? active);
    else setAnchor(null);
    setActive(cellRef(r, c));
  };

  /* Whole-band selection.
     A band is expressed in the existing two-corner model rather than as a new
     kind of selection: every column from `fromCol` to `toCol`, spanning every
     row. Everything downstream — the formatting toolbar, copy, the summary,
     conditional rules — already operates on `selRect` and so needs no change.
     The focus cell is put on the LAST header touched, which is what the formula
     bar names and where typing would land, matching a spreadsheet. */
  const selectColumns = (fromCol: number, toCol: number) => {
    if (!sheet) return;
    const a = Math.max(0, Math.min(sheet.cols - 1, fromCol));
    const b = Math.max(0, Math.min(sheet.cols - 1, toCol));
    setAnchor(cellRef(sheet.rows - 1, a));
    setActive(cellRef(0, b));
  };

  const selectRows = (fromRow: number, toRow: number) => {
    if (!sheet) return;
    const a = Math.max(0, Math.min(sheet.rows - 1, fromRow));
    const b = Math.max(0, Math.min(sheet.rows - 1, toRow));
    setAnchor(cellRef(a, sheet.cols - 1));
    setActive(cellRef(b, 0));
  };

  const selectEverything = () => {
    if (!sheet) return;
    setAnchor(cellRef(sheet.rows - 1, sheet.cols - 1));
    setActive("A1");
  };

  /* Shared by every header: whatever was being typed is committed first, the
     way clicking a cell does, and the grid takes focus so the keyboard keeps
     working on the new selection. */
  const beginHeaderSelection = () => {
    if (editing) commit();
    setEditing(null);
    setSelectedChart(null);
    setSelectedRule(null);
    dragging.current = false;
    pointing.current = false;
    gridRef.current?.focus();
  };

  const move = (dRow: number, dCol: number, extend = false) => {
    const at = parseRef(active);
    if (!at) return;
    selectTo(at.row + dRow, at.col + dCol, extend);
  };

  /* The selected rectangle, resolved once for the whole render. */
  const focusPos = parseRef(active);
  const anchorPos = anchor ? parseRef(anchor) : focusPos;
  const selRect =
    focusPos && anchorPos ? normalizeRange(anchorPos, focusPos) : null;

  /* The range a formula is currently pointing at, ringed so it is obvious which
     cells `=SUM(…)` is about to take in. */
  const pointRect =
    pointAnchor && pointFocus ? normalizeRange(pointAnchor, pointFocus) : null;

  const rectRefs = (): string[] => {
    if (!selRect) return [];
    const refs: string[] = [];
    for (let r = selRect.top; r <= selRect.bottom; r++)
      for (let c = selRect.left; c <= selRect.right; c++)
        refs.push(cellRef(r, c));
    return refs;
  };

  const clearRange = () => {
    const refs = rectRefs();
    if (refs.length <= 1) {
      setCell(active, "");
      return;
    }
    writeCells(refs.map((ref) => [ref, ""] as [string, string]));
  };

  /* Strip formatting from the selection, leaving the values — Excel's "Clear
     formats". Deletes the whole style entry rather than blanking keys, so the
     document shrinks back. */
  const clearFormats = () => {
    const id = activeTab?.id;
    if (readOnly || !id) return;
    const list = selRect ? rectRefs() : [active];
    if (yStyles) {
      collab.session?.doc.transact(() => {
        for (const ref of list) yStyles.delete(`${id}:${ref}`);
      });
    } else {
      const styles = { ...(activeTab?.styles ?? {}) };
      for (const ref of list) delete styles[ref];
      patchActiveTab({ styles });
    }
    scheduleSave();
  };

  /** The selection as a tab/newline table, so it pastes into Excel or back here. */
  const rangeToText = (): string => {
    if (!selRect) return rawCells[active] ?? "";
    const lines: string[] = [];
    for (let r = selRect.top; r <= selRect.bottom; r++) {
      const row: string[] = [];
      for (let c = selRect.left; c <= selRect.right; c++)
        row.push(rawCells[cellRef(r, c)] ?? "");
      lines.push(row.join("\t"));
    }
    return lines.join("\n");
  };

  /* Drop a clipboard table into the grid from the active cell down-and-right.
     Shared by the native paste event and the context menu's Paste, so both land
     in exactly the same place with the same bounds-clipping. */
  const pasteText = (text: string) => {
    if (readOnly || !text || !sheet) return;
    const at = parseRef(active);
    if (!at) return;
    const entries: [string, string][] = [];
    parseClipboardTable(text).forEach((line, dr) =>
      line.forEach((val, dc) => {
        const r = at.row + dr;
        const c = at.col + dc;
        if (r < sheet.rows && c < sheet.cols) entries.push([cellRef(r, c), val]);
      }),
    );
    writeCells(entries);
  };

  /* Drop an already-parsed 2D grid (CSV, or one XLSX sheet's cells) at a given
     anchor — the same shape of write as `pasteText` just above, generalised
     to a grid that did not come off the clipboard. Both funnel through
     `writeCells`, the one bulk-cell-write path, rather than each import format
     inventing its own way to reach the sheet's cells. */
  const importGrid = (grid: string[][], atRef: string) => {
    if (readOnly || !sheet) return;
    const at = parseRef(atRef);
    if (!at) return;
    const entries: [string, string][] = [];
    grid.forEach((line, dr) =>
      line.forEach((val, dc) => {
        const r = at.row + dr;
        const c = at.col + dc;
        if (r < sheet.rows && c < sheet.cols) entries.push([cellRef(r, c), val]);
      }),
    );
    writeCells(entries);
  };

  /* Same download convention `DocumentEditor.tsx`'s `download()` uses: a Blob,
     an off-screen anchor, revoke after the click. */
  const downloadBlob = (data: BlobPart, filename: string, type: string) => {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const fileBaseName = () =>
    doc.data?.title.replace(/[^\w\d -]+/g, "").trim() || "sheet";

  const exportCsvFile = () => {
    if (!sheet) return;
    downloadBlob(writeCsv(sheet), `${fileBaseName()}.csv`, "text/csv;charset=utf-8");
  };

  const importCsvFile = async (file: File) => {
    const text = await file.text();
    importGrid(readCsv(text), "A1");
  };

  const exportXlsxFile = async () => {
    if (!workbook) return;
    const { workbookToXlsx } = await import("@/lib/rules/sheets/xlsx");
    const bytes = workbookToXlsx(workbook);
    downloadBlob(
      bytes,
      `${fileBaseName()}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  };

  /**
   * "Save As" — a full copy, under a new document, left where it is rather
   * than opened: this component has no `onOpen`-style navigation prop (only
   * `onClose`/`onNew`, for leaving or starting BLANK), and threading one in
   * just for this would touch every caller between here and the workspace
   * router. The copy is real and immediately findable from the sheets list
   * the moment this returns — `notifyRepositoryChanged` is what makes it
   * show up there without a manual refresh.
   */
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const duplicateSheet = async () => {
    if (!doc.data || !workbook) return;
    setDuplicateNotice(null);
    const created = await getRepository().createDocument({
      title: `Copy of ${doc.data.title}`,
      kind: "sheet",
    });
    if (!created.ok) {
      setError(created.message);
      return;
    }
    const saved = await getRepository().saveDocumentBody(created.data.id, {
      cells: writeWorkbook(workbook),
    });
    if (!saved.ok) {
      setError(saved.message);
      return;
    }
    notifyRepositoryChanged();
    setDuplicateNotice(`Saved as "${created.data.title}" — open it from the sheets list.`);
  };

  /**
   * Print — the grid is normally virtualized to the rows on screen (see the
   * windowing note near `rowOffsets`), so printing it as-is would print whatever
   * happened to be scrolled into view. This forces every row into the render
   * window first, waits two frames for that to actually paint (one for the
   * state to commit, one for layout), prints, then restores the real
   * viewport/scroll the person had — printing must not permanently change
   * what they were looking at.
   */
  const printSheet = () => {
    if (!sheet) return;
    const prevViewportH = viewportH;
    const prevScrollTop = scrollTop;
    setViewportH(totalContentH + DEFAULT_CELL_H);
    setScrollTop(0);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.body.classList.add("sheet-printing");
        const cleanup = () => {
          document.body.classList.remove("sheet-printing");
          setViewportH(prevViewportH);
          setScrollTop(prevScrollTop);
        };
        window.addEventListener("afterprint", cleanup, { once: true });
        window.print();
      });
    });
  };

  /**
   * Land an imported workbook's sheets as NEW tabs, appended after whatever is
   * already here — never a silent replace of a document someone is already
   * working in. Every new tab gets a fresh id and a name disambiguated
   * against the existing ones, and (like `deleteSheet`/`applyStructuralEdit`
   * elsewhere in this file) writes straight into the shared `yCells`/`yStyles`
   * maps under that id's own prefix when collaborating — brand-new keys, so
   * there is nothing of anyone else's to race with. Sheets past the
   * `MAX_SHEETS` ceiling are dropped with a message rather than silently lost.
   */
  const importWorkbookTabs = (imported: Workbook) => {
    if (readOnly || !workbook) return;
    const room = MAX_SHEETS - workbook.sheets.length;
    if (room <= 0) {
      setError(`This document is already at the ${MAX_SHEETS}-sheet limit — nothing was imported.`);
      return;
    }
    const existingNames = new Set(workbook.sheets.map((s) => s.name));
    const incoming = imported.sheets.slice(0, room);
    const withNewIds: SheetTab[] = incoming.map((t, i) => {
      let name = t.name || `Sheet ${workbook.sheets.length + i + 1}`;
      let n = 1;
      const base = name;
      while (existingNames.has(name)) name = `${base} (${++n})`;
      existingNames.add(name);
      return { ...t, id: newId(`sheet-import-${Date.now()}-${i}`), name };
    });

    if (yCells) {
      collab.session?.doc.transact(() => {
        for (const t of withNewIds) {
          for (const [ref, value] of Object.entries(t.cells)) yCells.set(`${t.id}:${ref}`, value);
          if (yStyles)
            for (const [ref, style] of Object.entries(t.styles)) yStyles.set(`${t.id}:${ref}`, style);
          if (yCharts && t.charts?.length)
            yCharts.insert(yCharts.length, t.charts.map((c) => ({ ...c, sheetId: t.id })));
          if (yConds && t.conditionals?.length)
            yConds.insert(yConds.length, t.conditionals.map((r) => ({ ...r, sheetId: t.id })));
        }
      });
    }
    /* When collaborating, cells/styles live in `yCells`/`yStyles` (just
       written above) and `sheetDataFor` reads them by prefix — so the tab
       entry itself carries none of that, the same split `applyStructuralEdit`
       keeps elsewhere in this file. Solo, there is no Yjs map to hold it, so
       the tab is the only place it can live. */
    const newTabs: SheetTab[] = withNewIds.map((t) =>
      yCells ? { id: t.id, name: t.name, cells: {}, styles: {}, rows: t.rows, cols: t.cols } : t,
    );
    setWorkbook((wb) =>
      wb ? { ...wb, sheets: [...wb.sheets, ...newTabs], activeId: newTabs[0]?.id ?? wb.activeId } : wb,
    );
    resetSelectionForTabSwitch();
    scheduleSave();
    if (incoming.length < imported.sheets.length)
      window.alert(
        `Only the first ${incoming.length} sheet(s) were imported — this document is at the ${MAX_SHEETS}-sheet limit.`,
      );
  };

  const importXlsxFile = async (file: File) => {
    const bytes = await file.arrayBuffer();
    const { xlsxToWorkbook } = await import("@/lib/rules/sheets/xlsx");
    importWorkbookTabs(xlsxToWorkbook(bytes));
  };

  /* Fill down / right, with relative references adjusted the Excel way. A single
     selected cell fills FROM the one above (down) or to its left (right); a range
     fills its top row down / left column across. */
  const fill = (dir: "down" | "right") => {
    if (readOnly || !selRect) return;
    const entries: [string, string][] = [];
    const put = (r: number, c: number, sr: number, sc: number) => {
      const raw = rawCells[cellRef(sr, sc)] ?? "";
      entries.push([
        cellRef(r, c),
        isFormula(raw) ? offsetReferences(raw, r - sr, c - sc) : raw,
      ]);
    };
    if (dir === "down") {
      const multi = selRect.top !== selRect.bottom;
      for (let c = selRect.left; c <= selRect.right; c++) {
        if (multi)
          for (let r = selRect.top + 1; r <= selRect.bottom; r++)
            put(r, c, selRect.top, c);
        else if (selRect.top > 0) put(selRect.top, c, selRect.top - 1, c);
      }
    } else {
      const multi = selRect.left !== selRect.right;
      for (let r = selRect.top; r <= selRect.bottom; r++) {
        if (multi)
          for (let c = selRect.left + 1; c <= selRect.right; c++)
            put(r, c, r, selRect.left);
        else if (selRect.left > 0) put(r, selRect.left, r, selRect.left - 1);
      }
    }
    writeCells(entries);
  };

  /* ── Charts (embedded objects) ─────────────────────────────────────────── */

  const topChartZ = () => rawCharts.reduce((m, c) => Math.max(m, c.z ?? 1), 0);

  /**
   * The one place a chart is actually created. `insertChart` (the toolbar's
   * "＋ Chart" control) derives its range and title from the current
   * selection and an ordinal; `dispatch({type:"createChart"})` — the AI
   * assistant's tool — supplies both explicitly, since the range it proposes
   * is rarely what happens to be selected right now.
   */
  const insertChartAt = (range: string, type: ChartType, title: string) => {
    const id = activeTab?.id;
    if (readOnly || !id) return;
    /* Drop it into the current viewport, staggered so several don't stack. */
    const stagger = (rawCharts.length % 6) * 24;
    const spec: ChartSpec = {
      id: newId(`chart-${rawCharts.length}-${range}`),
      type,
      range,
      title,
      x: HEAD_W + 12 + stagger,
      y: scrollTop + DEFAULT_CELL_H + 12 + stagger,
      w: CHART_DEFAULT_W,
      h: CHART_DEFAULT_H,
      z: topChartZ() + 1,
    };
    if (yCharts) yCharts.push([{ ...spec, sheetId: id }]);
    else patchActiveTab({ charts: [...(activeTab?.charts ?? []), spec] });
    setCfOpen(false);
    setSelectedChart(spec.id);
    scheduleSave();
  };

  const insertChart = (type: ChartType) => {
    if (readOnly) return;
    const range = selRect ? rangeLabel(selRect) : active;
    insertChartAt(range, type, `Chart ${rawCharts.length + 1}`);
  };

  /* Patch one chart in place. A CRDT array has no set-at-index, so it is a
     delete-then-insert at the same position, which keeps the paint order. */
  const updateChart = (id: string, patch: Partial<ChartSpec>) => {
    if (readOnly) return;
    if (yCharts) {
      const i = yCharts.toArray().findIndex((c) => c.id === id);
      if (i >= 0) {
        const cur = yCharts.get(i);
        collab.session?.doc.transact(() => {
          yCharts.delete(i, 1);
          yCharts.insert(i, [{ ...cur, ...patch }]);
        });
      }
    } else {
      patchActiveTab({
        charts: (activeTab?.charts ?? []).map((c) =>
          c.id === id ? { ...c, ...patch } : c,
        ),
      });
    }
    scheduleSave();
  };

  const removeChart = (id: string) => {
    if (readOnly) return;
    if (yCharts) {
      const i = yCharts.toArray().findIndex((c) => c.id === id);
      if (i >= 0) yCharts.delete(i, 1);
    } else {
      patchActiveTab({ charts: (activeTab?.charts ?? []).filter((c) => c.id !== id) });
    }
    if (selectedChart === id) setSelectedChart(null);
    scheduleSave();
  };

  const duplicateChart = (id: string) => {
    const tabId = activeTab?.id;
    if (readOnly || !tabId) return;
    const src = rawCharts.find((c) => c.id === id);
    if (!src) return;
    const copy: ChartSpec = {
      ...src,
      id: newId(`chart-${rawCharts.length}-copy`),
      title: `${src.title} copy`,
      x: (src.x ?? 24) + 24,
      y: (src.y ?? 24) + 24,
      z: topChartZ() + 1,
    };
    if (yCharts) yCharts.push([{ ...copy, sheetId: tabId }]);
    else patchActiveTab({ charts: [...(activeTab?.charts ?? []), copy] });
    setSelectedChart(copy.id);
    scheduleSave();
  };

  /* Bring forward / send backward. Rendering sorts by `z`, so it is enough to
     push this chart just past the current top or bottom of the stack. */
  const restackChart = (id: string, dir: 1 | -1) => {
    if (readOnly || rawCharts.length < 2) return;
    const zs = rawCharts.map((c) => c.z ?? 1);
    updateChart(id, {
      z: dir === 1 ? Math.max(...zs) + 1 : Math.min(...zs) - 1,
    });
  };

  /* ── Conditional formatting ────────────────────────────────────────────── */

  /* Sensible starting values so a fresh rule already does something visible and
     the panel's inputs are populated rather than empty. */
  const ruleDefaults = (kind: ConditionalKind): Partial<ConditionalRule> => {
    switch (kind) {
      case "greater":
      case "greaterEqual":
      case "less":
      case "lessEqual":
      case "equal":
      case "notEqual":
        return { value: 0 };
      case "between":
      case "notBetween":
        return { value: 0, value2: 100 };
      case "textContains":
      case "textStarts":
      case "textEnds":
        return { text: "" };
      case "top":
      case "bottom":
      case "topPercent":
      case "bottomPercent":
        return { value: 10 };
      case "iconSet":
        return { iconSet: "arrows" };
      default:
        return {};
    }
  };

  const addRule = (kind: ConditionalKind) => {
    const tabId = activeTab?.id;
    if (readOnly || !tabId) return;
    const rule: ConditionalRule = {
      id: newId(`cf-${rawConds.length}`),
      range: selRect ? rangeLabel(selRect) : active,
      kind,
      ...ruleDefaults(kind),
    };
    if (yConds) yConds.push([{ ...rule, sheetId: tabId }]);
    else patchActiveTab({ conditionals: [...(activeTab?.conditionals ?? []), rule] });
    setSelectedRule(rule.id);
    scheduleSave();
  };

  /* Merge a patch and DROP any key set to undefined, so "clear this" (a removed
     fill, an enabled toggle back to its default) shrinks the rule rather than
     storing an undefined the CRDT would keep replicating. */
  const mergeRule = (
    cur: ConditionalRule,
    patch: Partial<ConditionalRule>,
  ): ConditionalRule => {
    const merged = { ...cur, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(merged))
      if (merged[k] === undefined) delete merged[k];
    return merged as unknown as ConditionalRule;
  };

  const updateRule = (id: string, patch: Partial<ConditionalRule>) => {
    if (readOnly) return;
    if (yConds) {
      const i = yConds.toArray().findIndex((r) => r.id === id);
      if (i >= 0) {
        const cur = yConds.get(i);
        collab.session?.doc.transact(() => {
          yConds.delete(i, 1);
          yConds.insert(i, [mergeRule(cur, patch)]);
        });
      }
    } else {
      patchActiveTab({
        conditionals: (activeTab?.conditionals ?? []).map((r) =>
          r.id === id ? mergeRule(r, patch) : r,
        ),
      });
    }
    scheduleSave();
  };

  const removeRule = (id: string) => {
    if (readOnly) return;
    if (yConds) {
      const i = yConds.toArray().findIndex((r) => r.id === id);
      if (i >= 0) yConds.delete(i, 1);
    } else {
      patchActiveTab({
        conditionals: (activeTab?.conditionals ?? []).filter((r) => r.id !== id),
      });
    }
    if (selectedRule === id) setSelectedRule(null);
    scheduleSave();
  };

  const duplicateRule = (id: string) => {
    const tabId = activeTab?.id;
    if (readOnly || !tabId) return;
    const src = rawConds.find((r) => r.id === id);
    if (!src) return;
    const copy: ConditionalRule = { ...src, id: newId(`cf-${rawConds.length}`) };
    if (yConds) yConds.push([{ ...copy, sheetId: tabId }]);
    else patchActiveTab({ conditionals: [...(activeTab?.conditionals ?? []), copy] });
    setSelectedRule(copy.id);
    scheduleSave();
  };

  /* Reorder by rebuilding the array — rules apply top-to-bottom, so priority IS
     array position, but the array is shared across every tab, so only the
     ACTIVE tab's rules are reordered; the others are left in place (in the
     combined array, not necessarily interleaved as before — order across
     different tabs' rules is meaningless, only within a tab). One transaction,
     so a reorder is a single merge. */
  const moveRule = (id: string, toIndex: number) => {
    const tabId = activeTab?.id;
    if (readOnly || !tabId) return;
    const arr = [...rawConds];
    const from = arr.findIndex((r) => r.id === id);
    if (from < 0) return;
    const [rule] = arr.splice(from, 1);
    arr.splice(Math.max(0, Math.min(arr.length, toIndex)), 0, rule);
    if (yConds) {
      const others = yConds.toArray().filter((r) => r.sheetId !== tabId);
      const mine = arr.map((r) => ({ ...r, sheetId: tabId }));
      collab.session?.doc.transact(() => {
        yConds.delete(0, yConds.length);
        yConds.insert(0, [...others, ...mine]);
      });
    } else {
      patchActiveTab({ conditionals: arr });
    }
    scheduleSave();
  };

  /* The two right-side panels are mutually exclusive — opening one closes the
     other, so the sheet never has two panels fighting for the edge. */
  const openConditionalPanel = () => {
    setSelectedChart(null);
    setCfOpen(true);
  };

  /* ── Sheet tabs ────────────────────────────────────────────────────────── */

  /* Selection state is per-cell, not per-workbook, so switching tabs resets
     it the way opening a different sheet in Excel does — the previous tab's
     chart/rule selection would otherwise point at ids that don't exist here. */
  const resetSelectionForTabSwitch = () => {
    setActive("A1");
    setAnchor(null);
    setEditing(null);
    setSelectedChart(null);
    setSelectedRule(null);
  };

  const selectTab = (id: string) => {
    if (!workbook || id === workbook.activeId) return;
    setWorkbook((wb) => (wb ? { ...wb, activeId: id } : wb));
    resetSelectionForTabSwitch();
    scheduleSave();
  };

  const addSheet = () => {
    if (readOnly || !workbook) return;
    /* Said out loud rather than returned from silently. The import path already
       explains this ceiling (see `MAX_SHEETS` above); the add button used to
       just do nothing, which is indistinguishable from a broken button. */
    if (workbook.sheets.length >= MAX_SHEETS) {
      setError(`This document is at the ${MAX_SHEETS}-sheet limit — delete a sheet before adding another.`);
      return;
    }
    const existing = new Set(workbook.sheets.map((s) => s.name));
    let n = workbook.sheets.length + 1;
    while (existing.has(`Sheet ${n}`)) n++;
    const id = newId(`sheet-${workbook.sheets.length + 1}-${Date.now()}`);
    const tab: SheetTab = {
      id,
      name: `Sheet ${n}`,
      cells: {},
      styles: {},
      rows: DEFAULT_ROWS,
      cols: DEFAULT_COLS,
    };
    setWorkbook((wb) => (wb ? { ...wb, sheets: [...wb.sheets, tab], activeId: id } : wb));
    resetSelectionForTabSwitch();
    scheduleSave();
  };

  /* Renaming to a name another tab already has is refused rather than
     disambiguated for you — the same "the last one can't go" spirit as
     `deleteSheet` below (`lib/rules/mindmap/tree.ts`'s `deleteNode` refuses to
     delete the root the same way): a silent auto-rename would let two clicks
     land you on a tab whose name isn't what you typed. HyperFormula also
     needs names unique to resolve `Sheet2!A1`, so this isn't just cosmetic. */
  const renameSheet = (id: string, name: string) => {
    if (readOnly || !workbook) return;
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) return;
    if (workbook.sheets.some((s) => s.id !== id && s.name === trimmed)) return;
    setWorkbook((wb) =>
      wb ? { ...wb, sheets: wb.sheets.map((s) => (s.id === id ? { ...s, name: trimmed } : s)) } : wb,
    );
    scheduleSave();
  };

  const colorSheet = (id: string, color: string) => {
    if (readOnly || !workbook) return;
    setWorkbook((wb) =>
      wb ? { ...wb, sheets: wb.sheets.map((s) => (s.id === id ? { ...s, color } : s)) } : wb,
    );
    scheduleSave();
  };

  /** Refuses to delete the workbook's last sheet, same as `deleteNode` refusing the mindmap's root. */
  const deleteSheet = (id: string) => {
    if (readOnly || !workbook || workbook.sheets.length <= 1) return;
    const idx = workbook.sheets.findIndex((s) => s.id === id);
    if (idx < 0) return;
    /* Same confirm-before-delete as `MessagesArea.tsx`'s own message delete —
       this removes a tab's cells/styles/charts immediately, with no separate
       trash to recover from, so one misclick should not be how a sheet goes
       away. */
    const tab = workbook.sheets[idx];
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete "${tab.name}"? This can't be undone.`)
    )
      return;
    const nextSheets = workbook.sheets.filter((s) => s.id !== id);
    const nextActive =
      workbook.activeId === id
        ? (nextSheets[Math.max(0, idx - 1)]?.id ?? nextSheets[0].id)
        : workbook.activeId;
    setWorkbook({ sheets: nextSheets, activeId: nextActive });
    if (yCells) {
      const prefix = `${id}:`;
      collab.session?.doc.transact(() => {
        for (const key of Array.from(yCells.keys()))
          if (key.startsWith(prefix)) yCells.delete(key);
        if (yStyles)
          for (const key of Array.from(yStyles.keys()))
            if (key.startsWith(prefix)) yStyles.delete(key);
        if (yCharts) {
          const kept = yCharts.toArray().filter((c) => c.sheetId !== id);
          yCharts.delete(0, yCharts.length);
          yCharts.insert(0, kept);
        }
        if (yConds) {
          const kept = yConds.toArray().filter((r) => r.sheetId !== id);
          yConds.delete(0, yConds.length);
          yConds.insert(0, kept);
        }
      });
    }
    resetSelectionForTabSwitch();
    scheduleSave();
  };

  /* ── Command seam ──────────────────────────────────────────────────────── */

  /* The single, immutable snapshot every menu and panel reads instead of the
     grid's scattered state. */
  const selection: SelectionState = {
    active,
    anchor,
    rect: selRect,
    editing,
    readOnly,
    hasRange:
      !!selRect &&
      (selRect.top !== selRect.bottom || selRect.left !== selRect.right),
  };

  /* The grid's one front door. Every external surface (the context menu now, the
     chart and conditional-formatting panels next) issues a plain command and
     this routes it to the handler that already exists — it adds no behaviour,
     it just gives those handlers a stable, testable entry point. Kept synchronous
     and side-effect-only, so it never disturbs the during-render engine feed. */
  const dispatch = (command: SheetCommand) => {
    switch (command.type) {
      case "undo":
        undoMgr?.undo();
        break;
      case "redo":
        undoMgr?.redo();
        break;
      case "copy":
        void navigator.clipboard?.writeText(rangeToText()).catch(() => {});
        break;
      case "cut":
        void navigator.clipboard?.writeText(rangeToText()).catch(() => {});
        clearRange();
        break;
      case "paste":
        void navigator.clipboard
          ?.readText()
          .then(pasteText)
          .catch(() => {});
        break;
      case "clearContents":
        clearRange();
        break;
      case "clearFormats":
        clearFormats();
        break;
      case "fillDown":
        fill("down");
        break;
      case "fillRight":
        fill("right");
        break;
      case "style":
        toggleStyle(command.patch);
        break;
      case "insertChart":
        insertChart(command.chartType);
        break;
      case "selectRange": {
        const rect = rangeToRect(command.range);
        if (rect) {
          setAnchor(cellRef(rect.top, rect.left));
          setActive(cellRef(rect.bottom, rect.right));
        }
        break;
      }
      case "beginEdit":
        beginEdit(command.ref, command.seed ?? "");
        break;
      case "writeCells":
        writeCells(command.cells.map((c) => [c.ref, c.value]));
        break;
      case "structuralEdit":
        applyStructuralEdit(command.next);
        break;
      case "setHiddenRows":
        if (!readOnly) {
          patchActiveTab({ hidden: command.hidden });
          scheduleSave();
        }
        break;
      case "createChart":
        insertChartAt(command.range, command.chartType, command.title);
        break;
      case "applyConditionalFormat": {
        if (readOnly || !activeTab) break;
        const rule: ConditionalRule = { id: newId(`cf-${rawConds.length}`), ...command.rule };
        if (yConds) yConds.push([{ ...rule, sheetId: activeTab.id }]);
        else patchActiveTab({ conditionals: [...(activeTab.conditionals ?? []), rule] });
        scheduleSave();
        break;
      }
      case "styleCells":
        toggleStyle(command.patch, command.refs);
        break;
    }
  };

  /** Pixel position (content-relative, not viewport-relative — see the comment
   * on `resizeGuide`) of a row/column's FAR edge at a given size. Content-relative
   * because the guide line lives inside the same scrolled div as the table, so it
   * tracks the pointer correctly without reading scrollTop/scrollLeft at all. */
  const resizeEdge = (kind: "row" | "col", index: number, size: number): number =>
    kind === "row" ? rowOffsets[index] + size : HEAD_W + colOffsets[index] + size;

  /* Row/column resize — a plain pointer-capture drag on a handle at each header's
   * far edge, dragging a guide LINE rather than live-reflowing the grid (5,000
   * rows would make live reflow on every mousemove expensive, and a line is the
   * conventional spreadsheet affordance anyway). Nothing is written until the
   * pointer releases. */
  const startResize = (kind: "row" | "col", index: number, e: React.PointerEvent) => {
    if (readOnly || !sheet) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const startSize = kind === "row" ? rowHeightAt(index) : colWidthAt(index);
    resizeDrag.current = {
      kind,
      index,
      startClient: kind === "row" ? e.clientY : e.clientX,
      startSize,
      liveSize: startSize,
    };
    setResizeGuide({ kind, edge: resizeEdge(kind, index, startSize) });
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const d = resizeDrag.current;
    if (!d) return;
    const client = d.kind === "row" ? e.clientY : e.clientX;
    const delta = client - d.startClient;
    const minSize = d.kind === "row" ? MIN_ROW_HEIGHT : MIN_COL_WIDTH;
    const size = Math.max(minSize, d.startSize + delta);
    d.liveSize = size;
    setResizeGuide({ kind: d.kind, edge: resizeEdge(d.kind, d.index, size) });
  };
  const commitResize = () => {
    const d = resizeDrag.current;
    resizeDrag.current = null;
    setResizeGuide(null);
    if (!d || !sheet || readOnly) return;
    const next =
      d.kind === "row"
        ? resizeRow(sheet, d.index, d.liveSize)
        : resizeColumn(sheet, d.index, d.liveSize);
    dispatch({ type: "structuralEdit", next });
  };

  /* Row/column insert & delete — lib/rules/sheets/grid.ts has had
   * insertRows/deleteRows/insertColumns/deleteColumns since before this
   * comment, and applyStructuralEdit (above) was built specifically as
   * their landing spot, but nothing ever called them: no menu item, no
   * button, no shortcut. That gap — not a broken affordance, a complete
   * one with the door never opened — was the single largest "basic
   * feature" complaint. Operates on whatever rows/columns the CURRENT
   * SELECTION spans (Excel/Sheets convention: select 3 rows, "Insert 3
   * rows above" inserts 3), falling back to the active cell's own
   * row/column when nothing is selected — never requires first selecting
   * an entire row/column via its header.
   */
  const rowSpan = (): { at: number; count: number } => {
    const r = selRect ?? focusPos;
    if (!r) return { at: 0, count: 1 };
    const top = "top" in r ? r.top : r.row;
    const bottom = "bottom" in r ? r.bottom : r.row;
    return { at: top, count: bottom - top + 1 };
  };
  const colSpan = (): { at: number; count: number } => {
    const r = selRect ?? focusPos;
    if (!r) return { at: 0, count: 1 };
    const left = "left" in r ? r.left : r.col;
    const right = "right" in r ? r.right : r.col;
    return { at: left, count: right - left + 1 };
  };
  /* Every dispatch below reads `sheet`, never `activeTab`, as the data to
   * transform: `activeTab` is `workbook` state, which (see `sheetDataFor`
   * above) only carries cells/styles/charts/conditionals AT THE MOMENT THE
   * DOCUMENT LOADED when collaborating — live edits after that land in
   * `yCells`/`yStyles`/`yCharts`/`yConds`, not back into `workbook`. `sheet`
   * is the one place those are merged. Building `next` from `activeTab`
   * would hand `applyStructuralEdit` a stale cell/style/chart snapshot,
   * which it then writes OVER the live CRDT maps — silently reverting
   * every collaborator's edits made since page load.
   */
  const insertRowsAt = (belowSelection: boolean) => {
    if (!sheet) return;
    const { at, count } = rowSpan();
    dispatch({ type: "structuralEdit", next: insertRows(sheet, belowSelection ? at + count : at, count) });
  };
  const deleteRowsHere = () => {
    if (!sheet) return;
    const { at, count } = rowSpan();
    dispatch({ type: "structuralEdit", next: deleteRows(sheet, at, count) });
  };
  const insertColumnsAt = (rightOfSelection: boolean) => {
    if (!sheet) return;
    const { at, count } = colSpan();
    dispatch({ type: "structuralEdit", next: insertColumns(sheet, rightOfSelection ? at + count : at, count) });
  };
  const deleteColumnsHere = () => {
    if (!sheet) return;
    const { at, count } = colSpan();
    dispatch({ type: "structuralEdit", next: deleteColumns(sheet, at, count) });
  };
  const { count: rowCount } = rowSpan();
  const { count: colCount } = colSpan();

  /* The right-click menu's contents, derived from the current selection so items
     that cannot apply read as disabled rather than silently doing nothing. */
  const menuGroups = (): MenuAction[][] => [
    [
      { label: "Cut", shortcut: "⌘X", disabled: readOnly, onSelect: () => dispatch({ type: "cut" }) },
      { label: "Copy", shortcut: "⌘C", onSelect: () => dispatch({ type: "copy" }) },
      { label: "Paste", shortcut: "⌘V", disabled: readOnly, onSelect: () => dispatch({ type: "paste" }) },
    ],
    [
      { label: "Clear contents", shortcut: "Del", disabled: readOnly, onSelect: () => dispatch({ type: "clearContents" }) },
      { label: "Clear formatting", disabled: readOnly, onSelect: () => dispatch({ type: "clearFormats" }) },
    ],
    [
      { label: "Fill down", shortcut: "⌘D", disabled: readOnly || !selection.hasRange, onSelect: () => dispatch({ type: "fillDown" }) },
      { label: "Fill right", shortcut: "⌘R", disabled: readOnly || !selection.hasRange, onSelect: () => dispatch({ type: "fillRight" }) },
    ],
    [
      { label: rowCount > 1 ? `Insert ${rowCount} rows above` : "Insert row above", disabled: readOnly || !sheet, onSelect: () => insertRowsAt(false) },
      { label: rowCount > 1 ? `Insert ${rowCount} rows below` : "Insert row below", disabled: readOnly || !sheet, onSelect: () => insertRowsAt(true) },
      { label: rowCount > 1 ? `Delete ${rowCount} rows` : "Delete row", disabled: readOnly || !sheet || (sheet?.rows ?? 1) <= 1, onSelect: deleteRowsHere },
    ],
    [
      { label: colCount > 1 ? `Insert ${colCount} columns left` : "Insert column left", disabled: readOnly || !sheet, onSelect: () => insertColumnsAt(false) },
      { label: colCount > 1 ? `Insert ${colCount} columns right` : "Insert column right", disabled: readOnly || !sheet, onSelect: () => insertColumnsAt(true) },
      { label: colCount > 1 ? `Delete ${colCount} columns` : "Delete column", disabled: readOnly || !sheet || (sheet?.cols ?? 1) <= 1, onSelect: deleteColumnsHere },
    ],
    [
      { label: "Insert column chart", disabled: readOnly, onSelect: () => dispatch({ type: "insertChart", chartType: "column" }) },
    ],
  ];

  /* ── Autocomplete ──────────────────────────────────────────────────────── */

  const acPrefix = editing && !acHidden ? formulaFunctionPrefix(draft) : null;
  const acItems = acPrefix ? matchFunctionNames(acPrefix) : [];
  const acActive = Math.min(acIndex, Math.max(0, acItems.length - 1));

  const applySuggestion = (name: string) => {
    if (!acPrefix) return;
    setDraft((d) => d.slice(0, d.length - acPrefix.length) + name + "(");
    setAcHidden(false);
    setAcIndex(0);
  };

  /* Shared by the cell editor and the formula bar — the menu, when open, owns the
     arrows and Enter/Tab; otherwise they commit and move as usual. */
  const onEditorKeyDown = (e: React.KeyboardEvent) => {
    if (acItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAcIndex((i) => (i + 1) % acItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAcIndex((i) => (i - 1 + acItems.length) % acItems.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applySuggestion(acItems[acActive]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAcHidden(true);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      move(1, 0);
      refocusGrid();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(null);
      resetPointing();
      refocusGrid();
    } else if (e.key === "Tab") {
      e.preventDefault();
      commit();
      move(0, 1);
      refocusGrid();
    }
  };

  /**
   * Put keyboard focus back on the grid after an edit ends.
   *
   * Committing unmounts the cell's `<input>`, and with nothing focused the grid's
   * own key handler — the one that turns a keystroke into a new edit — never runs,
   * so the cell you just Tabbed to could not be typed into. Deferred a frame so
   * the input has unmounted first: focusing the grid while the input still holds
   * focus would fire its blur (and, on Escape, wrongly commit the discarded draft).
   */
  const refocusGrid = () => {
    requestAnimationFrame(() => gridRef.current?.focus());
  };

  /* ── Global mouse-up ends a drag even if it lands outside the grid ─────── */
  useEffect(() => {
    const up = () => {
      dragging.current = false;
      pointing.current = false;
      headerDrag.current = null;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  /* Follow the browser: Escape leaves fullscreen without the button, and the
     state must not be left claiming otherwise. This is the only writer, so
     there is no second meaning for it to disagree with. */
  useEffect(() => {
    const sync = () => setChromeless(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleChrome = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shell.current?.requestFullscreen?.();
    } catch {
      /* Refused by the browser. The grid already fills the window either way,
         so there is nothing to report and nothing to put back. */
    }
  };

  if (doc.isLoading || body.isLoading || !workbook || !activeTab || !sheet || !hf || activeHfId === undefined)
    return <StageSkeleton onClose={onClose} />;
  if (!doc.data)
    return <StageError message="This sheet is not available." onClose={onClose} />;

  const activeRaw = rawCells[active] ?? "";

  /* Whether the active cell is showing an error, for the formula-bar "Fix
     this formula" trigger below — same `getCellValue` + `displayValue` +
     `explainError` path the grid's own per-cell tooltip already uses,
     computed once here for just the one cell rather than read off whatever
     the grid last rendered. */
  const activeErrorHint = (() => {
    if (!isFormula(activeRaw)) return null;
    const pos = parseRef(active);
    if (!pos) return null;
    try {
      const value = hf.engine.getCellValue({
        sheet: activeHfId,
        row: pos.row,
        col: pos.col,
      });
      return explainError(displayValue(value));
    } catch {
      return explainError("#ERROR!");
    }
  })();

  /* The numeric value a cell shows — its formula RESULT or its typed number,
     nothing for a label or a blank. Feeds the selection summary. */
  const cellNumber = (r: number, c: number): number | null => {
    const raw = rawCells[cellRef(r, c)] ?? "";
    if (isFormula(raw)) {
      try {
        const v = hf.engine.getCellValue({ sheet: activeHfId, row: r, col: c });
        return isNumericDisplay(v) ? (v as number) : null;
      } catch {
        return null;
      }
    }
    return raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : null;
  };

  /* A cell as a CHART reads it — the evaluated text and its number — so a chart
     of `=A1*2` plots the result and labels come out as the shown strings. */
  const chartCell = (
    r: number,
    c: number,
  ): { text: string; number: number | null } => {
    const raw = rawCells[cellRef(r, c)] ?? "";
    const number = cellNumber(r, c);
    let text = raw;
    if (isFormula(raw)) {
      try {
        text = displayValue(
          hf.engine.getCellValue({ sheet: activeHfId, row: r, col: c }),
        );
      } catch {
        /* Matches the cell render's catch, so a rule's range stats key errors by
           the same "#ERROR!" the cell compares — duplicate/error rules line up. */
        text = "#ERROR!";
      }
    }
    return { text, number };
  };

  /* Each rule's summary over its OWN range — min/max for scales & bars, mean for
     above/below-average, the sorted values for top/bottom N, and per-value counts
     for duplicate/unique. One capped pass per rule (few rules, and the cap keeps
     a huge range from stalling the render), keyed by the SAME shown text the cell
     loop compares, so duplicate detection lines up. */
  const emptyStats: RuleStats = {
    min: 0,
    max: 0,
    mean: 0,
    count: 0,
    sortedDesc: [],
    textCounts: new Map(),
  };
  const ruleStats = new Map<string, RuleStats>();
  for (const rule of rawConds) {
    /* A disabled rule is never applied, so don't pay to measure its range. */
    if (rule.enabled === false) {
      ruleStats.set(rule.id, emptyStats);
      continue;
    }
    const rect = rangeToRect(rule.range);
    if (!rect) {
      ruleStats.set(rule.id, emptyStats);
      continue;
    }
    const nums: number[] = [];
    const textCounts = new Map<string, number>();
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let scanned = 0;
    for (let r = rect.top; r <= rect.bottom && scanned < 20000; r++)
      for (let c = rect.left; c <= rect.right && scanned < 20000; c++) {
        scanned++;
        const { text, number } = chartCell(r, c);
        if (number !== null) {
          nums.push(number);
          sum += number;
          if (number < min) min = number;
          if (number > max) max = number;
        }
        if (text !== "")
          textCounts.set(text, (textCounts.get(text) ?? 0) + 1);
      }
    ruleStats.set(
      rule.id,
      nums.length
        ? {
            min,
            max,
            mean: sum / nums.length,
            count: nums.length,
            sortedDesc: [...nums].sort((a, b) => b - a),
            textCounts,
          }
        : { ...emptyStats, textCounts },
    );
  }

  /* The status-bar figures for a real RANGE (a single cell shows nothing).
     Bounded so an enormous selection cannot stall a render. */
  const summary =
    selRect && (selRect.top !== selRect.bottom || selRect.left !== selRect.right)
      ? (() => {
          const nums: number[] = [];
          let scanned = 0;
          for (
            let r = selRect.top;
            r <= selRect.bottom && scanned < 20000;
            r++
          )
            for (
              let c = selRect.left;
              c <= selRect.right && scanned < 20000;
              c++
            ) {
              scanned++;
              const n = cellNumber(r, c);
              if (n !== null) nums.push(n);
            }
          return summarize(nums);
        })()
      : null;

  /* Charts painted back-to-front by their `z`; the render index becomes the
     actual z-index (kept under the sticky headers). */
  const orderedCharts = [...rawCharts].sort((a, b) => (a.z ?? 1) - (b.z ?? 1));
  const selectedChartSpec =
    rawCharts.find((c) => c.id === selectedChart) ?? null;

  /* The row window. A binary search into `rowOffsets` (the prefix sums) rather
     than a measurement — cheap even at 5,000 rows, and correct whether every row
     is DEFAULT_CELL_H or a mix of resized ones. */
  const first = Math.max(0, indexAtOffset(rowOffsets, scrollTop) - OVERSCAN);
  const last = Math.min(
    sheet.rows,
    indexAtOffset(rowOffsets, scrollTop + viewportH) + 1 + OVERSCAN,
  );

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => setScrollTop(top));
  };

  return (
    /* One shape — the stage owns the frame, this owns the sheet inside it. */
    <div ref={shell} className="flex h-full min-h-0 flex-col bg-[var(--body-bg)]">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline bg-[var(--surface-raised)] px-3 py-2">
        {/* The grid fills the window, so the way back is chrome rather than
            something behind it. Same corner, same glyph as a document's. */}
        {onClose && (
          <button
            type="button"
            aria-label="Back to all sheets"
            title="Back to all sheets"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-inset bg-[var(--control)] text-ink-muted transition-colors hover:bg-[var(--control-hover)] hover:text-ink"
          >
            <DocIcon.chevronLeft className="h-4 w-4" />
          </button>
        )}
        <span className="min-w-0 flex-1 truncate text-[15px] text-ink">
          {doc.data.title}
        </span>
        {onNew && (
          <button
            type="button"
            aria-label="New sheet"
            title="New sheet"
            disabled={creating}
            onClick={onNew}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-inset text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink disabled:opacity-40"
          >
            <DocIcon.plus className="h-4 w-4" />
          </button>
        )}
        <Popover
          label="File actions for this sheet"
          title="File"
          width={200}
          render={() => (
            <>
              <MenuItem
                label="Save as a copy…"
                icon={<Icon.attach className="h-3.5 w-3.5" />}
                note="A new sheet, in the list."
                onSelect={() => void duplicateSheet()}
              />
              <MenuItem
                label="Print"
                icon={<DocIcon.download className="h-3.5 w-3.5" />}
                onSelect={printSheet}
              />
              <MenuSeparator />
              <MenuItem
                label="Import CSV…"
                icon={<Icon.attach className="h-3.5 w-3.5" />}
                disabled={readOnly}
                note={readOnly ? "You can't edit this sheet." : "Writes into cells from A1."}
                onSelect={() => csvInputRef.current?.click()}
              />
              <MenuItem
                label="Export CSV"
                icon={<DocIcon.download className="h-3.5 w-3.5" />}
                onSelect={exportCsvFile}
              />
              <MenuSeparator />
              <MenuItem
                label="Import XLSX…"
                icon={<Icon.attach className="h-3.5 w-3.5" />}
                disabled={readOnly}
                note={readOnly ? "You can't edit this sheet." : "Adds each sheet as a new tab."}
                onSelect={() => xlsxInputRef.current?.click()}
              />
              <MenuItem
                label="Export XLSX"
                icon={<DocIcon.download className="h-3.5 w-3.5" />}
                onSelect={() => void exportXlsxFile()}
              />
            </>
          )}
        >
          <DocIcon.download className="h-4 w-4" />
        </Popover>
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importCsvFile(file);
          }}
        />
        <input
          ref={xlsxInputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importXlsxFile(file);
          }}
        />
        {myRole && myRole !== "owner" && (
          <span className="rounded-full bg-[var(--control)] px-2 py-0.5 text-[10px] text-ink-muted">
            {myRole === "viewer" ? "View only" : "Editor"}
          </span>
        )}
        {canManage(doc.data, me.data?.id ?? null) && (
          <ShareMenu
            target={{ kind: "document", id: doc.data.id, noun: "document" }}
            members={doc.data.members}
            onChanged={doc.refetch}
          />
        )}
        {!readOnly && sheet.hidden && sheet.hidden.length > 0 && (
          <button
            type="button"
            onClick={() => {
              patchActiveTab({ hidden: [] });
              scheduleSave();
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--control)] px-2 py-0.5 text-[10px] text-ink-muted hover:bg-[var(--control-hover)] hover:text-ink"
            title="A filter is hiding rows on this sheet"
          >
            <span data-figure>{sheet.hidden.length}</span> rows hidden · Show all
          </button>
        )}
        {collab.connected && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--control)] px-2 py-0.5 text-[10px] text-ink-muted">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--state-positive)" }}
            />
            {collab.peers > 0 ? (
              <>
                <span data-figure>{collab.peers + 1}</span> editing
              </>
            ) : (
              "Live"
            )}
          </span>
        )}
        {!readOnly && (
          <button
            type="button"
            aria-label={showAssistant ? "Close assistant" : "Open assistant"}
            aria-pressed={showAssistant}
            title="Assistant (Gemini Flash-Lite)"
            onClick={() => setShowAssistant((v) => !v)}
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-inset transition-colors hover:bg-[var(--control)] hover:text-ink ${
              showAssistant ? "bg-[var(--control-active)] text-ink" : "text-ink-muted"
            }`}
          >
            <Icon.chat className="h-4 w-4" />
          </button>
        )}
        {/* Named for what it does. The sheet is already the whole window; the
            only thing left to hide is the browser's own tabs and address bar. */}
        <button
          type="button"
          aria-label={chromeless ? "Show browser chrome" : "Hide browser chrome"}
          aria-pressed={chromeless}
          title={
            chromeless
              ? "Show the browser's tabs and address bar (Esc)"
              : "Hide the browser's tabs and address bar"
          }
          onClick={() => void toggleChrome()}
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-inset transition-colors hover:bg-[var(--control)] hover:text-ink ${
            chromeless ? "bg-[var(--control-active)] text-ink" : "text-ink-muted"
          }`}
        >
          <DocIcon.fullscreen className="h-4 w-4" />
        </button>
      </header>

      {/* Formula bar — the reference (or range), then what was typed. */}
      <div className="relative flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-1.5">
        <span
          data-figure
          className="w-20 shrink-0 truncate rounded-inset bg-[var(--control)] px-2 py-0.5 text-center text-[11px] text-ink"
        >
          {selRect ? rangeLabel(selRect) : active}
        </span>
        <span aria-hidden="true" className="text-[11px] text-ink-faint">fx</span>
        <input
          aria-label={`Formula for ${active}`}
          value={editing === active ? draft : activeRaw}
          readOnly={readOnly}
          onFocus={() => beginEdit(active, activeRaw, "bar")}
          onChange={(e) => onDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onEditorKeyDown}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none"
          placeholder={readOnly ? "" : "Type a value, or =SUM(A1:A9)"}
        />
        {editing === active && editAt === "bar" && acItems.length > 0 && (
          <FnMenu
            items={acItems}
            active={acActive}
            className="left-24 top-full"
            onPick={applySuggestion}
          />
        )}
        {/* One click into the same `=ai …` bridge — "Explain this
            formula"/"Fix this formula" already work end to end through the
            assistant chat, they were just undiscoverable behind typing the
            directive by hand. Shown only for a formula cell, and only the
            "Fix" variant when it is actually erroring. */}
        {!readOnly && isFormula(activeRaw) && (
          <button
            type="button"
            title={
              activeErrorHint
                ? "Fix this formula with AI"
                : "Explain this formula with AI"
            }
            aria-label={
              activeErrorHint
                ? "Fix this formula with AI"
                : "Explain this formula with AI"
            }
            onClick={() => {
              setCellPrompt({
                ref: active,
                text: activeErrorHint
                  ? "This formula isn't working. Find and fix the problem."
                  : "Explain what this formula does.",
              });
              setShowAssistant(true);
            }}
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-inset transition-colors hover:bg-[var(--control)] ${
              activeErrorHint
                ? "text-[var(--state-overdue-ink)]"
                : "text-ink-faint hover:text-ink"
            }`}
          >
            <Icon.sparkle className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {!readOnly && (
        <div
          role="toolbar"
          aria-label="Formatting"
          className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-hairline px-2 py-1"
        >
          {/* Quick access — undo/redo, as Excel's title bar keeps them. */}
          <FmtBtn label="Undo (⌘Z)" disabled={!undoMgr} onClick={() => undoMgr?.undo()}>
            <span className="text-[13px] leading-none">↺</span>
          </FmtBtn>
          <FmtBtn label="Redo (⌘⇧Z)" disabled={!undoMgr} onClick={() => undoMgr?.redo()}>
            <span className="text-[13px] leading-none">↻</span>
          </FmtBtn>
          <Sep />

          {/* Font group */}
          <ToolSelect
            label="Font"
            value={rawStyles[active]?.font ?? "Calibri"}
            width="w-24"
            options={FONTS.map((f) => [f, f])}
            onChange={(v) => toggleStyle({ font: v })}
          />
          <ToolSelect
            label="Font size"
            value={String(rawStyles[active]?.size ?? 11)}
            width="w-[3.25rem]"
            options={SIZES.map((s) => [String(s), String(s)])}
            onChange={(v) => toggleStyle({ size: Number(v) })}
          />
          <FmtBtn label="Bold (⌘B)" active={!!rawStyles[active]?.bold} onClick={() => toggleStyle({ bold: !rawStyles[active]?.bold })}>
            <span className="font-semibold">B</span>
          </FmtBtn>
          <FmtBtn label="Italic (⌘I)" active={!!rawStyles[active]?.italic} onClick={() => toggleStyle({ italic: !rawStyles[active]?.italic })}>
            <span className="italic">I</span>
          </FmtBtn>
          <FmtBtn label="Underline (⌘U)" active={!!rawStyles[active]?.underline} onClick={() => toggleStyle({ underline: !rawStyles[active]?.underline })}>
            <span className="underline">U</span>
          </FmtBtn>
          <FmtBtn label="Strikethrough" active={!!rawStyles[active]?.strike} onClick={() => toggleStyle({ strike: !rawStyles[active]?.strike })}>
            <span className="line-through">S</span>
          </FmtBtn>
          <ColorBtn label="Font colour" swatch={rawStyles[active]?.color} onPick={(v) => toggleStyle({ color: v })}>
            <span className="text-[11px] font-semibold leading-none">A</span>
          </ColorBtn>
          <ColorBtn label="Fill colour" swatch={rawStyles[active]?.bg} onPick={(v) => toggleStyle({ bg: v })}>
            <span className="text-[11px] leading-none">▦</span>
          </ColorBtn>
          <ToolSelect
            label="Borders"
            value={rawStyles[active]?.border ?? "none"}
            width="w-[4.75rem]"
            options={[
              ["none", "Borders"],
              ["all", "All borders"],
              ["bottom", "Bottom border"],
            ]}
            onChange={(v) =>
              toggleStyle({
                border: v === "none" ? undefined : (v as "all" | "bottom"),
              })
            }
          />
          <Sep />

          {/* Alignment group */}
          <ToolSelect
            label="Vertical align"
            value={rawStyles[active]?.valign ?? "middle"}
            width="w-[4.75rem]"
            options={[
              ["top", "Top"],
              ["middle", "Middle"],
              ["bottom", "Bottom"],
            ]}
            onChange={(v) =>
              toggleStyle({ valign: v as "top" | "middle" | "bottom" })
            }
          />
          {(["left", "center", "right"] as const).map((a) => (
            <FmtBtn key={a} label={`Align ${a}`} active={rawStyles[active]?.align === a} onClick={() => toggleStyle({ align: a })}>
              <span className="text-[10px]">{a[0].toUpperCase()}</span>
            </FmtBtn>
          ))}
          <FmtBtn label="Wrap text" active={!!rawStyles[active]?.wrap} onClick={() => toggleStyle({ wrap: !rawStyles[active]?.wrap })}>
            <span className="text-[11px] leading-none">↩</span>
          </FmtBtn>
          <FmtBtn label="Decrease indent" onClick={() => toggleStyle({ indent: (Math.max(0, (rawStyles[active]?.indent ?? 0) - 1)) || undefined })}>
            <span className="text-[11px] leading-none">⇤</span>
          </FmtBtn>
          <FmtBtn label="Increase indent" onClick={() => toggleStyle({ indent: Math.min(8, (rawStyles[active]?.indent ?? 0) + 1) })}>
            <span className="text-[11px] leading-none">⇥</span>
          </FmtBtn>
          <Sep />

          {/* Number group */}
          <ToolSelect
            label="Number format"
            value={rawStyles[active]?.format ?? "general"}
            width="w-24"
            options={[
              ["general", "General"],
              ["comma", "Number"],
              ["currency", "Currency"],
              ["percent", "Percent"],
            ]}
            onChange={(v) =>
              toggleStyle({ format: v === "general" ? undefined : (v as NumberFormat) })
            }
          />
          <FmtBtn label="Currency (₹)" active={rawStyles[active]?.format === "currency"} onClick={() => toggleStyle({ format: rawStyles[active]?.format === "currency" ? undefined : "currency" })}>
            <span className="text-[11px]">₹</span>
          </FmtBtn>
          <FmtBtn label="Percent" active={rawStyles[active]?.format === "percent"} onClick={() => toggleStyle({ format: rawStyles[active]?.format === "percent" ? undefined : "percent" })}>
            <span className="text-[11px]">%</span>
          </FmtBtn>
          <FmtBtn label="Comma" active={rawStyles[active]?.format === "comma"} onClick={() => toggleStyle({ format: rawStyles[active]?.format === "comma" ? undefined : "comma" })}>
            <span className="text-[11px]">,</span>
          </FmtBtn>
          <FmtBtn label="Decrease decimal" onClick={() => toggleStyle({ decimals: Math.max(0, (rawStyles[active]?.decimals ?? 2) - 1) })}>
            <span className="text-[9px] leading-none tracking-tighter">.0←</span>
          </FmtBtn>
          <FmtBtn label="Increase decimal" onClick={() => toggleStyle({ decimals: Math.min(10, (rawStyles[active]?.decimals ?? 2) + 1) })}>
            <span className="text-[9px] leading-none tracking-tighter">.00→</span>
          </FmtBtn>
          <Sep />

          {/* Styles & insert */}
          <FmtBtn
            label="Conditional formatting"
            active={cfOpen}
            onClick={() => (cfOpen ? setCfOpen(false) : openConditionalPanel())}
          >
            <span className="text-[12px] leading-none">▦</span>
          </FmtBtn>
          <ToolSelect
            label="Insert chart from selection"
            value=""
            width="w-[5.5rem]"
            options={[
              ["", "＋ Chart"],
              ["column", "Column"],
              ["bar", "Bar"],
              ["line", "Line"],
              ["area", "Area"],
              ["pie", "Pie"],
              ["doughnut", "Doughnut"],
              ["scatter", "Scatter"],
              ["combo", "Combo"],
            ]}
            onChange={(v) => {
              if (v) insertChart(v as ChartType);
            }}
          />
          <Sep />

          <FmtBtn label="Clear formatting" onClick={clearFormats}>
            <span className="text-[10px] font-semibold leading-none">A✕</span>
          </FmtBtn>
          <FmtBtn label="Clear contents (Del)" onClick={clearRange}>
            <Icon.close className="h-3.5 w-3.5" />
          </FmtBtn>
        </div>
      )}

      {(engineError ?? error) && (
        <div className="px-4 pt-2">
          <InlineError compact message={engineError ?? error ?? ""} />
        </div>
      )}
      {duplicateNotice && !engineError && !error && (
        <div className="px-4 pt-2">
          <p className="rounded-inset bg-[var(--surface-sunken)] px-2.5 py-1.5 text-[11.5px] text-ink-faint">
            {duplicateNotice}
          </p>
        </div>
      )}

      {/* `relative`: the assistant panel below is an OVERLAY, `absolute`
          against this row specifically — so it floats over the grid instead
          of permanently squeezing it down, and stays clear of the header,
          formula bar and formatting toolbar above it. */}
      <div className="relative flex min-h-0 flex-1">
      <div
        ref={gridRef}
        data-sheet-print
        tabIndex={0}
        role="grid"
        aria-label="Spreadsheet"
        onScroll={onScroll}
        className="min-h-0 min-w-0 flex-1 overflow-auto bg-[var(--surface-sunken)] outline-none scroll-slim"
        onContextMenu={(e) => {
          /* While editing a cell, leave the browser's own menu for the input
             (cut/copy/paste on selected text). Otherwise the grid's menu opens
             at the cursor — the cell under it was already selected on mousedown. */
          if (editing) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        onKeyDown={(e) => {
          if (editing) return;
          /* Escape clears a chart selection and collapses a range to its focus —
             but if the context menu is open it owns Escape (closing itself), so
             one keypress doesn't also deselect the chart underneath it. */
          if (e.key === "Escape") {
            if (menu) return;
            if (selectedChart) setSelectedChart(null);
            setAnchor(null);
            return;
          }
          /* The shortcuts every spreadsheet shares. Copy/cut/paste ride the
             native clipboard events above; these are the rest. */
          /* Ctrl/Cmd+Space selects the column, Shift+Space the row — the
             keyboard half of clicking a header, and the same keys Excel and
             Sheets use. Checked before the modifier block below because
             Ctrl+Shift+Space (select all) needs both to be seen together. */
          if (e.key === " " && (e.metaKey || e.ctrlKey || e.shiftKey) && !e.altKey && !editing) {
            const at = parseRef(active);
            if (at) {
              e.preventDefault();
              if ((e.metaKey || e.ctrlKey) && e.shiftKey) selectEverything();
              else if (e.metaKey || e.ctrlKey) selectColumns(at.col, at.col);
              else selectRows(at.row, at.row);
              return;
            }
          }
          if ((e.metaKey || e.ctrlKey) && !e.altKey) {
            const k = e.key.toLowerCase();
            /* Without this the browser's "Save page as…" dialog opens over the
               sheet — the one keystroke a person reaches for to be sure their
               work is safe was the one that did something else entirely. */
            if (k === "s") {
              e.preventDefault();
              if (!readOnly) saveNow();
              return;
            }
            if (k === "z") {
              e.preventDefault();
              if (e.shiftKey) undoMgr?.redo();
              else undoMgr?.undo();
              return;
            }
            if (k === "y") {
              e.preventDefault();
              undoMgr?.redo();
              return;
            }
            if (k === "b" && !readOnly) {
              e.preventDefault();
              toggleStyle({ bold: !rawStyles[active]?.bold });
              return;
            }
            if (k === "i" && !readOnly) {
              e.preventDefault();
              toggleStyle({ italic: !rawStyles[active]?.italic });
              return;
            }
            if (k === "u" && !readOnly) {
              e.preventDefault();
              toggleStyle({ underline: !rawStyles[active]?.underline });
              return;
            }
            if (k === "d" && !readOnly) {
              e.preventDefault();
              fill("down");
              return;
            }
            if (k === "r" && !readOnly) {
              e.preventDefault();
              fill("right");
              return;
            }
            if (k === "a") {
              e.preventDefault();
              setAnchor("A1");
              setActive(cellRef(sheet.rows - 1, sheet.cols - 1));
              return;
            }
            if (e.key === "Home") {
              e.preventDefault();
              selectTo(0, 0, false);
              return;
            }
          }
          /* F2 edits the active cell (caret at the end); Home jumps to column A
             of the row, Shift+Home selects to it. The Excel keys. */
          if (e.key === "F2" && !readOnly) {
            e.preventDefault();
            beginEdit(active, rawCells[active] ?? "");
            return;
          }
          if (e.key === "Home") {
            e.preventDefault();
            const at = parseRef(active);
            if (at) selectTo(at.row, 0, e.shiftKey);
            return;
          }
          const shift = e.shiftKey;
          const nav: Record<string, [number, number]> = {
            ArrowUp: [-1, 0],
            ArrowDown: [1, 0],
            ArrowLeft: [0, -1],
            ArrowRight: [0, 1],
            Enter: [1, 0],
            Tab: [0, 1],
          };
          const d = nav[e.key];
          if (d) {
            e.preventDefault();
            /* Enter and Tab always collapse the selection and step; the arrows
               extend it when Shift is held, the way every sheet behaves. */
            move(d[0], d[1], shift && (e.key.startsWith("Arrow")));
            return;
          }
          if (
            !readOnly &&
            e.key.length === 1 &&
            !e.metaKey &&
            !e.ctrlKey &&
            !e.altKey
          ) {
            /* Typing on a cell starts editing it. `preventDefault` stops the
               same keystroke also landing in the input `autoFocus` mounts. */
            e.preventDefault();
            beginEdit(active, e.key);
          }
          if (!readOnly && (e.key === "Backspace" || e.key === "Delete")) {
            e.preventDefault();
            clearRange();
          }
        }}
        onCopy={(e) => {
          /* Only the SELECTION's clipboard. A cell being edited lets its own
             input own copy/paste, so text within a formula still copies. */
          if (editing) return;
          e.preventDefault();
          e.clipboardData.setData("text/plain", rangeToText());
        }}
        onCut={(e) => {
          if (editing || readOnly) return;
          e.preventDefault();
          e.clipboardData.setData("text/plain", rangeToText());
          clearRange();
        }}
        onPaste={(e) => {
          if (editing || readOnly) return;
          const text = e.clipboardData.getData("text/plain");
          if (!text) return;
          e.preventDefault();
          const at = parseRef(active);
          if (!at) return;
          const entries: [string, string][] = [];
          parseClipboardTable(text).forEach((line, dr) =>
            line.forEach((val, dc) => {
              const r = at.row + dr;
              const c = at.col + dc;
              if (r < sheet.rows && c < sheet.cols)
                entries.push([cellRef(r, c), val]);
            }),
          );
          writeCells(entries);
        }}
      >
        <div
          className="relative"
          style={{ width: HEAD_W + totalContentW }}
        >
        <table
          className="border-collapse"
          style={{ tableLayout: "fixed", width: HEAD_W + totalContentW }}
        >
          <thead>
            <tr>
              <th
                title="Select all cells"
                aria-label="Select all cells"
                onMouseDown={(e) => {
                  if (e.button === 2) return;
                  beginHeaderSelection();
                  selectEverything();
                }}
                className="sticky top-0 left-0 z-20 cursor-pointer border border-hairline bg-[var(--frost-bar)] select-none hover:bg-[var(--control)]"
                style={{ width: HEAD_W, height: DEFAULT_CELL_H }}
              />
              {Array.from({ length: sheet.cols }, (_, c) => (
                <th
                  key={c}
                  scope="col"
                  title={`Select column ${columnLabel(c)} — shift-click to extend`}
                  onMouseDown={(e) => {
                    if (e.button === 2) return;
                    /* Shift extends from the corner the selection is already
                       pinned to, so dragging back the other way narrows it
                       rather than jumping. */
                    const from = e.shiftKey && anchorPos ? anchorPos.col : c;
                    beginHeaderSelection();
                    headerDrag.current = { kind: "col", from };
                    selectColumns(from, c);
                  }}
                  onMouseEnter={() => {
                    const d = headerDrag.current;
                    if (d?.kind === "col") selectColumns(d.from, c);
                  }}
                  className={`sticky top-0 z-10 cursor-pointer border border-hairline text-[10px] font-normal select-none ${
                    selRect && c >= selRect.left && c <= selRect.right
                      ? "bg-[var(--control)] text-ink"
                      : "bg-[var(--frost-bar)] text-ink-faint hover:bg-[var(--control)]"
                  }`}
                  style={{ width: colWidthAt(c), height: DEFAULT_CELL_H }}
                >
                  {columnLabel(c)}
                  {!readOnly && (
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      title="Drag to resize column"
                      className="absolute top-0 right-0 z-20 h-full w-1.5 -mr-0.5 cursor-col-resize touch-none select-none hover:bg-[var(--accent,#6b8afd)]/50"
                      onMouseDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => startResize("col", c, e)}
                      onPointerMove={onResizeMove}
                      onPointerUp={commitResize}
                      onPointerCancel={commitResize}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* The unrendered rows above, as one spacer, so the scrollbar spans
                the whole sheet even though only a window exists in the DOM. */}
            {first > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={sheet.cols + 1}
                  style={{ height: rowOffsets[first], padding: 0, border: 0 }}
                />
              </tr>
            )}
            {Array.from({ length: last - first }, (_, i) => {
              const r = first + i;
              /* A row `filter_range` hid. Kept at its own row height (not collapsed
                 to 0) — collapsing it would desync the scrollbar from `rowOffsets`,
                 which the windowing math above assumes matches every row's real
                 height. The compromise is a visible gap where the row used to be,
                 not a seamless close-up the way a spreadsheet with real
                 column-store rendering can afford. */
              if (sheet.hidden?.includes(r)) {
                return (
                  <tr key={r} aria-hidden="true">
                    <td
                      colSpan={sheet.cols + 1}
                      className="border border-hairline bg-[var(--surface-sunken)]"
                      style={{ height: rowHeightAt(r), padding: 0 }}
                    />
                  </tr>
                );
              }
              return (
                <tr key={r}>
                  <th
                    scope="row"
                    data-figure
                    title={`Select row ${r + 1} — shift-click to extend`}
                    onMouseDown={(e) => {
                      if (e.button === 2) return;
                      const from = e.shiftKey && anchorPos ? anchorPos.row : r;
                      beginHeaderSelection();
                      headerDrag.current = { kind: "row", from };
                      selectRows(from, r);
                    }}
                    onMouseEnter={() => {
                      const d = headerDrag.current;
                      if (d?.kind === "row") selectRows(d.from, r);
                    }}
                    className={`sticky left-0 z-10 cursor-pointer border border-hairline text-[10px] font-normal select-none ${
                      selRect && r >= selRect.top && r <= selRect.bottom
                        ? "bg-[var(--control)] text-ink"
                        : "bg-[var(--frost-bar)] text-ink-faint hover:bg-[var(--control)]"
                    }`}
                    style={{ width: HEAD_W, height: rowHeightAt(r) }}
                  >
                    {r + 1}
                    {!readOnly && (
                      <div
                        role="separator"
                        aria-orientation="horizontal"
                        title="Drag to resize row"
                        className="absolute bottom-0 left-0 z-20 h-1.5 w-full -mb-0.5 cursor-row-resize touch-none select-none hover:bg-[var(--accent,#6b8afd)]/50"
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => startResize("row", r, e)}
                        onPointerMove={onResizeMove}
                        onPointerUp={commitResize}
                        onPointerCancel={commitResize}
                      />
                    )}
                  </th>
                  {Array.from({ length: sheet.cols }, (_, c) => {
                    const ref = cellRef(r, c);
                    const isActive = ref === active;
                    const inSel = selRect ? inRect(r, c, selRect) : isActive;
                    const inPoint = pointRect ? inRect(r, c, pointRect) : false;
                    const style = rawStyles[ref] ?? {};
                    const raw = rawCells[ref] ?? "";
                    let shown = raw;
                    let numberValue: number | null =
                      raw !== "" && !Number.isNaN(Number(raw))
                        ? Number(raw)
                        : null;
                    if (isFormula(raw)) {
                      try {
                        const value = hf.engine.getCellValue({
                          sheet: activeHfId,
                          row: r,
                          col: c,
                        });
                        shown = displayValue(value);
                        numberValue = isNumericDisplay(value)
                          ? (value as number)
                          : null;
                      } catch {
                        shown = "#ERROR!";
                        numberValue = null;
                      }
                    }
                    const numeric = numberValue !== null;
                    /* The evaluated text BEFORE number formatting — what the
                       conditional rules (text/duplicate) compare, matching how the
                       rule stats were keyed. */
                    const cfText = shown;
                    /* A number format is a lens over the value applied at display:
                       the cell still stores `1234.5` but shows `₹1,234.50`. Text is
                       never reformatted. */
                    if (
                      numberValue !== null &&
                      (style.format || style.decimals !== undefined)
                    )
                      shown = formatNumber(
                        numberValue,
                        style.format,
                        style.decimals,
                      );
                    /* Conditional formatting: rules apply top-to-bottom (array
                       order is priority); each sets the properties it defines, a
                       later rule overrides an earlier one, and a stop-if-true rule
                       that fires ends the cascade for this cell. */
                    let cfBg: string | undefined;
                    let cfBar: { pct: number; color: string } | undefined;
                    let cfTextColor: string | undefined;
                    let cfBold = false;
                    let cfItalic = false;
                    let cfBorder = false;
                    let cfIcon: { ch: string; color: string } | undefined;
                    for (const rule of rawConds) {
                      if (rule.enabled === false) continue;
                      const rect = rangeToRect(rule.range);
                      if (!rect || !inRect(r, c, rect)) continue;
                      const res = evalConditional(
                        rule,
                        { value: numberValue, text: cfText },
                        ruleStats.get(rule.id) ?? emptyStats,
                      );
                      if (!res) continue;
                      if (res.bg) cfBg = res.bg;
                      if (res.textColor) cfTextColor = res.textColor;
                      if (res.bold) cfBold = true;
                      if (res.italic) cfItalic = true;
                      if (res.border) cfBorder = true;
                      if (res.bar) cfBar = res.bar;
                      if (res.icon) cfIcon = res.icon;
                      if (rule.stopIfTrue) break;
                    }
                    /* A failed formula shows its code; the tooltip says what the
                       code means, so the cell reads "#REF!" and hovering explains
                       it. Only formula cells, so ordinary "#tag" text is left be. */
                    const errorHint = isFormula(raw) ? explainError(shown) : null;

                    return (
                      <td
                        key={c}
                        tabIndex={-1}
                        onMouseDown={(e) => {
                          /* Clicking inside the cell you are editing is caret
                             placement — leave it to the input. */
                          if (editing === ref) return;
                          /* Right-click selects the cell it lands on so the menu
                             acts on it — unless it is already inside a multi-cell
                             selection, which is kept so the menu can act on the
                             whole range. Never starts a drag. */
                          if (e.button === 2) {
                            if (editing) commit();
                            if (!selRect || !inRect(r, c, selRect)) {
                              setEditing(null);
                              selectTo(r, c, false);
                            }
                            return;
                          }
                          /* Editing a formula that wants a reference? Point it in
                             rather than select, and keep the input focused —
                             preventDefault stops the click stealing focus. */
                          const canPoint =
                            editing !== null &&
                            isFormula(draft) &&
                            (pointStart !== null ||
                              formulaAcceptsReference(draft));
                          if (canPoint) {
                            e.preventDefault();
                            pointing.current = true;
                            pointAt(r, c, false);
                            return;
                          }
                          /* Editing something else and clicking away commits it
                             first, the way a spreadsheet does. */
                          if (editing) commit();
                          dragging.current = true;
                          selectTo(r, c, e.shiftKey);
                          setEditing(null);
                          setSelectedChart(null);
                          gridRef.current?.focus();
                        }}
                        onMouseEnter={() => {
                          if (pointing.current) pointAt(r, c, true);
                          else if (dragging.current && !editing)
                            selectTo(r, c, true);
                        }}
                        onDoubleClick={() => {
                          if (readOnly) return;
                          setAnchor(null);
                          setActive(ref);
                          beginEdit(ref, raw);
                        }}
                        className={`relative border border-hairline px-1 text-[12px] ${
                          isActive
                            ? "bg-[var(--doc-page)] outline outline-2 -outline-offset-2 outline-ink"
                            : inSel
                              ? "bg-[color-mix(in_srgb,var(--accent,#6b8afd)_16%,var(--doc-page))]"
                              : "bg-[var(--doc-page)]"
                        }`}
                        style={{
                          width: colWidthAt(c),
                          height: rowHeightAt(r),
                          color: style.color,
                          verticalAlign: style.valign,
                          /* Conditional formatting wins over the cell's own fill,
                             which wins over the selection tint; the active-cell
                             outline still reads over all of them. */
                          ...((cfBg ?? style.bg)
                            ? { backgroundColor: cfBg ?? style.bg }
                            : null),
                          ...(cfBar
                            ? {
                                backgroundImage: `linear-gradient(to right, ${cfBar.color}66 ${Math.round(cfBar.pct * 100)}%, transparent ${Math.round(cfBar.pct * 100)}%)`,
                              }
                            : null),
                          ...(cfBorder
                            ? { border: "1px solid var(--ink)" }
                            : style.border === "all"
                              ? { border: "1px solid var(--ink)" }
                              : style.border === "bottom"
                                ? { borderBottom: "1px solid var(--ink)" }
                                : null),
                          ...(inPoint
                            ? {
                                boxShadow:
                                  "inset 0 0 0 2px var(--accent, #6b8afd)",
                              }
                            : null),
                        }}
                      >
                        {editing === ref ? (
                          <>
                            <input
                              autoFocus={editAt === "cell"}
                              value={draft}
                              onChange={(e) => onDraft(e.target.value)}
                              onBlur={commit}
                              onKeyDown={onEditorKeyDown}
                              className="w-full bg-transparent text-[12px] outline-none"
                            />
                            {editAt === "cell" && acItems.length > 0 && (
                              <FnMenu
                                items={acItems}
                                active={acActive}
                                className="left-0 top-full"
                                onPick={applySuggestion}
                              />
                            )}
                          </>
                        ) : (
                          <span
                            title={errorHint ?? undefined}
                            className={`block ${style.wrap ? "whitespace-normal break-words" : "truncate"} ${
                              style.bold || cfBold ? "font-semibold" : ""
                            } ${style.italic || cfItalic ? "italic" : ""} ${
                              errorHint ? "cursor-help" : ""
                            }`}
                            style={{
                              textAlign:
                                style.align ?? (numeric ? "right" : "left"),
                              fontFamily: style.font,
                              fontSize: style.size,
                              textDecoration:
                                [
                                  style.underline && "underline",
                                  style.strike && "line-through",
                                ]
                                  .filter(Boolean)
                                  .join(" ") || undefined,
                              paddingInlineStart: style.indent
                                ? style.indent * 10
                                : undefined,
                              /* Errors read in the overdue tone; otherwise a
                                 conditional-format text colour wins over the cell's
                                 own. */
                              ...(errorHint
                                ? { color: "var(--state-overdue-ink)" }
                                : cfTextColor
                                  ? { color: cfTextColor }
                                  : null),
                            }}
                          >
                            {cfIcon && (
                              <span
                                aria-hidden="true"
                                className="mr-1"
                                style={{ color: cfIcon.color }}
                              >
                                {cfIcon.ch}
                              </span>
                            )}
                            {shown}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {last < sheet.rows && (
              <tr aria-hidden="true">
                <td
                  colSpan={sheet.cols + 1}
                  style={{
                    height: totalContentH - rowOffsets[last],
                    padding: 0,
                    border: 0,
                  }}
                />
              </tr>
            )}
          </tbody>
        </table>

          {/* Embedded chart objects — an absolute layer over the same content
              box as the table, so a chart floats over the cells and scrolls with
              them. The layer ignores the pointer; each chart re-enables it. */}
          {orderedCharts.length > 0 && (
            <div className="pointer-events-none absolute inset-0">
              {orderedCharts.map((chart, i) => (
                <SheetChartObject
                  key={chart.id}
                  spec={chart}
                  model={chartData(chart.range, chartCell, chart.orientation)}
                  selected={selectedChart === chart.id}
                  readOnly={readOnly}
                  zIndex={Math.min(9, i + 1)}
                  onSelect={() => {
                    setCfOpen(false);
                    setSelectedChart(chart.id);
                  }}
                  onChange={(patch) => updateChart(chart.id, patch)}
                />
              ))}
            </div>
          )}

          {/* The resize drag's guide line — see `startResize`/`onResizeMove`. Sits
              in the same content box as the table (not the viewport), so it tracks
              the pointer 1:1 via clientX/clientY deltas without reading scroll
              offsets, and scrolls with the sheet like everything else here. */}
          {resizeGuide &&
            (resizeGuide.kind === "col" ? (
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-[var(--accent,#6b8afd)]"
                style={{ left: resizeGuide.edge }}
              />
            ) : (
              <div
                className="pointer-events-none absolute left-0 right-0 z-30 h-0.5 bg-[var(--accent,#6b8afd)]"
                style={{ top: resizeGuide.edge }}
              />
            ))}
        </div>
      </div>

        {/* A sibling of the SCROLL container, never a child of it. Nested
            inside, an `absolute` panel is clipped by the grid's own
            `overflow-auto` box and drifts sideways with the sheet's
            horizontal scroll — which is what made its input unreachable. It
            belongs exactly where the chart and conditional panels already
            sit: a direct child of the content row. */}
        {showAssistant && (
          <SheetsAssistant
            documentId={documentId}
            documentTitle={doc.data.title}
            sheet={sheet}
            selection={selection}
            dispatch={dispatch}
            pendingPrompt={cellPrompt}
            onPromptTaken={() => setCellPrompt(null)}
            onRenamed={() => doc.refetch()}
            onClose={() => setShowAssistant(false)}
          />
        )}

        {selectedChartSpec && (
          <ChartPanel
            spec={selectedChartSpec}
            readOnly={readOnly}
            onChange={(patch) => updateChart(selectedChartSpec.id, patch)}
            onClose={() => setSelectedChart(null)}
            onDelete={() => removeChart(selectedChartSpec.id)}
            onDuplicate={() => duplicateChart(selectedChartSpec.id)}
            onForward={() => restackChart(selectedChartSpec.id, 1)}
            onBackward={() => restackChart(selectedChartSpec.id, -1)}
          />
        )}
        {cfOpen && (
          <ConditionalPanel
            rules={rawConds}
            selectedRule={selectedRule}
            selectionRange={selRect ? rangeLabel(selRect) : null}
            readOnly={readOnly}
            onAdd={addRule}
            onUpdate={updateRule}
            onRemove={removeRule}
            onDuplicate={duplicateRule}
            onMove={moveRule}
            onSelectRule={setSelectedRule}
            onClose={() => setCfOpen(false)}
          />
        )}
      </div>

      <SheetTabBar
        sheets={workbook.sheets}
        activeId={activeTab.id}
        readOnly={readOnly}
        onSelect={selectTab}
        onAdd={addSheet}
        onRename={renameSheet}
        onColor={colorSheet}
        onDelete={deleteSheet}
      />

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-hairline px-4 py-2">
        {!readOnly && (
          <p
            className="text-[10px]"
            style={{
              color:
                saveState === "error"
                  ? "var(--state-overdue-ink)"
                  : "var(--color-ink-faint)",
            }}
            aria-live="polite"
          >
            {saveState === "saved"
              ? "All changes saved"
              : saveState === "saving"
                ? "Saving…"
                : saveState === "pending"
                  ? "Unsaved changes — ⌘S to save now"
                  : "Could not save — retrying on your next edit"}
          </p>
        )}
        <p className="text-[10px] text-ink-faint">
          {readOnly
            ? "You have view access. Ask an owner if you need to edit this."
            : collab.connected
              ? "Edits are shared live. Formulas are calculated on your own machine."
              : (collab.reason ??
                "Working offline — saved to this sheet, but nobody else sees it live.")}
        </p>
        {/* The status-bar figures, like Sheets — only for a range with numbers. */}
        {summary && summary.count > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 text-[11px] text-ink-muted">
            <span>
              Sum{" "}
              <span data-figure className="text-ink">
                {formatNumber(summary.sum, "comma")}
              </span>
            </span>
            {summary.avg !== null && (
              <span>
                Avg{" "}
                <span data-figure className="text-ink">
                  {formatNumber(summary.avg, "comma")}
                </span>
              </span>
            )}
            <span>
              Count{" "}
              <span data-figure className="text-ink">
                {summary.count}
              </span>
            </span>
            {summary.min !== null && summary.max !== null && (
              <span className="text-ink-faint">
                Min <span data-figure>{formatNumber(summary.min, "comma")}</span>{" "}
                · Max <span data-figure>{formatNumber(summary.max, "comma")}</span>
              </span>
            )}
          </p>
        )}
      </footer>

      {menu && (
        <SheetContextMenu
          x={menu.x}
          y={menu.y}
          groups={menuGroups()}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/** The function-name suggestion menu, positioned by its caller's `className`. */
function FnMenu({
  items,
  active,
  className,
  onPick,
}: {
  items: string[];
  active: number;
  className?: string;
  onPick: (name: string) => void;
}) {
  return (
    <ul
      role="listbox"
      className={`absolute z-30 mt-0.5 max-h-56 w-44 overflow-auto rounded-panel border border-hairline bg-[var(--surface-raised)] py-1 shadow-lg scroll-slim ${className ?? ""}`}
    >
      {items.map((name, i) => (
        <li key={name} role="option" aria-selected={i === active}>
          <button
            type="button"
            /* Mouse-down, not click: a click fires after the input's blur, which
               would commit and unmount the menu before the pick ran. */
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(name);
            }}
            className={`flex w-full items-center gap-2 px-2.5 py-1 text-left text-[12px] ${
              i === active ? "bg-[var(--control)] text-ink" : "text-ink-muted"
            }`}
          >
            <span data-figure className="font-medium">{name}</span>
            <span className="text-[10px] text-ink-faint">fn</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function FmtBtn({
  label,
  active,
  onClick,
  disabled,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-7 min-w-7 place-items-center rounded-inset px-1.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-ink text-[var(--body-bg)]"
          : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * A colour picker dressed as a toolbar button: a glyph, a swatch of the current
 * colour under it, and a native picker laid invisibly over the top so a click
 * opens the OS colour dialog. Reliable and keyboard-reachable without shipping a
 * bespoke palette.
 */
function ColorBtn({
  label,
  swatch,
  onPick,
  children,
}: {
  label: string;
  swatch?: string;
  onPick: (value: string) => void;
  children: React.ReactNode;
}) {
  const valid = !!swatch && /^#[0-9a-fA-F]{6}$/.test(swatch);
  return (
    <label
      title={label}
      aria-label={label}
      className="relative grid h-7 min-w-7 cursor-pointer place-items-center rounded-inset px-1.5 text-ink-muted hover:bg-[var(--control)] hover:text-ink"
    >
      {children}
      <span
        aria-hidden="true"
        className="absolute inset-x-1 bottom-0.5 h-[3px] rounded-full"
        style={{ background: valid ? swatch : "transparent" }}
      />
      <input
        type="color"
        value={valid ? swatch! : "#000000"}
        onChange={(e) => onPick(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );
}

/** A vertical rule between toolbar groups, as a ribbon divides them. */
function Sep() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-hairline" />;
}

/** A compact toolbar dropdown — the font, size and number-format menus. */
function ToolSelect({
  label,
  value,
  options,
  width,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  width?: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      title={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-7 ${width ?? "w-20"} rounded-inset border border-hairline bg-[var(--doc-page)] px-1 text-[11px] text-ink outline-none hover:bg-[var(--control)]`}
    >
      {options.map(([v, lbl]) => (
        <option key={v} value={v}>
          {lbl}
        </option>
      ))}
    </select>
  );
}
