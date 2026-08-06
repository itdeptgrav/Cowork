"use client";

import { useState } from "react";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { Icon } from "@/components/ui/Icons";
import { InlineError } from "@/components/ui/Primitives";
import { formatRelative } from "@/lib/utils/format";

/**
 * Version history — a list of checkpoints, and a way back to one of them.
 *
 * List and restore only. Comparing two versions (a diff view) is explicitly
 * out of scope for this pass — see `DocumentEditor.tsx`'s header note on what
 * this editor deliberately does not do yet.
 *
 * `useQuery`/`useAction` rather than a bespoke fetch: every mutation anywhere
 * in the app bumps a shared version counter (`notifyRepositoryChanged`), and
 * `useQuery` re-reads on it automatically, so saving or restoring a version
 * here refreshes this list without a manual `refetch()` — the same wiring
 * every other repository-backed panel in the product already relies on.
 */
export function DocsVersionHistory({
  documentId,
  /** Viewers may read history; only an editor or owner may checkpoint or
      restore — the same split `mayEdit` drives everywhere else in this
      editor, and the backend re-checks it regardless of what this renders. */
  canEdit,
  onClose,
  onRestored,
}: {
  documentId: string;
  canEdit: boolean;
  onClose: () => void;
  /** Fires after a restore lands, so the caller can tell the person what to
      expect from the live document rather than this panel guessing at it. */
  onRestored?: () => void;
}) {
  const versions = useQuery((r) => r.listDocumentVersions(documentId), [documentId]);
  const [labelDraft, setLabelDraft] = useState("");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoredNotice, setRestoredNotice] = useState(false);

  const [saveVersion, saveState] = useAction((r) =>
    r.saveDocumentVersion(documentId, labelDraft.trim() || undefined),
  );
  const [restoreVersion, restoreState] = useAction((r, versionId: string) =>
    r.restoreDocumentVersion(documentId, versionId),
  );

  async function handleSave() {
    const result = await saveVersion();
    if (result.ok) setLabelDraft("");
  }

  async function handleRestore(versionId: string, describedAs: string) {
    /* The same "ask before an irreversible action" pattern `MessagesArea.tsx`
       uses for deleting a message — a restore discards everything typed since
       the chosen version from the LIVE document, and there is no confirm step
       past this one. */
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Restore "${describedAs}"? Everything in this document since then will be replaced by that version. The version itself stays in this list either way.`,
      )
    )
      return;
    setRestoredNotice(false);
    setRestoringId(versionId);
    const result = await restoreVersion(versionId);
    setRestoringId(null);
    if (result.ok) {
      setRestoredNotice(true);
      onRestored?.();
    }
  }

  return (
    <aside
      aria-label="Version history"
      className="absolute inset-y-0 end-0 z-20 flex w-[340px] flex-col border-s border-hairline bg-[var(--surface-raised)] shadow-[var(--shadow-deck-seat)]"
    >
      <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-inset bg-[var(--control)] text-ink-muted">
          <Icon.history className="h-3.5 w-3.5" />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">
          Version history
        </h2>
        <button
          type="button"
          aria-label="Close version history"
          onClick={onClose}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-inset text-ink-faint hover:bg-[var(--control)] hover:text-ink"
        >
          <Icon.close className="h-3.5 w-3.5" />
        </button>
      </div>

      {canEdit && (
        <div className="border-b border-hairline px-3.5 py-2.5">
          <div className="flex gap-1.5">
            <input
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              placeholder="Label this version (optional)…"
              disabled={saveState.isPending}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
              }}
              className="min-w-0 flex-1 rounded-inset bg-[var(--surface-sunken)] px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-ink-faint outline-none disabled:opacity-50"
            />
            <button
              type="button"
              disabled={saveState.isPending}
              onClick={() => void handleSave()}
              className="shrink-0 rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {saveState.isPending ? "Saving…" : "Save version now"}
            </button>
          </div>
          {saveState.error && (
            <p className="mt-1.5 text-[11px] text-[var(--state-overdue-ink)]">{saveState.error}</p>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 scroll-slim">
        {versions.isLoading ? (
          <p className="text-[12.5px] text-ink-faint">Loading…</p>
        ) : versions.error ? (
          <InlineError compact message={versions.error} />
        ) : !versions.data || versions.data.length === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-ink-faint">
            No saved versions yet.{" "}
            {canEdit
              ? "This document checkpoints itself automatically while it is being actively edited, or save one by hand above."
              : "Nothing has been checkpointed for this document yet."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {versions.data.map((v) => {
              const describedAs = v.label || (v.authorId ? `${v.authorName}'s version` : "Autosaved checkpoint");
              return (
                <li key={v.id} className="rounded-inset border border-hairline p-2.5">
                  <p className="truncate text-[12.5px] text-ink" title={describedAs}>
                    {describedAs}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-faint">
                    {v.authorName} · {formatRelative(v.createdAt, new Date())}
                  </p>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={restoringId === v.id}
                      onClick={() => void handleRestore(v.id, describedAs)}
                      className="mt-1.5 rounded-full px-2 py-1 text-[10.5px] text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink disabled:opacity-50"
                    >
                      {restoringId === v.id ? "Restoring…" : "Restore"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {restoredNotice && (
        <p className="border-t border-hairline px-3.5 py-2 text-[11px] leading-relaxed text-ink-faint">
          Restored. The document&rsquo;s stored text now matches that version
          — a live session already open may not show it until it next
          resyncs.
        </p>
      )}
      {restoreState.error && (
        <div className="border-t border-hairline px-3.5 py-2">
          <InlineError compact message={restoreState.error} />
        </div>
      )}
    </aside>
  );
}
