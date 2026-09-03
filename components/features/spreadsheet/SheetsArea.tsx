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

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteWorkbook,
  duplicateWorkbook,
  listWorkbooks,
  renameWorkbook,
  setShares,
  WorkbookRequestError,
  type WorkbookSummary,
} from "@/lib/spreadsheet/workbookClient";
import { useQuery } from "@/lib/hooks/useRepository";
import { Spreadsheet } from "./Spreadsheet";
import {
  RecordTable,
  type RecordItem,
  type RecordMember,
  type DirectoryPerson,
} from "@/components/features/workspace/RecordTable";

const primaryBtn =
  "inline-flex h-8 items-center rounded-full bg-ink px-3.5 text-[13px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-50";

export function SheetsArea() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [list, setList] = useState<WorkbookSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    } catch (e) {
      setError(
        e instanceof WorkbookRequestError && e.kind === "unauthorized"
          ? "Sign in to see your sheets."
          : "Couldn’t load your sheets.",
      );
      setList([]);
    }
  }, []);

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
      } catch (e) {
        if (cancelled) return;
        setError(
          e instanceof WorkbookRequestError && e.kind === "unauthorized"
            ? "Sign in to see your sheets."
            : "Couldn’t load your sheets.",
        );
        setList([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openId]);

  /** Open a BLANK draft. Nothing is stored until the first edit — see
      `useWorkbookPersistence`; creating on click is what left empty
      "Untitled sheet" rows behind every time somebody looked at a new one. */
  function create() {
    setOpenId("draft");
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
          key={openId}
          workbookId={openId === "draft" ? null : openId}
          draft={openId === "draft"}
          onBack={() => setOpenId(null)}
          onNewSheet={() => setOpenId("draft")}
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
        <button type="button" className={primaryBtn} onClick={create}>
          New sheet
        </button>
      </div>

      {error && <div className="text-[13px] text-red-500">{error}</div>}

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
