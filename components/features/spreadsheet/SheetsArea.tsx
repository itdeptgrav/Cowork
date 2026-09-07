"use client";

/**
 * The Sheets surface: choose a workbook, then work in it.
 *
 * The same shape the other workspace surfaces use — a list of the things you
 * have, and a way to make another — rather than dropping straight into one
 * sheet. That matters beyond consistency: a workbook is a stored document, so
 * opening the surface must not CREATE one. Nothing is written until somebody
 * presses New.
 *
 * The list shows what you own and what has been shared with you, tagged so the
 * two are distinguishable, because "why can I not rename this" should be
 * answerable from the row itself.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  deleteWorkbook,
  duplicateWorkbook,
  listWorkbooks,
  renameWorkbook,
  setShares,
  WorkbookRequestError,
  type WorkbookErrorKind,
  type WorkbookSummary,
} from "@/lib/spreadsheet/workbookClient";
import {
  sheetsLoadError,
  sheetsLoadRetryable,
} from "@/lib/rules/sheets/loadError";
import { useQuery } from "@/lib/hooks/useRepository";
import {
  pickFileToOpen,
  supportsLocalFiles,
  type LocalFileHandle,
} from "@/lib/spreadsheet/localFile";
import { Spreadsheet } from "./Spreadsheet";
import {
  RecordTable,
  type RecordItem,
  type RecordMember,
  type DirectoryPerson,
} from "@/components/features/workspace/RecordTable";

/** The capability never changes, so there is nothing to subscribe to. */
function subscribeToNothing(): () => void {
  return () => {};
}

const primaryBtn =
  "inline-flex h-8 items-center rounded-full bg-ink px-3.5 text-[13px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-50";

