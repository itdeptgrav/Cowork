"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { HyperFormula } from "hyperformula";
import { Icon } from "@/components/ui/Icons";
import { InlineError, SkeletonRows } from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { getRepository } from "@/lib/repositories";
import {
  canManage,
  editRefusal,
  roleOf,
} from "@/lib/rules/documents/access";
import {
  cellRef,
  columnLabel,
  displayValue,
  formatNumber,
  formulaAcceptsReference,
  formulaFunctionPrefix,
  inRect,
  isFormula,
  isNumericDisplay,
  matchFunctionNames,
  normalizeRange,
  offsetReferences,
  parseClipboardTable,
  parseRef,
  rangeLabel,
  readSheet,
  summarize,
  writeSheet,
  type CellPos,
  type CellStyle,
  type NumberFormat,
  type SheetData,
} from "@/lib/rules/sheets/grid";
import { useCollabSession } from "./useCollabSession";
import { ShareMenu } from "./ShareMenu";

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
 * scrollbar honest. Row height is fixed (`CELL_H`), so the window is arithmetic
 * — no per-row measurement, which is the thing that makes windowing itself slow.
 */

const CELL_W = 104;
const CELL_H = 26;
const HEAD_W = 44;
const OVERSCAN = 8;

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

export function SheetGrid({ documentId }: { documentId: string }) {
  const doc = useQuery((r) => r.getDocument(documentId), [documentId]);
  const body = useQuery((r) => r.getDocumentBody(documentId), [documentId]);
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  const collab = useCollabSession(documentId, me.data ?? null);

  const readOnly = doc.data
    ? editRefusal(doc.data, me.data?.id ?? null) !== null
    : false;
  const myRole = doc.data ? roleOf(doc.data, me.data?.id ?? null) : null;

  const [sheet, setSheet] = useState<SheetData | null>(null);
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
  const [full, setFull] = useState(false);
  const [undoMgr, setUndoMgr] = useState<Y.UndoManager | null>(null);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seeded = useRef(false);
  const dragging = useRef(false);
  const pointing = useRef(false);
  const scrollRaf = useRef(0);

  /* The shared maps. Read through the provider's doc so every client mutates the
     same structure rather than a copy of it. */
  const yCells = collab.session?.doc.getMap<string>("cells") ?? null;
  const yStyles = collab.session?.doc.getMap<CellStyle>("styles") ?? null;

  /**
   * The engine and its sheet id, BUILT AND DESTROYED IN ONE EFFECT.
   *
   * The engine used to be built in a `useMemo` and freed in a SEPARATE effect's
   * cleanup. Under React StrictMode (dev) a component is mounted, unmounted and
   * remounted to flush out exactly this class of bug: the cleanup ran
   * `engine.destroy()`, but the memo — keyed on `[]` — was not re-run on the
   * remount, so the live grid was left driving a torn-down engine and the next
   * `setSheetContent` threw. Building and freeing in one effect makes the pair
   * inseparable, and holding it in state re-runs the consumers once it is ready.
   */
  const [hf, setHf] = useState<{
    engine: HyperFormula;
    sheetId: number;
  } | null>(null);

  useEffect(() => {
    const engine = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
    engine.addSheet("main");
    /* Bare TRUE/FALSE as literals — HyperFormula reads them as named
       expressions otherwise, so `=VLOOKUP(3,A1:B2,2,FALSE)` returned `#NAME?`. */
    try {
      engine.addNamedExpression("TRUE", "=TRUE()");
      engine.addNamedExpression("FALSE", "=FALSE()");
    } catch {
      /* Already registered. */
    }
    setHf({ engine, sheetId: engine.getSheetId("main") ?? 0 });
    return () => {
      engine.destroy();
      setHf(null);
    };
  }, []);

  /* ── Load ──────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (sheet || body.isLoading) return;
    const frame = requestAnimationFrame(() =>
      setSheet(readSheet(body.data?.cells ?? null)),
    );
    return () => cancelAnimationFrame(frame);
  }, [body.isLoading, body.data?.cells, sheet]);

  /* Carry a pre-collaboration sheet into the CRDT once, only when the shared map
     is genuinely empty, so the second person to open it does not write a copy. */
  useEffect(() => {
    if (!yCells || !sheet || seeded.current || !collab.session) return;
    const apply = () => {
      if (seeded.current) return;
      seeded.current = true;
      if (yCells.size > 0) return;
      collab.session!.doc.transact(() => {
        for (const [ref, value] of Object.entries(sheet.cells)) yCells.set(ref, value);
        for (const [ref, style] of Object.entries(sheet.styles)) yStyles?.set(ref, style);
      });
    };
    if (collab.session.provider.synced) apply();
    else collab.session.provider.once("sync", apply);
  }, [yCells, yStyles, sheet, collab.session]);

  /* Re-render on anybody's change — including our own. */
  useEffect(() => {
    if (!yCells || !yStyles) return;
    const bump = () => setVersion((n) => n + 1);
    yCells.observe(bump);
    yStyles.observe(bump);
    return () => {
      yCells.unobserve(bump);
      yStyles.unobserve(bump);
    };
  }, [yCells, yStyles]);

  /* Undo/redo over the shared maps. It tracks LOCAL edits only (the default null
     origin), so Ctrl+Z never rewinds a collaborator's change out from under them.
     Live sessions only — offline there is no CRDT history to walk. */
  useEffect(() => {
    if (!yCells || !yStyles) return;
    const mgr = new Y.UndoManager([yCells, yStyles], { captureTimeout: 350 });
    setUndoMgr(mgr);
    return () => {
      mgr.destroy();
      setUndoMgr(null);
    };
  }, [yCells, yStyles]);

  /** The authoritative raw cells: the CRDT when connected, local state otherwise. */
  const rawCells = useMemo(() => {
    if (yCells) return Object.fromEntries(yCells.entries());
    return sheet?.cells ?? {};
  }, [yCells, sheet, version]);

  const rawStyles = useMemo(() => {
    if (yStyles) return Object.fromEntries(yStyles.entries());
    return sheet?.styles ?? {};
  }, [yStyles, sheet, version]);

  /* Feed the engine SYNCHRONOUSLY — a memo during render, NOT an effect.
     **This is the "the total doesn't show until I touch something else" fix.** An
     effect runs AFTER the render that reads the engine, so a freshly-typed
     `=SUM(...)` was evaluated against the PREVIOUS content and its result surfaced
     a render late. Computing it here means the cells below read an engine that
     already knows the edit, so the answer is on screen the instant Enter lands.
     `setSheetContent` is idempotent, so StrictMode's double-invoke is harmless. */
  const engineError = useMemo<string | null>(() => {
    if (!sheet || !hf) return null;
    const grid: string[][] = Array.from({ length: sheet.rows }, () =>
      Array.from({ length: sheet.cols }, () => ""),
    );
    for (const [ref, value] of Object.entries(rawCells)) {
      const at = parseRef(ref);
      if (at && at.row < sheet.rows && at.col < sheet.cols) {
        grid[at.row][at.col] = value;
      }
    }
    try {
      hf.engine.setSheetContent(hf.sheetId, grid);
      return null;
    } catch (e) {
      return e instanceof Error
        ? e.message
        : "That sheet could not be calculated.";
    }
  }, [rawCells, sheet, hf]);

  /* ── Save ──────────────────────────────────────────────────────────────── */

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!sheet) return;
      void getRepository()
        .saveDocumentBody(documentId, {
          cells: writeSheet({
            cells: rawCells,
            styles: rawStyles,
            rows: sheet.rows,
            cols: sheet.cols,
          }),
        })
        .catch(() => setError("That could not be saved."));
    }, 1500);
  }, [documentId, rawCells, rawStyles, sheet]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
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
  }, [sheet, hf]);

  /* Keep the focus cell on screen when it moves off it by keyboard — otherwise
     an arrow into a windowed-away row selects a cell nobody can see. */
  useEffect(() => {
    const el = gridRef.current;
    const pos = parseRef(active);
    if (!el || !pos) return;
    const top = pos.row * CELL_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + CELL_H > el.scrollTop + el.clientHeight - CELL_H)
      el.scrollTop = top + CELL_H - el.clientHeight + CELL_H;
  }, [active]);

  /* ── Edit ──────────────────────────────────────────────────────────────── */

  const setCell = (ref: string, value: string) => {
    if (readOnly) return;
    setError(null);
    if (yCells) {
      if (value === "") yCells.delete(ref);
      else yCells.set(ref, value);
    } else {
      setSheet((s) => (s ? { ...s, cells: { ...s.cells, [ref]: value } } : s));
    }
    scheduleSave();
  };

  /* A block write — one CRDT transaction (or one state update) for a whole
     range, so a paste or a range-clear is a single merge everyone sees at once. */
  const writeCells = (entries: [string, string][]) => {
    if (readOnly || entries.length === 0) return;
    setError(null);
    if (yCells) {
      collab.session?.doc.transact(() => {
        for (const [ref, value] of entries) {
          if (value === "") yCells.delete(ref);
          else yCells.set(ref, value);
        }
      });
    } else {
      setSheet((s) => {
        if (!s) return s;
        const cells = { ...s.cells };
        for (const [ref, value] of entries) {
          if (value === "") delete cells[ref];
          else cells[ref] = value;
        }
        return { ...s, cells };
      });
    }
    scheduleSave();
  };

  /* Formatting applies to the WHOLE selection, as a spreadsheet does — bolding
     A1:C3 bolds all nine. Each cell keeps its other styles; only the patched keys
     change (`null`-valued keys are stripped, so "no fill" is an absence, not a
     stored null the CRDT keeps replicating). */
  const toggleStyle = (patch: Partial<CellStyle>) => {
    if (readOnly) return;
    const list = selRect ? rectRefs() : [active];
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
        for (const ref of list)
          yStyles.set(ref, merge((yStyles.get(ref) as CellStyle | undefined) ?? {}));
      });
    } else {
      setSheet((s) => {
        if (!s) return s;
        const styles = { ...s.styles };
        for (const ref of list) styles[ref] = merge(styles[ref] ?? {});
        return { ...s, styles };
      });
    }
    scheduleSave();
  };

  const resetPointing = () => {
    setPointStart(null);
    setPointAnchor(null);
    setPointFocus(null);
  };

  const commit = () => {
    if (editing) setCell(editing, draft);
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
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  /* Follow the browser out of fullscreen — Escape leaves it without the button,
     and the state must not be left claiming otherwise. */
  useEffect(() => {
    const sync = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFull = async () => {
    if (full) {
      setFull(false);
      if (document.fullscreenElement)
        await document.exitFullscreen().catch(() => {});
      return;
    }
    setFull(true);
    /* Two mechanisms, because one is not reliable: the fixed maximised layout
       below always applies, and the real Fullscreen API is the upgrade where the
       embedding permits it. */
    try {
      await shell.current?.requestFullscreen?.();
    } catch {
      /* Refused — the maximised state still applies. */
    }
  };

  if (doc.isLoading || body.isLoading || !sheet || !hf)
    return <SkeletonRows rows={8} />;
  if (!doc.data)
    return <InlineError message="This sheet is not available." />;

  const activeRaw = rawCells[active] ?? "";

  /* The numeric value a cell shows — its formula RESULT or its typed number,
     nothing for a label or a blank. Feeds the selection summary. */
  const cellNumber = (r: number, c: number): number | null => {
    const raw = rawCells[cellRef(r, c)] ?? "";
    if (isFormula(raw)) {
      try {
        const v = hf.engine.getCellValue({ sheet: hf.sheetId, row: r, col: c });
        return isNumericDisplay(v) ? (v as number) : null;
      } catch {
        return null;
      }
    }
    return raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : null;
  };

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
            for (let c = selRect.left; c <= selRect.right; c++) {
              scanned++;
              const n = cellNumber(r, c);
              if (n !== null) nums.push(n);
            }
          return summarize(nums);
        })()
      : null;

  /* The row window. Fixed row height makes this arithmetic rather than a
     measurement, which is what keeps windowing itself cheap. */
  const first = Math.max(0, Math.floor(scrollTop / CELL_H) - OVERSCAN);
  const last = Math.min(
    sheet.rows,
    Math.ceil((scrollTop + viewportH) / CELL_H) + OVERSCAN,
  );

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => setScrollTop(top));
  };

  return (
    <div
      ref={shell}
      className={
        full
          ? "fixed inset-0 z-[90] flex flex-col bg-[var(--body-bg)]"
          : "flex h-full min-h-0 flex-col"
      }
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5">
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          {doc.data.title}
        </span>
        {myRole && myRole !== "owner" && (
          <span className="rounded-full bg-[var(--control)] px-2 py-0.5 text-[10px] text-ink-muted">
            {myRole === "viewer" ? "View only" : "Editor"}
          </span>
        )}
        {canManage(doc.data, me.data?.id ?? null) && (
          <ShareMenu document={doc.data} onChanged={doc.refetch} />
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
        <button
          type="button"
          aria-label={full ? "Exit full screen" : "Full screen"}
          aria-pressed={full}
          title={full ? "Exit full screen (Esc)" : "Full screen"}
          onClick={() => void toggleFull()}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-inset text-ink-muted hover:bg-[var(--control)] hover:text-ink"
        >
          <Icon.external className={`h-3.5 w-3.5 ${full ? "rotate-180" : ""}`} />
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
          <ColorBtn label="Font colour" swatch={rawStyles[active]?.color} onPick={(v) => toggleStyle({ color: v })}>
            <span className="text-[11px] font-semibold leading-none">A</span>
          </ColorBtn>
          <ColorBtn label="Fill colour" swatch={rawStyles[active]?.bg} onPick={(v) => toggleStyle({ bg: v })}>
            <span className="text-[11px] leading-none">▦</span>
          </ColorBtn>
          <Sep />

          {/* Alignment group */}
          {(["left", "center", "right"] as const).map((a) => (
            <FmtBtn key={a} label={`Align ${a}`} active={rawStyles[active]?.align === a} onClick={() => toggleStyle({ align: a })}>
              <span className="text-[10px]">{a[0].toUpperCase()}</span>
            </FmtBtn>
          ))}
          <FmtBtn label="Wrap text" active={!!rawStyles[active]?.wrap} onClick={() => toggleStyle({ wrap: !rawStyles[active]?.wrap })}>
            <span className="text-[11px] leading-none">↩</span>
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

          <FmtBtn label="Clear contents" onClick={clearRange}>
            <Icon.close className="h-3.5 w-3.5" />
          </FmtBtn>
        </div>
      )}

      {(engineError ?? error) && (
        <div className="px-4 pt-2">
          <InlineError compact message={engineError ?? error ?? ""} />
        </div>
      )}

      <div
        ref={gridRef}
        tabIndex={0}
        role="grid"
        aria-label="Spreadsheet"
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto bg-[var(--surface-sunken)] outline-none scroll-slim"
        onKeyDown={(e) => {
          if (editing) return;
          /* The shortcuts every spreadsheet shares. Copy/cut/paste ride the
             native clipboard events above; these are the rest. */
          if ((e.metaKey || e.ctrlKey) && !e.altKey) {
            const k = e.key.toLowerCase();
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
        <table
          className="border-collapse"
          style={{ tableLayout: "fixed", width: HEAD_W + sheet.cols * CELL_W }}
        >
          <thead>
            <tr>
              <th
                className="sticky top-0 left-0 z-20 border border-hairline bg-[var(--frost-bar)]"
                style={{ width: HEAD_W, height: CELL_H }}
              />
              {Array.from({ length: sheet.cols }, (_, c) => (
                <th
                  key={c}
                  scope="col"
                  className={`sticky top-0 z-10 border border-hairline text-[10px] font-normal ${
                    selRect && c >= selRect.left && c <= selRect.right
                      ? "bg-[var(--control)] text-ink"
                      : "bg-[var(--frost-bar)] text-ink-faint"
                  }`}
                  style={{ width: CELL_W, height: CELL_H }}
                >
                  {columnLabel(c)}
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
                  style={{ height: first * CELL_H, padding: 0, border: 0 }}
                />
              </tr>
            )}
            {Array.from({ length: last - first }, (_, i) => {
              const r = first + i;
              return (
                <tr key={r}>
                  <th
                    scope="row"
                    data-figure
                    className={`sticky left-0 z-10 border border-hairline text-[10px] font-normal ${
                      selRect && r >= selRect.top && r <= selRect.bottom
                        ? "bg-[var(--control)] text-ink"
                        : "bg-[var(--frost-bar)] text-ink-faint"
                    }`}
                    style={{ width: HEAD_W, height: CELL_H }}
                  >
                    {r + 1}
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
                          sheet: hf.sheetId,
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

                    return (
                      <td
                        key={c}
                        tabIndex={-1}
                        onMouseDown={(e) => {
                          /* Clicking inside the cell you are editing is caret
                             placement — leave it to the input. */
                          if (editing === ref) return;
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
                          width: CELL_W,
                          height: CELL_H,
                          color: style.color,
                          verticalAlign: style.valign,
                          /* Fill overrides the selection tint on filled cells;
                             the active-cell outline still reads over it. */
                          ...(style.bg ? { backgroundColor: style.bg } : null),
                          ...(style.border === "all"
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
                            className={`block ${style.wrap ? "whitespace-normal break-words" : "truncate"} ${
                              style.bold ? "font-semibold" : ""
                            } ${style.italic ? "italic" : ""}`}
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
                            }}
                          >
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
                    height: (sheet.rows - last) * CELL_H,
                    padding: 0,
                    border: 0,
                  }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-hairline px-4 py-2">
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
