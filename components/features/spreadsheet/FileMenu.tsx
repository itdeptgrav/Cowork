"use client";

/**
 * The File menu — one place for everything that acts on the WORKBOOK rather than
 * on its cells: making one, moving it in and out of the app, sharing it, and
 * looking at what it is.
 *
 * Every item does something real. Where an action needs more than a click it
 * opens a small dialog (share, details, settings) rather than a menu item that
 * quietly does nothing, and where the app already has the behaviour — autosave,
 * the io modules — the item drives that rather than a second implementation.
 */

import { ShortcutsDialog } from "./ShortcutsDialog";
import { useEffect, useRef, useState } from "react";
import type { WorkbookVersion } from "@/lib/spreadsheet/workbookClient";
import { rangeLabel } from "@/lib/spreadsheet/coordinates";
import {
  createWorkbook,
  listShares,
  setShares,
  WorkbookRequestError,
  type ShareGrant,
} from "@/lib/spreadsheet/workbookClient";
import type { SpreadsheetController } from "./useSpreadsheet";
import type { WorkbookPersistence } from "./useWorkbookPersistence";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const trigger =
  "inline-flex h-7 items-center rounded-md px-2 text-[12px] text-ink-muted transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink";
const item =
  "flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px] text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent";
const field =
  "h-8 w-full rounded-md border border-hairline bg-[var(--surface-raised)] px-2 text-[13px] text-ink outline-none";
const primary =
  "h-7 rounded-md bg-ink px-2.5 text-[12px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-40";
const quiet = "h-7 rounded-md px-2 text-[12px] text-ink-muted transition-colors hover:text-ink";