export function SheetsArea() {
  const [openId, setOpenId] = useState<string | null>(null);
  /**
   * A file waiting for a workspace to open into.
   *
   * `handle` present means the workspace binds to the file and keeps it current
   * — "Open from this computer". `handle` null means the contents were read and
   * the file forgotten — "Upload a copy". Holding the distinction HERE, rather
   * than deciding it inside the sheet, is what stopped the two being
   * indistinguishable once you were in the grid.
   */
  const [pending, setPending] = useState<{
    file: File;
    handle: LocalFileHandle | null;
  } | null>(null);
  /* Bumped on every open, so `<Spreadsheet key=…>` remounts rather than
     reloading a new file into the controller that still holds the last one. */
  const [draftKey, setDraftKey] = useState(0);
  const [fileMenu, setFileMenu] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  /* Whether this browser can keep a file in step at all — see `localFile.ts`.
     Read through `useSyncExternalStore` so the server and the first client
     render agree; an effect would flash the item in after hydration. */
  const canLink = useSyncExternalStore(
    subscribeToNothing,
    supportsLocalFiles,
    () => false,
  );
  const [list, setList] = useState<WorkbookSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* The KIND, kept beside the sentence, because what to offer next depends on
     it: a Retry under a missing endpoint is a button that cannot work. */
  const [errorKind, setErrorKind] = useState<WorkbookErrorKind | null>(null);

  /**
   * Report a failed load, saying which failure it was.
   *
   * One place rather than two: the refresh and the on-open effect both land
   * here, and when this was written out twice the two drifted — which is how a
   * 404 came to be described in the same words as a dropped connection. The
   * non-`WorkbookRequestError` case is a real one (a bug in this file, say), so
   * it is passed as `null` and gets the sentence that is true of anything.
   */
  const reportFailure = useCallback((e: unknown) => {
    const kind = e instanceof WorkbookRequestError ? e.kind : null;
    setErrorKind(kind);
    setError(sheetsLoadError(kind));
    /* The detail a developer needs and a reader must not be shown. Without it
       the status and the server's own message are lost entirely. */
    if (e instanceof WorkbookRequestError)
      console.error(`Sheets: ${e.kind} (${e.status}) — ${e.message}`);
    else console.error("Sheets: load failed", e);
    setList([]);
  }, []);

  /* Cowork's people, so a sheet is shared by searching a NAME rather than
     pasting an internal id. The whole directory — sharing is not limited to
     people you have messaged — filtered client-side as you type. If it cannot
     load, the share panel simply falls back to its id field. */
  const peopleQ = useQuery((r) => r.listEmployees(), []);
  const directory = useMemo<DirectoryPerson[]>(
    () =>
      (peopleQ.data ?? []).map((p) => ({
        id: p.id,
        name: p.displayName,
        sub: p.designation ?? p.departmentName ?? undefined,
      })),
    [peopleQ.data],
  );

  const refresh = useCallback(async () => {
    try {
      const next = await listWorkbooks();
      setList(next);
      setError(null);
      setErrorKind(null);
    } catch (e) {
      reportFailure(e);
    }
  }, [reportFailure]);

  /* Reload whenever the browser is showing — so returning from a sheet shows its
     new title and timestamp rather than the list as it was when we left. The
     fetch is inlined (rather than calling `refresh`) so every state write
     provably follows an await, and `cancelled` stops a late response writing
     into a component that has since opened a sheet or unmounted. */
  useEffect(() => {
    if (openId !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await listWorkbooks();
        if (cancelled) return;
        setList(next);
        setError(null);
        setErrorKind(null);
      } catch (e) {
        if (cancelled) return;
        reportFailure(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openId, reportFailure]);

  /** Open a BLANK draft. Nothing is stored until the first edit — see
      `useWorkbookPersistence`; creating on click is what left empty
      "Untitled sheet" rows behind every time somebody looked at a new one. */
  function create() {
    setPending(null);
    setDraftKey((n) => n + 1);
    setOpenId("draft");
  }

  /**
   * Open a workspace onto a file.
   *
   * `draftKey` is bumped so the `key` on `<Spreadsheet>` changes and the
   * component REMOUNTS. Without it, opening a second file while a draft is
   * already open reuses the instance, and the new file loads into a controller
   * still holding the old sheet's cells.
   */
  function openWorkspaceWith(file: File, handle: LocalFileHandle | null) {
    setPending({ file, handle });
    setDraftKey((n) => n + 1);
    setOpenId("draft");
  }

  /**
   * "Open from this computer" — the live link.
   *
   * The picker IS the permission gesture, so the handle it returns can be bound
   * without a second prompt. Cancelling returns null and is not an error.
   */
  async function openFromComputer() {
    setFileMenu(false);
    const handle = await pickFileToOpen();
    if (!handle) return;
    try {
      openWorkspaceWith(await handle.getFile(), handle);
    } catch {
      setError("That file couldn’t be read.");
    }
  }

  /** "Upload a copy" — a plain read, stored in Cowork, no link to the file. */
  function uploadCopy() {
    setFileMenu(false);
    uploadRef.current?.click();
  }

  async function remove(id: string, title: string) {
    if (!globalThis.confirm?.(`Delete “${title}”? This cannot be undone.`)) return;
    try {
      await deleteWorkbook(id);
      await refresh();
    } catch {
      setError("Couldn’t delete that sheet.");
    }
  }

  if (openId) {
    /* An open sheet takes the whole window rather than the panel it was opened
       from. A spreadsheet is a work surface — the columns it cannot show are
       columns you have to scroll to — and this surface is reached from inside
       the workspace, where the page's own chrome would otherwise leave it a few
       hundred pixels tall. "← All sheets" is the way back out. */
    return (
      <div className="sheet-light fixed inset-0 z-50 flex flex-col">
        {/* Keyed on the choice: switching workbook — or File ▸ New sheet from an
            open one — must REMOUNT the spreadsheet. Reusing the instance kept the
            old workbook's cells and left persistence pointed at the old id with
            saving disarmed, so the "new" sheet showed stale content and silently
            stopped saving. */}
        <Spreadsheet
          key={openId === "draft" ? `draft-${draftKey}` : openId}
          workbookId={openId === "draft" ? null : openId}
          draft={openId === "draft"}
          openFile={pending}
          onBack={() => {
            setPending(null);
            setOpenId(null);
          }}
          onNewSheet={create}
          /* A file dropped onto an open sheet opens in a FRESH workspace
             rather than over the top of what is there — the sheet saves and
             closes itself first. See the drop handler in `Spreadsheet`. */
          onOpenFile={openWorkspaceWith}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <span className="text-[13px] text-ink-muted">
          {list === null ? "Loading…" : `${list.length} ${list.length === 1 ? "sheet" : "sheets"}`}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {/**
            * Opening a file, with the two ways named apart.
            *
            * They were one thing before — a drop — and it did whichever the
            * browser happened to allow, so nobody could tell whether the file on
            * their disk was being kept current or had merely been read once.
            * Naming them is the fix: "Open from this computer" keeps the file in
            * step, "Upload a copy" does not, and each says so under its label.
            */}
          <div className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={fileMenu}
              onClick={() => setFileMenu((o) => !o)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-hairline px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]"
            >
              Open file
              <span aria-hidden className="text-[10px] opacity-70">
                ▾
              </span>
            </button>
            {fileMenu && (
              <>
                {/* Catches the dismissing click. A menu that closes only on its
                    own items is one you have to choose your way out of. */}
                <div
                  className="fixed inset-0 z-40"
                  aria-hidden
                  onMouseDown={() => setFileMenu(false)}
                />
                <div
                  role="menu"
                  aria-label="Open file"
                  className="absolute end-0 z-50 mt-1 min-w-[268px] rounded-panel border border-hairline bg-[var(--surface-raised)] p-1 shadow-[var(--deck-seat)]"
                >
                  {canLink && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void openFromComputer()}
                      className="flex w-full flex-col items-start rounded-inset px-2.5 py-1.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)]"
                    >
                      <span className="text-[13px] text-ink">
                        Open from this computer
                      </span>
                      <span className="mt-0.5 text-[11px] leading-snug text-ink-muted">
                        Edits save straight back to the file on your disk.
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={uploadCopy}
                    className="flex w-full flex-col items-start rounded-inset px-2.5 py-1.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)]"
                  >
                    <span className="text-[13px] text-ink">Upload a copy</span>
                    <span className="mt-0.5 text-[11px] leading-snug text-ink-muted">
                      {canLink
                        ? "Kept in Cowork. The file on your disk is not changed."
                        : "Kept in Cowork. This browser can’t save back to a file — use Chrome or Edge for that."}
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
          <button type="button" className={primaryBtn} onClick={create}>
            New sheet
          </button>
        </div>
      </div>

      {/* The picker for "Upload a copy". Hidden, and reset after every choice so
          picking the same file twice still fires a change event. */}
      <input
        ref={uploadRef}
        type="file"
        accept=".csv,.tsv,.json,.xlsx,.xlsm"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) openWorkspaceWith(file, null);
        }}
      />

      {error && (
        <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-red-500">
          <span>{error}</span>
          {/* Only where pressing it could change the answer — see
              `sheetsLoadRetryable`. */}
          {sheetsLoadRetryable(errorKind) && (
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-full bg-[var(--control)] px-2.5 py-0.5 text-[12px] text-ink transition-colors hover:bg-[var(--control-hover)]"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {list !== null && list.length === 0 && !error && (
        <div className="rounded-card border border-hairline p-8 text-center">
          <p className="text-[15px] text-ink">No sheets yet</p>
          <p className="mt-1 text-[13px] text-ink-muted">
            Make one to start a spreadsheet — formulas, formatting, filters and all.
          </p>
          <button type="button" className={`${primaryBtn} mt-4`} onClick={create}>
            New sheet
          </button>
        </div>
      )}

      {list !== null && list.length > 0 && (
        <RecordTable
          noun="Sheet"
          items={list.map(toRecord)}
          /* Only once people are actually loaded — an empty array is truthy and
             would show the name search with nothing to find and no id fallback.
             Until then (or if the directory fails to load) the panel keeps its
             id field, so sharing is never blocked. */
          directory={directory.length ? directory : undefined}
          onOpen={(id) => setOpenId(id)}
          onRename={(id, title) => {
            /* Optimistic: the row shows the new name at once, and a failed
               rename is corrected by the refresh that follows. */
            setList((prev) => prev?.map((x) => (x.id === id ? { ...x, title } : x)) ?? prev);
            renameWorkbook(id, title).then(refresh, () => {
              setError("Couldn't rename that sheet.");
              void refresh();
            });
          }}
          onDuplicate={(id) => {
            const w = list.find((x) => x.id === id);
            duplicateWorkbook(id, `${w?.title ?? "Sheet"} copy`).then(refresh, () =>
              setError("Couldn't duplicate that sheet."),
            );
          }}
          onDelete={(id) => {
            const w = list.find((x) => x.id === id);
            if (w) void remove(w.id, w.title);
          }}
          onSetMembers={async (id, members) => {
            const saved = await setShares(
              id,
              members.map((m) => ({ principalId: m.id, role: m.role })),
            );
            void refresh();
            return saved.map((g) => ({ id: g.principalId, role: g.role }));
          }}
        />
      )}
    </div>
  );
}

/** A stored workbook as the shared workspace table wants it. Sheets carry no
    branch count and no task link, so both are simply absent. */
function toRecord(w: WorkbookSummary): RecordItem {
  return {
    id: w.id,
    title: w.title,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    createdBy: w.ownerId ?? "—",
    isMine: w.access === undefined || w.access === "owner",
    members: (w.shares ?? []).map((g): RecordMember => ({ id: g.principalId, role: g.role })),
  };
}
