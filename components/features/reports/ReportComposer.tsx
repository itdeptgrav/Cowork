"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { useRepo } from "@/lib/hooks/useRepository";
import { formatDuration } from "@/lib/utils/format";
import type { ReportAttachment } from "@/lib/domain";

/**
 * One task's daily report, being written.
 *
 * The same control in both places a report is filed from — the end-of-day
 * modal, which stacks one per task worked, and a task's own Reports tab, which
 * shows a single one when a report is owed. Written once because the two must
 * not drift: a field that exists in the modal and not on the tab is a field
 * half the reports are missing.
 *
 * Fully controlled. It owns no draft state of its own beyond the transient
 * upload queue — the parent holds the draft, because the parent is what
 * submits, and a component that both held and submitted its own state would
 * have to be asked for it.
 */

export interface ReportDraft {
  taskId: string;
  taskTitle: string;
  totalSecs: number;
  message: string;
  progressPercent: number;
  attachments: ReportAttachment[];
  documentId: string | null;
  documentTitle: string | null;
}

/** Files still going up, shown beside the ones that landed. */
interface Uploading {
  key: string;
  name: string;
  error: string | null;
}

/**
 * The link to open a report's document in the real Cowork Docs editor.
 *
 * `reportTaskId`/`reportTaskTitle`/`progress` ride along in the query string
 * so the editor — opened in its own tab, a full window with no room left for
 * this composer — knows which report it is the long form of, and can offer to
 * finish it. See `DocumentEditor.tsx`'s `reportTaskId` prop.
 */
function docHref(draft: ReportDraft): string {
  const params = new URLSearchParams({
    mode: "docs",
    doc: draft.documentId ?? "",
    reportTaskId: draft.taskId,
    reportTaskTitle: draft.taskTitle,
    progress: String(draft.progressPercent),
  });
  return `/workspace?${params.toString()}`;
}