function safeName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim() || "workbook";
}
function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}
function download(filename: string, parts: BlobPart[], mime: string): void {
  const url = URL.createObjectURL(new Blob(parts, { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A centred modal. Escape and a backdrop click both close it. */
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(0,0,0,0.35)] p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="sheet-light flex w-full max-w-sm flex-col gap-3 rounded-card border border-hairline bg-[var(--surface-raised)] p-4 shadow-lg"
      >
        <div className="text-[14px] font-medium text-ink">{title}</div>
        {children}
      </div>
    </div>
  );
}

/* ── Share ─────────────────────────────────────────────────────────────────── */

function ShareDialog({
  workbookId,
  onClose,
}: {
  workbookId: string | null;
  onClose: () => void;
}) {
  const [grants, setGrants] = useState<ShareGrant[] | null>(null);
  const [who, setWho] = useState("");
  const [role, setRole] = useState<ShareGrant["role"]>("editor");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!workbookId) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listShares(workbookId);
        if (!cancelled) setGrants(list);
      } catch (e) {
        if (cancelled) return;
        setGrants([]);
        setError(
          e instanceof WorkbookRequestError && e.status === 403
            ? "Only the owner can manage sharing."
            : "Couldn’t load who this is shared with.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workbookId]);

  async function commit(next: ShareGrant[]) {
    if (!workbookId) return;
    setSaving(true);
    setError(null);
    try {
      setGrants(await setShares(workbookId, next));
    } catch (e) {
      setError(e instanceof WorkbookRequestError ? e.message : "Couldn’t update sharing.");
    } finally {
      setSaving(false);
    }
  }

  function add() {
    const id = who.trim();
    if (!id || !grants) return;
    void commit([...grants.filter((g) => g.principalId !== id), { principalId: id, role }]);
    setWho("");
  }

  return (
    <Dialog title="Share this sheet" onClose={onClose}>
      {!workbookId && <p className="text-[12px] text-ink-muted">Save this sheet before sharing it.</p>}
      {error && <p className="text-[12px] text-red-500">{error}</p>}

      {workbookId && (
        <>
          <div className="flex items-center gap-1.5">
            <input
              className={field}
              placeholder="Person’s account id"
              value={who}
              onChange={(e) => setWho(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <select
              className="h-8 shrink-0 rounded-md border border-hairline bg-[var(--surface-raised)] px-1.5 text-[12px] text-ink outline-none"
              value={role}
              onChange={(e) => setRole(e.target.value as ShareGrant["role"])}
            >
              <option value="viewer">Viewer</option>
              <option value="commenter">Commenter</option>
              <option value="editor">Editor</option>
            </select>
            <button type="button" className={primary} disabled={!who.trim() || saving} onClick={add}>
              Add
            </button>
          </div>

          <div className="flex flex-col gap-1">
            {grants === null && <p className="text-[12px] text-ink-muted">Loading…</p>}
            {grants?.length === 0 && (
              <p className="text-[12px] text-ink-muted">
                Not shared with anyone — only you can open it.
              </p>
            )}
            {grants?.map((g) => (
              <div key={g.principalId} className="flex items-center gap-2 rounded-md border border-hairline px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{g.principalId}</span>
                <select
                  className="h-7 shrink-0 rounded-md border border-hairline bg-[var(--surface-raised)] px-1 text-[11px] text-ink outline-none"
                  value={g.role}
                  disabled={saving}
                  onChange={(e) =>
                    void commit(
                      grants.map((x) =>
                        x.principalId === g.principalId
                          ? { ...x, role: e.target.value as ShareGrant["role"] }
                          : x,
                      ),
                    )
                  }
                >
                  <option value="viewer">Viewer</option>
                  <option value="commenter">Commenter</option>
                  <option value="editor">Editor</option>
                </select>
                <button
                  type="button"
                  className={quiet}
                  disabled={saving}
                  aria-label={`Remove ${g.principalId}`}
                  onClick={() => void commit(grants.filter((x) => x.principalId !== g.principalId))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="flex justify-end">
        <button type="button" className={primary} onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

/* ── The menu ──────────────────────────────────────────────────────────────── */

export function FileMenu({
  controller,
  persistence,
  onNewSheet,
  variant = "bar",
}: {
  controller: SpreadsheetController;
  persistence: WorkbookPersistence;
  /** `"ribbon"` renders just the File button, with the ribbon supplying the card. */
  variant?: "bar" | "ribbon";
  /** Leave this workbook and start another — the browser owns that. */
  onNewSheet?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<null | "share" | "details" | "settings" | "saveAs" | "pageSetup" | "versions" | "shortcuts">(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saveAsTitle, setSaveAsTitle] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open]);

  /* "Saving…" is a claim about a write in progress; when the persistence state
     settles, the text shown settles with it — it used to stick at "Saving…"
     forever while the chip beside it said "Saved". Derived at render (no
     effect, no second state): the stored status is the REQUEST, the shown
     status folds in where the save actually got to. */
  const shownStatus =
    status === "Saving…"
      ? persistence.state === "saved"
        ? "Saved."
        : persistence.state === "saving" || persistence.state === "loading"
          ? status
          : null // an error state — the chip and its message take over
      : status;

  const choose = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith(".csv")) {
        controller.importCsv(baseName(file.name), await file.text());
        setStatus(`Imported “${file.name}” as a new sheet.`);
      } else if (lower.endsWith(".json")) {
        const r = controller.importJson(await file.text());
        setStatus(r.ok ? `Imported “${file.name}”.` : (r.error ?? "Import failed."));
      } else if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
        const r = await controller.importXlsx(await file.arrayBuffer());
        setStatus(r.ok ? `Imported “${file.name}”.` : (r.error ?? "Import failed."));
      } else {
        setStatus("Unsupported file. Choose a .csv, .json or .xlsx file.");
      }
    } catch {
      setStatus("That file couldn’t be read.");
    }
  }

  async function saveAsCopy() {
    const title = saveAsTitle.trim() || `${persistence.title} copy`;
    try {
      await createWorkbook(title, controller.serialize());
      setStatus(`Saved a copy as “${title}”.`);
      setDialog(null);
    } catch {
      setStatus("Couldn’t save a copy.");
    }
  }

  const wb = controller.workbook;
  const cellCount = wb.worksheets.reduce((n, s) => n + Object.keys(s.cells).length, 0);

  return (
    <div
      className={
        variant === "ribbon"
          ? "flex items-center"
          : "flex shrink-0 flex-wrap items-center gap-1 rounded-card border border-hairline bg-[var(--surface-raised)] px-2 py-1 text-[12px]"
      }
    >
      <div ref={ref} className="relative">
        <button
          type="button"
          className={trigger}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          File ▾
        </button>
        {open && (
          <div
            role="menu"
            className="absolute left-0 top-8 z-40 flex w-60 flex-col overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] py-1 shadow-lg"
          >
            <button type="button" className={item} disabled={!onNewSheet} onClick={choose(() => onNewSheet?.())}>
              New sheet
            </button>
            {/* Inline rather than wrapped in `choose`, so the ref is read in an
                event handler the linter can see as one. */}
            <button
              type="button"
              className={item}
              onClick={() => {
                setOpen(false);
                fileRef.current?.click();
              }}
            >
              Import…
            </button>
            <div className="my-1 h-px bg-[var(--color-hairline)]" />
            {/* "Saving…", not "Saved." — the write has been ASKED for here, not
                finished. Announcing the finish on the click was how a save that
                created nothing still reported success; the save chip beside the
                title is what reports the outcome, and it reads from the same
                state this does. */}
            <button type="button" className={item} onClick={choose(() => { persistence.saveNow(); setStatus("Saving…"); })}>
              Save <span className="text-ink-faint">{persistence.state === "saved" ? "Up to date" : ""}</span>
            </button>
            <button
              type="button"
              className={item}
              onClick={choose(() => {
                setSaveAsTitle(`${persistence.title} copy`);
                setDialog("saveAs");
              })}
            >
              Save as…
            </button>
            <div className="my-1 h-px bg-[var(--color-hairline)]" />
            <button type="button" className={item} onClick={choose(() => download(`${safeName(persistence.title)}.csv`, ["﻿", controller.exportCsv()], "text/csv;charset=utf-8"))}>
              Export CSV <span className="text-ink-faint">sheet</span>
            </button>
            <button type="button" className={item} onClick={choose(() => download(`${safeName(persistence.title)}.json`, [controller.exportJson()], "application/json"))}>
              Export JSON <span className="text-ink-faint">workbook</span>
            </button>
            <button
              type="button"
              className={item}
              onClick={choose(async () => {
                try {
                  download(`${safeName(persistence.title)}.xlsx`, [await controller.exportXlsx()], XLSX_MIME);
                } catch {
                  setStatus("Couldn’t build the XLSX file.");
                }
              })}
            >
              Export XLSX <span className="text-ink-faint">workbook</span>
            </button>
            <div className="my-1 h-px bg-[var(--color-hairline)]" />
            <button
              type="button"
              className={item}
              onClick={choose(() => {
                const html = controller.printDocument(persistence.title);
                const w = window.open("", "_blank");
                if (!w) {
                  setStatus("The browser blocked the print window. Allow pop-ups for this site and try again.");
                  return;
                }
                w.document.open();
                w.document.write(html);
                w.document.close();
                w.focus();
                setTimeout(() => w.print(), 250);
              })}
            >
              Print… <span className="text-ink-faint">sheet</span>
            </button>
            <button type="button" className={item} onClick={choose(() => setDialog("pageSetup"))}>
              Page setup…
            </button>
            <button type="button" className={item} onClick={choose(() => setDialog("versions"))}>
              Version history…
            </button>
            <button type="button" className={item} onClick={choose(() => setDialog("shortcuts"))}>
              Keyboard shortcuts…
            </button>
            <div className="my-1 h-px bg-[var(--color-hairline)]" />
            <button type="button" className={item} onClick={choose(() => setDialog("share"))}>
              Share…
            </button>
            <button type="button" className={item} onClick={choose(() => setDialog("details"))}>
              Details
            </button>
            <button type="button" className={item} onClick={choose(() => setDialog("settings"))}>
              Settings
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.json,.xlsx,.xlsm,text/csv,application/json"
        className="hidden"
        onChange={onFile}
      />

      {shownStatus && (
        <span className="ml-1 truncate text-[11px] text-ink-muted" title={shownStatus}>
          {shownStatus}
        </span>
      )}

      {dialog === "share" && (
        <ShareDialog workbookId={persistence.workbookId} onClose={() => setDialog(null)} />
      )}

      {dialog === "saveAs" && (
        <Dialog title="Save a copy" onClose={() => setDialog(null)}>
          <input
            className={field}
            autoFocus
            value={saveAsTitle}
            onChange={(e) => setSaveAsTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void saveAsCopy();
              }
            }}
          />
          <p className="text-[11px] text-ink-muted">
            Copies the workbook as it is now. The original stays open.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={quiet} onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button type="button" className={primary} onClick={() => void saveAsCopy()}>
              Save copy
            </button>
          </div>
        </Dialog>
      )}

      {dialog === "shortcuts" && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === "versions" && (
        <Dialog title="Version history" onClose={() => setDialog(null)}>
          <VersionHistoryPanel persistence={persistence} onClose={() => setDialog(null)} />
        </Dialog>
      )}

      {dialog === "pageSetup" && (
        <Dialog title="Page setup" onClose={() => setDialog(null)}>
          <PageSetupForm controller={controller} />
          <div className="flex justify-end gap-2">
            <button type="button" className={primary} onClick={() => setDialog(null)}>
              Done
            </button>
          </div>
        </Dialog>
      )}

      {dialog === "details" && (
        <Dialog title="Details" onClose={() => setDialog(null)}>
          <dl className="flex flex-col gap-1.5 text-[12px]">
            {[
              ["Title", persistence.title],
              ["Sheets", String(wb.worksheets.length)],
              ["Cells with content", String(cellCount)],
              ["Distinct styles", String(controller.styleRegistry.size())],
              ["Save state", persistence.state],
              ["Stored id", persistence.workbookId ?? "Not saved yet"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-ink-muted">{k}</dt>
                <dd className="truncate text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex justify-end">
            <button type="button" className={primary} onClick={() => setDialog(null)}>
              Close
            </button>
          </div>
        </Dialog>
      )}

      {dialog === "settings" && (
        <Dialog title="Sheet settings" onClose={() => setDialog(null)}>
          <label className="flex items-center justify-between gap-4 text-[12px] text-ink">
            Freeze the first row
            <input
              type="checkbox"
              checked={controller.worksheet.frozenRows > 0}
              onChange={(e) => controller.freezeRows(e.target.checked ? 1 : 0)}
            />
          </label>
          <label className="flex items-center justify-between gap-4 text-[12px] text-ink">
            Freeze the first column
            <input
              type="checkbox"
              checked={controller.worksheet.frozenCols > 0}
              onChange={(e) => controller.freezeCols(e.target.checked ? 1 : 0)}
            />
          </label>
          <p className="text-[11px] text-ink-muted">
            Changes apply to “{controller.worksheet.name}” and save with the workbook.
          </p>
          <div className="flex justify-end">
            <button type="button" className={primary} onClick={() => setDialog(null)}>
              Done
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/**
 * The sheet's page — paper, orientation, margins, what prints. It belongs to
 * the sheet and saves with it, so everyone prints the same page.
 */
function PageSetupForm({ controller }: { controller: SpreadsheetController }) {
  const s = controller.pageSetup;
  const select = "h-8 w-full rounded-md border border-hairline bg-transparent px-2 text-[12px] text-ink outline-none focus:border-ink";
  const check = (label: string, key: "gridlines" | "headings" | "title" | "fitToWidth") => (
    <label key={key} className="flex items-center gap-2 text-[12px] text-ink">
      <input type="checkbox" checked={s[key]} onChange={(e) => controller.setPageSetup({ [key]: e.target.checked })} />
      {label}
    </label>
  );
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-3 gap-2">
        <label className="text-[11px] text-ink-muted">
          Paper
          <select className={select} value={s.paper} onChange={(e) => controller.setPageSetup({ paper: e.target.value as typeof s.paper })}>
            <option value="A4">A4</option>
            <option value="Letter">Letter</option>
            <option value="Legal">Legal</option>
          </select>
        </label>
        <label className="text-[11px] text-ink-muted">
          Orientation
          <select className={select} value={s.orientation} onChange={(e) => controller.setPageSetup({ orientation: e.target.value as typeof s.orientation })}>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
        <label className="text-[11px] text-ink-muted">
          Margins
          <select className={select} value={s.margins} onChange={(e) => controller.setPageSetup({ margins: e.target.value as typeof s.margins })}>
            <option value="normal">Normal</option>
            <option value="narrow">Narrow</option>
            <option value="wide">Wide</option>
          </select>
        </label>
      </div>
      {check("Print gridlines", "gridlines")}
      {check("Print row numbers and column letters", "headings")}
      {check("Print the title above the table", "title")}
      {check("Fit the table to the page width", "fitToWidth")}
      <div className="flex items-center justify-between gap-2 rounded-md border border-hairline px-2 py-1.5 text-[12px]">
        <span className="text-ink-muted">
          {s.area ? <>Print area: <span className="font-mono text-ink">{rangeLabel(s.area)}</span></> : "Prints everything that has content."}
        </span>
        <span className="flex gap-1">
          <button type="button" className={quiet} onClick={() => controller.setPrintArea(true)}>
            Use selection
          </button>
          {s.area && (
            <button type="button" className={quiet} onClick={() => controller.setPrintArea(false)}>
              Clear
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * Named checkpoints of the workbook. "Keep a version" saves what is on
 * screen under a name; Restore puts a version back as the live content —
 * after keeping the current state as a version of its own, so a restore
 * can itself be undone from this list.
 */
function VersionHistoryPanel({ persistence, onClose }: { persistence: WorkbookPersistence; onClose: () => void }) {
  const [versions, setVersions] = useState<WorkbookVersion[] | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { listVersions } = persistence;
  const stored = persistence.workbookId !== null;

  useEffect(() => {
    let cancelled = false;
    listVersions()
      .then((v) => {
        if (!cancelled) setVersions(v);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setVersions([]);
          setError(e instanceof Error ? e.message : "Could not load the versions.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [listVersions]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      setVersions(await persistence.listVersions());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex flex-col gap-2.5">
      {!stored && <p className="text-[12px] text-ink-muted">Save this sheet first; a draft has no history yet.</p>}
      <div className="flex items-center gap-1.5">
        <input
          className={field}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name this version, e.g. Sent to finance"
          onKeyDown={(e) => {
            if (e.key === "Enter" && label.trim()) {
              e.preventDefault();
              void run("save", async () => {
                await persistence.saveVersion(label.trim());
                setLabel("");
              });
            }
          }}
        />
        <button
          type="button"
          className={primary}
          disabled={!label.trim() || busy !== null}
          onClick={() => void run("save", async () => {
            await persistence.saveVersion(label.trim());
            setLabel("");
          })}
        >
          {busy === "save" ? "Keeping…" : "Keep a version"}
        </button>
      </div>
      {error && <p className="text-[11.5px] text-[var(--state-overdue-ink,#b42318)]">{error}</p>}
      {versions === null ? (
        <p className="text-[12px] text-ink-muted">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="text-[12px] text-ink-muted">No versions yet. Keep one before a big change, and come back here to restore it.</p>
      ) : (
        <ul className="max-h-64 divide-y divide-hairline overflow-y-auto rounded-md border border-hairline">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center gap-2 px-2.5 py-2 text-[12px]">
              <div className="min-w-0 flex-1">
                <p className="truncate text-ink">{v.label || (v.auto ? "Automatic" : "Version")}{v.auto && <span className="ml-1 text-[10px] text-ink-faint">auto</span>}</p>
                <p className="truncate text-[11px] text-ink-faint">{when(v.createdAt)}{v.createdByName ? ` · ${v.createdByName}` : ""}</p>
              </div>
              <button
                type="button"
                className={quiet}
                disabled={busy !== null}
                onClick={() => {
                  if (!window.confirm(`Restore "${v.label || "this version"}"? What is on screen now is kept as a version first.`)) return;
                  void run(v.id, async () => {
                    await persistence.restoreVersion(v.id);
                    onClose();
                  });
                }}
              >
                {busy === v.id ? "Restoring…" : "Restore"}
              </button>
              <button
                type="button"
                className={quiet}
                disabled={busy !== null}
                aria-label={`Delete the version ${v.label}`}
                onClick={() => void run(`del-${v.id}`, () => persistence.deleteVersion(v.id))}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
