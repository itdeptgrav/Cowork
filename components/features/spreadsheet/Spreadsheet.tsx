"use client";

/**
 * The spreadsheet view — the name box and formula bar over the grid.
 *
 * It builds the state controller and hands it to the grid and the formula bar;
 * they stay in step because they read and write the one controller. The toolbar
 * beyond this — fonts, number formats, tabs — belongs to later phases and is
 * deliberately absent rather than stubbed.
 */

import { useEffect, useRef, useState } from "react";
import { NameBox } from "./NameBox";
import { useQuery } from "@/lib/hooks/useRepository";
import { useWorkbookCollab } from "./useWorkbookCollab";
import { Ribbon } from "./Ribbon";
import { FormulaBar } from "./FormulaBar";
import { SheetTabBar } from "./SheetTabBar";
import { SpreadsheetGrid } from "./SpreadsheetGrid";
import { useSpreadsheet } from "./useSpreadsheet";
import { useWorkbookPersistence } from "./useWorkbookPersistence";
import { WorkbookHeader } from "./WorkbookHeader";
import { useLocalFileBinding } from "./useLocalFileBinding";
import { loadFileIntoWorkbook } from "./openSheetFile";
import { roundTripWarning } from "@/lib/rules/sheets/roundTrip";
import { probeWorkbookFile } from "@/lib/spreadsheet/xlsxProbe";
import {
  dragHasFiles,
  sheetFileKind,
  unsupportedFileMessage,
} from "@/lib/rules/sheets/openFile";
import {
  handleFromDrop,
  type LocalFileHandle,
} from "@/lib/spreadsheet/localFile";