export function ReportComposer({
  draft,
  onChange,
  disabled = false,
}: {
  draft: ReportDraft;
  onChange: (patch: Partial<ReportDraft>) => void;
  disabled?: boolean;
}) {
  const repo = useRepo();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const [docBusy, setDocBusy] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  /* Uploads ride the public Drive path, the same one message attachments use.
     A report's files are read back as URLs — that is the shape legacy stores
     and the shape the old application reads — so the private attachment store,
     which hands back ids, is the wrong end of the system for this. */
  const canUpload = typeof repo.uploadDriveFile === "function";
  const canDoc = typeof repo.createDocument === "function";

  async function pick(files: FileList | null) {
    if (!files || !repo.uploadDriveFile) return;
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      setUploading((u) => [...u, { key, name: file.name, error: null }]);
      const r = await repo.uploadDriveFile(file);
      if (r.ok) {
        setUploading((u) => u.filter((x) => x.key !== key));
        onChange({
          attachments: [
            ...draft.attachments,
            {
              url: r.data.url,
              name: r.data.name || file.name,
              mimeType: r.data.mimeType || file.type,
            },
          ],
        });
      } else {
        setUploading((u) =>
          u.map((x) => (x.key === key ? { ...x, error: r.message } : x)),
        );
      }
    }
  }

  /**
   * Created here, written in the real editor.
   *
   * The document exists the moment it is asked for — not on submit — so the
   * link below has somewhere real to point. Opened in its OWN tab: the real
   * Cowork Docs editor is a full-window surface (menu bar, ruler, outline
   * rail, its own collaboration socket) that takes over the screen, and doing
   * that inside this composer would mean leaving whatever else is being
   * written up here. A mini embedded editor used to live in this component for
   * exactly that reason — it duplicated the real one instead of using it,
   * which is the thing a "link, not a copy" avoids.
   */
  async function startDoc() {
    if (!repo.createDocument) return;
    setDocBusy(true);
    setDocError(null);
    const title = `Daily report — ${draft.taskTitle}`;
    const r = await repo.createDocument({ title, kind: "doc" });
    setDocBusy(false);
    if (!r.ok) {
      setDocError(r.message);
      return;
    }
    onChange({ documentId: r.data.id, documentTitle: title });
    window.open(docHref({ ...draft, documentId: r.data.id, documentTitle: title }), "_blank", "noopener,noreferrer");
  }

  return (
    <div className="rounded-[16px] border border-black/8 bg-black/4 p-4 dark:border-white/8 dark:bg-white/4">
      {/* Task title + time worked today */}
      <div className="mb-3 flex items-start gap-3">
        <p className="min-w-0 flex-1 text-[14px] leading-snug font-medium text-ink">
          {draft.taskTitle}
        </p>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-black/8 px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-ink-muted dark:bg-white/10">
          <Icon.clock className="h-3 w-3" />
          {formatDuration(draft.totalSecs)}
        </span>
      </div>

      <textarea
        rows={2}
        disabled={disabled}
        placeholder="What did you accomplish? Any blockers?"
        value={draft.message}
        onChange={(e) => onChange({ message: e.target.value })}
        className="w-full resize-none rounded-xl border border-black/8 bg-[var(--surface-raised)] px-3 py-2 text-[13px] leading-relaxed text-ink outline-none transition-all placeholder:text-ink-faint/50 focus:border-ink/20 focus:ring-1 focus:ring-ink/10 disabled:opacity-50 dark:border-white/8"
      />

      {/* ── Attached files ───────────────────────────────────────── */}
      {(draft.attachments.length > 0 || uploading.length > 0) && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {draft.attachments.map((a) => (
            <li
              key={a.url}
              className="flex items-center gap-1.5 rounded-lg bg-black/6 py-1 pr-1 pl-2 text-[11px] text-ink-muted dark:bg-white/8"
            >
              <Icon.attach className="h-3 w-3 shrink-0" />
              <span className="max-w-[160px] truncate">{a.name}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${a.name}`}
                onClick={() =>
                  onChange({
                    attachments: draft.attachments.filter(
                      (x) => x.url !== a.url,
                    ),
                  })
                }
                className="rounded p-0.5 transition-colors hover:bg-black/10 dark:hover:bg-white/12"
              >
                <Icon.close className="h-3 w-3" />
              </button>
            </li>
          ))}
          {uploading.map((u) => (
            <li
              key={u.key}
              className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] ${
                u.error
                  ? "bg-[var(--state-overdue)] text-[var(--state-overdue-ink)]"
                  : "bg-black/6 text-ink-faint dark:bg-white/8"
              }`}
            >
              {!u.error && (
                <span className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-ink-faint border-t-transparent" />
              )}
              <span className="max-w-[160px] truncate">{u.name}</span>
              {u.error && <span className="truncate">— {u.error}</span>}
            </li>
          ))}
        </ul>
      )}

      {/* ── The document — a link to the real editor, not a copy of it ──── */}
      {draft.documentId && (
        <a
          href={docHref(draft)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center gap-2 rounded-xl border border-black/8 bg-[var(--surface-raised)] px-3 py-2 text-[12px] text-ink transition-colors hover:bg-black/4 dark:border-white/8 dark:hover:bg-white/6"
        >
          <Icon.overview className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
          <span className="min-w-0 flex-1 truncate">
            {draft.documentTitle ?? "Document"}
          </span>
          <span className="shrink-0 text-ink-faint">Open in Docs ↗</span>
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange({ documentId: null, documentTitle: null });
            }}
            className="shrink-0 rounded p-0.5 text-ink-faint transition-colors hover:bg-black/8 hover:text-ink dark:hover:bg-white/10"
            aria-label="Detach document"
          >
            <Icon.close className="h-3 w-3" />
          </button>
        </a>
      )}
      {docError && (
        <p className="mt-1.5 text-[11px] text-[var(--state-overdue-ink)]">
          {docError}
        </p>
      )}

      {/* ── Actions + progress ───────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          {canUpload && (
            <>
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void pick(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-ink-muted transition-colors hover:bg-black/8 hover:text-ink disabled:opacity-40 dark:hover:bg-white/10"
              >
                <Icon.attach className="h-3 w-3" /> Attach
              </button>
            </>
          )}
          {canDoc && !draft.documentId && (
            <button
              type="button"
              disabled={disabled || docBusy}
              onClick={() => void startDoc()}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-ink-muted transition-colors hover:bg-black/8 hover:text-ink disabled:opacity-40 dark:hover:bg-white/10"
            >
              <Icon.plus className="h-3 w-3" />
              {docBusy ? "Creating…" : "Write a doc"}
            </button>
          )}
        </div>

        {/**
         * **The percentage is gone, and nothing replaces it here.**
         *
         * It was five buttons — 0/25/50/75/100 — and the figure they produced
         * was an assertion, not a measurement: nobody can compute what fraction
         * of a task is done, so the number meant only what the person clicking
         * it hoped. This codebase already holds that line elsewhere — project
         * progress must be DERIVED, and a manually entered number may never
         * become the source of truth — and the daily report was the one place
         * the rule did not reach.
         *
         * The honest figure is the time the timer measured, and the header of
         * this card already carries it. Restating it down here would be the
         * same number twice in one panel.
         */}
      </div>
    </div>
  );
}
