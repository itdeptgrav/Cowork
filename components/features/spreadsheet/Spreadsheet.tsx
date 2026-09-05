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
import {
  canDecline,
  leaveMessage,
  leaveReason,
  mustAsk,
  saveLabel,
} from "@/lib/rules/sheets/leaveGuard";
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
   * A close waiting on the reader, because something is still unsaved.
   *
   * **Closing used to be silent.** The back arrow, and the browser's own back
   * button, shut the sheet on the spot — and a sheet autosaves, so *usually*
   * nothing was lost. "Usually" is not something a person can see, and the two
   * cases that are not safe look exactly like the one that is: a save still on
   * the wire, and a save that failed. So closing now asks whenever either
   * store is behind, and says which.
   *
   * The pending ACTION is held rather than a flag, because three different
   * controls close this sheet — the back arrow, browser back, and File ▸ Close
   * — and each has its own way of leaving. `leaveGuard` decides whether to
   * ask; this remembers what to do once the question is answered.
   */
  const [leaving, setLeaving] = useState<null | { run: () => void }>(null);
  const [leaveSaving, setLeaveSaving] = useState(false);
  /**
   * Has anything been changed since this sheet opened?
   *
   * **Not the same as "is a save outstanding".** Both stores autosave about a
   * second after you stop typing, so a second later everything reads `saved`
   * and a guard watching only the write state closed in silence — which from
   * the outside is indistinguishable from a sheet that never saved at all.
   *
   * Tracked from the workbook's identity, the same signal both autosavers use,
   * so this cannot disagree with them about whether something changed. Edits
   * during `loading` are the LOAD itself and do not count: the first workbook
   * a sheet settles on is its baseline, not an edit.
   */
  const [edited, setEdited] = useState(false);
  const baselineRef = useRef<object | null>(null);
  const wbForEdit = controller.workbook;
  useEffect(() => {
    if (persistence.state === "loading") {
      baselineRef.current = wbForEdit;
      return;
    }
    if (baselineRef.current === null) {
      baselineRef.current = wbForEdit;
      return;
    }
    if (baselineRef.current !== wbForEdit) setEdited(true);
  }, [wbForEdit, persistence.state]);
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

  /**
   * What closing this sheet would cost right now, and whether to ask first.
   *
   * Both stores, because either can be behind: a sheet safely in Cowork whose
   * write back to the file on the computer was refused has still lost the copy
   * the person was watching. `leaveGuard` owns the ordering and the wording.
   */
  const closeReason = leaveReason({
    cloud: persistence.state,
    file: local.state,
    edited,
  });

  /**
   * Leave — after asking, if anything is outstanding.
   *
   * Every way out of the sheet goes through here, so the back arrow, the
   * browser's back button and File ▸ Close cannot disagree about when it is
   * safe to close.
   */
  function requestClose(run: () => void) {
    if (!mustAsk(closeReason)) {
      run();
      return;
    }
    setLeaving({ run });
  }

  /** Finish the outstanding writes, then leave. */
  async function saveThenLeave() {
    if (!leaving) return;
    /* Nothing outstanding — the button says Close, not Save, so it must not
       flash "Saving…" over a write that would be a no-op. */
    if (!canDecline(closeReason)) {
      const { run } = leaving;
      setLeaving(null);
      run();
      return;
    }
    setLeaveSaving(true);
    try {
      await local.flush();
      persistence.saveNow();
    } finally {
      setLeaveSaving(false);
    }
    const { run } = leaving;
    setLeaving(null);
    run();
  }

  /** Save what is open, then hand the dropped file to a fresh workspace. */
  async function confirmDrop(save: boolean) {
    if (!dropped) return;
    setOpening(true);
    try {
      /* Both stores, and both before anything is replaced. `flush` cancels the
         debounce and writes now, so the couple of seconds of typing that had
         not reached the file yet is not the price of opening another one.
         Skipped entirely on "Don't save", which is the whole of that button:
         it does not undo anything — autosave has already stored what it has —
         it declines to WAIT for the write still outstanding. */
      if (save) {
        await local.flush();
        persistence.saveNow();
      }
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
   * The browser's own back button closes the SHEET, and asks first.
   *
   * The open sheet is a full-screen layer held in the list's state, not a
   * route — so back used to leave the whole Sheets page, taking the sheet with
   * it and saying nothing about whether the work had been stored. That is the
   * one exit that could lose something silently, because `beforeunload` does
   * not fire on a client-side navigation.
   *
   * So opening a sheet pushes one history entry, and back pops it: the gesture
   * now means "close this sheet", which is what a full-screen layer over a list
   * should do, and it goes through the same guard as every other way out.
   *
   * On cancel the entry is pushed BACK. Without it the reader has spent their
   * one back step to stay where they were, and the next press leaves the page
   * for real — the trap this exists to remove.
   */
  /* Mirrored in an effect rather than assigned during render — a ref written
     while rendering is read back inconsistently under concurrent React, and
     the listener below needs only the LATEST value, not a re-subscription per
     render. No dependency array: after every render is exactly the point. */
  const backRef = useRef<(() => void) | undefined>(onBack);
  const closeRef = useRef(requestClose);
  useEffect(() => {
    backRef.current = onBack;
    closeRef.current = requestClose;
  });
  useEffect(() => {
    if (!onBack) return;
    window.history.pushState({ coworkSheet: true }, "");
    const onPop = () => {
      closeRef.current(() => backRef.current?.());
      /* Restore the step, so a cancelled close does not consume it. It is
         popped again by the next back press, or left behind harmlessly when
         the sheet does close — the layer is gone either way. */
      window.history.pushState({ coworkSheet: true }, "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    /* Once per mounted sheet. The list remounts this component for every open
       (its `key` changes), so one entry is pushed per sheet rather than one
       per render. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      /* `sheet-chrome`: a drag across the toolbar, header or tab bar selects
         nothing — see globals.css. Typing fields inside stay selectable. */
      className="sheet-light sheet-chrome relative flex h-full min-h-0 flex-1 flex-col gap-2.5 p-2.5"
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

      {/**
        * Closing with something still unsaved.
        *
        * Same three answers as the drop question, for the same reason: the
        * reader is being asked to give up either their work or their exit, and
        * a two-button dialog makes one of those the only way out.
        *
        * "Don't save" does NOT revert anything — autosave has already stored
        * what it managed — it leaves without waiting for the write that is
        * outstanding. `leaveMessage` says which write that is, in those words.
        */}
      {leaving && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Close this sheet"
            className="w-full max-w-md rounded-panel border border-hairline bg-[var(--surface-raised)] p-4 shadow-[var(--deck-seat)]"
          >
            <p className="text-sm font-medium text-ink">Close this sheet?</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
              {leaveMessage(closeReason)}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLeaving(null)}
                className="inline-flex h-8 items-center rounded-full px-3.5 text-[13px] text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]"
              >
                Cancel
              </button>
              {/* Only where there is a write to decline. With everything
                  stored there is nothing to not-save — autosave cannot be
                  undone — so the button would either do nothing or imply a
                  revert, and a choice with no consequence teaches people the
                  whole dialog is decorative. */}
              {canDecline(closeReason) && (
                <button
                  type="button"
                  disabled={leaveSaving}
                  onClick={() => {
                    const { run } = leaving;
                    setLeaving(null);
                    run();
                  }}
                  className="inline-flex h-8 items-center rounded-full px-3.5 text-[13px] text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] disabled:opacity-50"
                >
                  Don&rsquo;t save
                </button>
              )}
              <button
                type="button"
                autoFocus
                disabled={leaveSaving}
                onClick={() => void saveThenLeave()}
                className="inline-flex h-8 items-center rounded-full bg-ink px-3.5 text-[13px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {leaveSaving ? "Saving…" : saveLabel(closeReason)}
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
              {/* **Three answers, not two.** "Save and open" was the only way
                  forward, so somebody who did not want to wait for a stuck or
                  slow save had to cancel and lose the drop entirely. This
                  declines the write rather than undoing anything — see
                  `confirmDrop`. */}
              <button
                type="button"
                disabled={opening}
                onClick={() => void confirmDrop(false)}
                className="inline-flex h-8 items-center rounded-full px-3.5 text-[13px] text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] disabled:opacity-50"
              >
                Don&rsquo;t save
              </button>
              <button
                type="button"
                autoFocus
                disabled={opening}
                onClick={() => void confirmDrop(true)}
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
        /* Through the guard, so the arrow and the browser button behave
           identically — see requestClose. */
        onBack={onBack ? () => requestClose(() => onBack()) : undefined}
        collab={collab}
        local={local}
        notice={notice}
      />

      <Ribbon
        controller={controller}
        persistence={persistence}
        local={local}
        onNewSheet={onNewSheet}
        onCloseFile={onBack ? () => requestClose(() => onBack()) : undefined}
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