export function Spreadsheet({
  workbookId = null,
  draft = false,
  onBack,
  onNewSheet,
  openFile = null,
  onOpenFile,
}: {
  /** Which stored workbook to open. `null` opens an unsaved scratch sheet. */
  workbookId?: string | null;
  /** Start a blank sheet that is only stored once it has content. */
  draft?: boolean;
  /** Shown as a "back to the list" control when a browser opened this. */
  onBack?: () => void;
  /** Leave this workbook and start a new one — the browser owns creating it. */
  onNewSheet?: () => void;
  /**
   * A file this workspace was opened ONTO.
   *
   * `handle` present binds the sheet to it, so edits save straight back —
   * "Open from this computer". Null reads the contents and forgets the file —
   * "Upload a copy". The list decides which; this only carries it out.
   */
  openFile?: { file: File; handle: LocalFileHandle | null } | null;
  /**
   * Open a dropped file in a FRESH workspace.
   *
   * Provided by the sheet list. Without it a drop has nowhere else to go and
   * falls back to loading in place — still behind the same confirmation, so a
   * drop never silently replaces work either way.
   */
  onOpenFile?: (file: File, handle: LocalFileHandle | null) => void;
} = {}) {
  const controller = useSpreadsheet();
  const persistence = useWorkbookPersistence(controller, workbookId, { draft });
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  /* Live editing joins the room of the STORED workbook — a draft that just
     earned its record joins the moment it has an id. */
  const collab = useWorkbookCollab(controller, persistence.workbookId, me.data ?? null);
  /* Protection is enforced by the controller, which needs to know who is
     editing; the persistence layer is what learned it from the load. */
  const { setAccess } = controller;
  const { access } = persistence;
  useEffect(() => {
    setAccess(access);
  }, [setAccess, access]);
  const gridRef = useRef<HTMLDivElement>(null);
  /* The find/replace bar lives here, not in the grid, so the ribbon can open it
     as well as Ctrl+F. */
  const [search, setSearch] = useState<false | "find" | "replace">(false);

  /* The file on this computer, when the sheet is bound to one. Held here
     rather than inside the header so the drop handler and the File menu are
     talking to the same binding. */
  const local = useLocalFileBinding(controller);
  /**
   * Depth, not a boolean.
   *
   * Dragging across a child element fires `dragleave` on the parent before
   * `dragenter` on the child, so a boolean flickers the overlay off and on for
   * every cell the pointer crosses. Counting enters against leaves is the same
   * fix the message thread's drop zone uses.
   */
  const [dragDepth, setDragDepth] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  /**
   * The file a drop is offering, held until somebody says yes.
   *
   * **A drop used to load straight over the open sheet**, which is the defect
   * this replaces: dropping a file to "have a look at it" discarded whatever
   * was on screen, with no warning and no undo. A dropped file is now a
   * question, and it opens in a workspace of its own.
   *
   * The HANDLE is resolved at drop time and kept here, not fetched when the
   * question is answered: `getAsFileSystemHandle` only yields a writable handle
   * from the drop gesture itself, and by the time somebody has read a dialog
   * that gesture is long gone.
   */
  const [dropped, setDropped] = useState<{
    file: File;
    handle: LocalFileHandle | null;
  } | null>(null);
  const [opening, setOpening] = useState(false);
  /**
   * A link waiting on the reader, because taking it would cost them something.
   *
   * See `roundTrip.ts`. The file is already open by this point — reading it is
   * lossless — so the only question is whether Cowork may start SAVING over it.
   */
  const [linkRisk, setLinkRisk] = useState<{
    handle: LocalFileHandle;
    title: string;
    warning: string;
  } | null>(null);

  /**
   * Bind to a file, unless doing so would strip it.
   *
   * Every route that links a file goes through here — the list's "Open from
   * this computer", and a confirmed drop — so neither can acquire the habit of
   * binding without asking.
   */
  async function bindUnlessLossy(
    handle: LocalFileHandle,
    file: File,
    title: string,
  ): Promise<void> {
    if (!local.supported) return;
    const warning = roundTripWarning(
      await probeWorkbookFile(await file.arrayBuffer()),
      file.name,
    );
    if (warning) {
      setLinkRisk({ handle, title, warning });
      return;
    }
    const bound = await local.bind(handle, title);
    setNotice(
      bound
        ? `Opened “${file.name}”. Edits save straight back to it.`
        : `Opened “${file.name}”, but Cowork wasn’t given permission to write to it.`,
    );
  }

  async function onDropFile(e: React.DragEvent<HTMLDivElement>) {
    if (!dragHasFiles(e.dataTransfer?.types as readonly string[] | undefined))
      return;
    e.preventDefault();
    setDragDepth(0);
    const item = e.dataTransfer.items?.[0] ?? null;
    const file = e.dataTransfer.files?.[0] ?? null;
    if (!file) return;
    if (sheetFileKind(file.name) === "unsupported") {
      setNotice(unsupportedFileMessage(file.name));
      return;
    }
    setDropped({ file, handle: item ? await handleFromDrop(item) : null });
  }

  /** Save what is open, then hand the dropped file to a fresh workspace. */
  async function confirmDrop() {
    if (!dropped) return;
    setOpening(true);
    try {
      /* Both stores, and both before anything is replaced. `flush` cancels the
         debounce and writes now, so the couple of seconds of typing that had
         not reached the file yet is not the price of opening another one. */
      await local.flush();
      persistence.saveNow();
      if (onOpenFile) {
        onOpenFile(dropped.file, dropped.handle);
        return;
      }
      /* No list above us to open a workspace — load in place, which is what a
         standalone spreadsheet can offer. Still only after the question. */
      const result = await loadFileIntoWorkbook(controller, dropped.file);
      setNotice(result.message);
      if (result.ok) {
        persistence.rename(result.title);
        if (dropped.handle && local.supported)
          await bindUnlessLossy(dropped.handle, dropped.file, result.title);
      }
    } finally {
      setOpening(false);
      setDropped(null);
    }
  }

  /**
   * A file the workspace was opened onto — loaded once, on mount.
   *
   * The list remounts this component for every open (its `key` changes), so
   * "once" is genuinely once and the effect needs no guard beyond the file's
   * own identity.
   */
  useEffect(() => {
    if (!openFile) return;
    let cancelled = false;
    (async () => {
      const result = await loadFileIntoWorkbook(controller, openFile.file);
      if (cancelled) return;
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      persistence.rename(result.title);
      if (openFile.handle && local.supported) {
        /* Through the guard, not straight to `bind` — a file Cowork cannot
           reproduce must be asked about before it is saved over. */
        await bindUnlessLossy(openFile.handle, openFile.file, result.title);
      } else {
        setNotice(
          `Opened a copy of “${openFile.file.name}”. The file on your computer is not changed.`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    /* Mount-only: `controller`, `persistence` and `local` are rebuilt every
       render, and listing them would reload the file continuously. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFile]);

  return (
    /* `sheet-light` keeps the spreadsheet on a light surface whatever theme the
       surrounding application is in — see the note in globals.css: cell fills and
       conditional-format colours are picked against a white grid, so the ground
       under them has to stay white. */
    <div
      className="sheet-light relative flex h-full min-h-0 flex-1 flex-col gap-2.5 p-2.5"
      onDragEnter={(e) => {
        if (!dragHasFiles(e.dataTransfer?.types as readonly string[] | undefined)) return;
        setDragDepth((d) => d + 1);
      }}
      onDragOver={(e) => {
        if (!dragHasFiles(e.dataTransfer?.types as readonly string[] | undefined)) return;
        /* Without this the browser navigates to the file instead of dropping
           it — the whole sheet is replaced by a download. */
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!dragHasFiles(e.dataTransfer?.types as readonly string[] | undefined)) return;
        setDragDepth((d) => Math.max(0, d - 1));
      }}
      onDrop={(e) => void onDropFile(e)}
    >
      {/**
        * The dropped file, as a question.
        *
        * Named in full — the file, and what happens to what is open — because
        * the two things a person needs to know before saying yes are "which
        * file" and "what happens to my work". A bare "Open this file?" answers
        * neither, and the answer to the second used to be "it is gone".
        */}
      {/**
        * The link, offered rather than taken.
        *
        * The file is already OPEN at this point — reading costs nothing. What
        * is being asked is whether Cowork may start writing over it, which for
        * this file means replacing a formatted document with what Cowork's own
        * model can express. "Keep it as a copy" is first and is the safe
        * answer; the other is spelled out rather than labelled "OK".
        */}
      {linkRisk && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Save back to this file?"
            className="w-full max-w-md rounded-panel border border-hairline bg-[var(--surface-raised)] p-4 shadow-[var(--deck-seat)]"
          >
            <p className="text-sm font-medium text-ink">Save back to this file?</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
              {linkRisk.warning}
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
              The sheet is already open either way — this is only about whether
              Cowork writes to the file on your computer.
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => {
                  setLinkRisk(null);
                  setNotice(
                    "Opened as a copy. The file on your computer is untouched.",
                  );
                }}
                className="inline-flex h-8 items-center rounded-full bg-ink px-3.5 text-[13px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90"
              >
                Keep it as a copy
              </button>
              <button
                type="button"
                onClick={() => {
                  const r = linkRisk;
                  setLinkRisk(null);
                  void local.bind(r.handle, r.title).then((bound) =>
                    setNotice(
                      bound
                        ? "Linked. The next save will rewrite the file without that formatting."
                        : "Cowork wasn’t given permission to write to that file.",
                    ),
                  );
                }}
                className="inline-flex h-8 items-center rounded-full px-3.5 text-[13px] text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]"
              >
                Link anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {dropped && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Open the dropped file"
            className="w-full max-w-md rounded-panel border border-hairline bg-[var(--surface-raised)] p-4 shadow-[var(--deck-seat)]"
          >
            <p className="text-sm font-medium text-ink">
              Open “{dropped.file.name}”?
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
              {onOpenFile
                ? "This sheet is saved and closed first, and the file opens in a new sheet — nothing here is overwritten."
                : "This sheet is saved first, then its contents are replaced by the file."}
              {dropped.handle && local.supported
                ? " Edits will save straight back to the file on your computer."
                : " It opens as a copy; the file on your computer is not changed."}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDropped(null)}
                className="inline-flex h-8 items-center rounded-full px-3.5 text-[13px] text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                disabled={opening}
                onClick={() => void confirmDrop()}
                className="inline-flex h-8 items-center rounded-full bg-ink px-3.5 text-[13px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {opening ? "Saving…" : "Save and open"}
              </button>
            </div>
          </div>
        </div>
      )}

      {dragDepth > 0 && (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-card bg-[color-mix(in_srgb,#ffffff_78%,transparent)] backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-1.5 rounded-panel border border-dashed border-[color-mix(in_srgb,var(--ink)_40%,transparent)] px-8 py-6">
            <p className="text-sm font-medium text-ink">Drop to open</p>
            <p className="text-[11px] text-ink-faint">
              .xlsx, .csv or .json — it opens in a new sheet
            </p>
          </div>
        </div>
      )}

      <WorkbookHeader
        persistence={persistence}
        onBack={onBack}
        collab={collab}
        local={local}
        notice={notice}
      />

      <Ribbon
        controller={controller}
        persistence={persistence}
        local={local}
        onNewSheet={onNewSheet}
        onSearchOpen={setSearch}
      />

      <div className="flex shrink-0 items-center gap-2.5">
        {/* Name box — the active cell or range; typed into, it jumps to an
            address, selects a name, or names the selection. */}
        <NameBox controller={controller} onDone={() => gridRef.current?.focus()} />
        <div className="min-w-0 flex-1">
          <FormulaBar
            controller={controller}
            onCommitted={() => gridRef.current?.focus()}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <SpreadsheetGrid
          controller={controller}
          containerRef={gridRef}
          searchOpen={search}
          onSearchOpen={setSearch}
          peers={collab.cursors}
        />
      </div>

      <SheetTabBar controller={controller} />
    </div>
  );
}
