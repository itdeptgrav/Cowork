"use client";

/**
 * The comment thread on a cell.
 *
 * It shows every entry in order — author, when, body — and lets you add a reply,
 * edit or delete an entry, or resolve the whole thread. The thread's shape is
 * already the collaborative one (many authored entries under one cell), so this
 * view does not change when real collaborators arrive: only the author stamped
 * on a new entry does.
 */

import { useEffect, useRef, useState } from "react";
import type { CommentThread } from "@/lib/spreadsheet/comments";

function when(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

const areaClass =
  "w-full resize-none rounded-md border border-hairline bg-[var(--surface-raised)] px-2 py-1.5 text-[13px] text-ink outline-none focus:border-[color-mix(in_srgb,var(--ink)_35%,transparent)]";
const smallBtn = "h-6 rounded px-1.5 text-[11px] text-ink-muted transition-colors hover:text-ink";

export function CommentPopover({
  x,
  y,
  label,
  thread,
  onAdd,
  onEdit,
  onRemove,
  onResolve,
  onClose,
}: {
  x: number;
  y: number;
  /** The cell's A1 label, shown as the thread heading. */
  label: string;
  thread: CommentThread | undefined;
  onAdd: (body: string) => void;
  onEdit: (entryId: string, body: string) => void;
  onRemove: (entryId: string) => void;
  onResolve: (resolved: boolean) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const entries = thread?.entries ?? [];

  function add() {
    const body = draft.trim();
    if (!body) return;
    onAdd(body);
    setDraft("");
  }

  function saveEdit(id: string) {
    const body = editText.trim();
    if (body) onEdit(id, body);
    setEditingId(null);
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 flex w-72 flex-col gap-2 rounded-card border border-hairline bg-[var(--surface-raised)] p-3 shadow-lg"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-ink-muted">
          Comments · {label}
          {thread?.resolved ? " · resolved" : ""}
        </span>
        {entries.length > 0 && (
          <button type="button" className={smallBtn} onClick={() => onResolve(!thread?.resolved)}>
            {thread?.resolved ? "Reopen" : "Resolve"}
          </button>
        )}
      </div>

      {entries.length > 0 && (
        <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
          {entries.map((e) => (
            <div key={e.id} className="rounded-md border border-hairline p-2">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-medium text-ink">{e.author}</span>
                <span className="text-[10px] text-ink-faint">{when(e.timestamp)}</span>
              </div>
              {editingId === e.id ? (
                <>
                  <textarea
                    className={areaClass}
                    rows={2}
                    value={editText}
                    onChange={(ev) => setEditText(ev.target.value)}
                    autoFocus
                  />
                  <div className="mt-1 flex justify-end gap-1">
                    <button type="button" className={smallBtn} onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                    <button type="button" className={smallBtn} onClick={() => saveEdit(e.id)}>
                      Save
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="whitespace-pre-wrap text-[13px] text-ink">{e.body}</div>
                  <div className="mt-1 flex justify-end gap-1">
                    <button
                      type="button"
                      className={smallBtn}
                      onClick={() => {
                        setEditingId(e.id);
                        setEditText(e.body);
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" className={smallBtn} onClick={() => onRemove(e.id)}>
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <textarea
        className={areaClass}
        rows={2}
        placeholder={entries.length > 0 ? "Reply…" : "Add a comment…"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            add();
          }
        }}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-ink-faint">⌘/Ctrl+Enter</span>
        <button
          type="button"
          disabled={draft.trim() === ""}
          className="h-7 rounded-md bg-ink px-2.5 text-[12px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
          onClick={add}
        >
          {entries.length > 0 ? "Reply" : "Comment"}
        </button>
      </div>
    </div>
  );
}
