"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type * as Y from "yjs";
import { Icon } from "@/components/ui/Icons";
import { InlineError } from "@/components/ui/Primitives";
import {
  sortThreads,
  unresolvedCount,
  type CommentMessage,
  type CommentThread,
} from "@/lib/rules/documents/comments";
import { addCommentThread } from "@/lib/documents/commentsStore";

/**
 * The comment panel — threads anchored in the document, read live from the
 * same Yjs room the prose itself syncs through.
 *
 * `doc` is `collab.session?.doc ?? null`: comments need a live collaboration
 * room to have anywhere to live (see `comments.ts`'s header note on why this
 * rides the Yjs doc rather than a Firestore record of its own). A document
 * that never entered collaborative mode — offline, or the socket refused —
 * has no room for a thread to be written into, so the panel says so rather
 * than pretending to work and silently losing what was typed.
 */
export function DocsComments({
  editor,
  doc,
  me,
  activeThreadId,
  onActiveThreadChange,
  onClose,
}: {
  editor: Editor;
  doc: Y.Doc | null;
  me: { id: string; displayName: string } | null;
  /** The thread a click on a mark in the prose just asked to see, or null. */
  activeThreadId: string | null;
  onActiveThreadChange: (id: string | null) => void;
  onClose: () => void;
}) {
  const yThreads = useMemo(
    () => doc?.getMap<CommentThread>("comments") ?? null,
    [doc],
  );
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!yThreads) return;
    const bump = () => setVersion((n) => n + 1);
    yThreads.observe(bump);
    return () => yThreads.unobserve(bump);
  }, [yThreads]);

  const threads = useMemo(
    () => (yThreads ? sortThreads(Array.from(yThreads.values())) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the change signal; `yThreads` is read through, not depended on for its identity.
    [yThreads, version],
  );

  /* The current selection, read live — drives whether "New comment" is
     offered and what it quotes. A small selector rather than the full
     `useEditorState` selector this file avoids depending on: only the
     selection's own bounded text, the same "cheap, live" half
     `DocumentEditor.tsx`'s own perf fix kept reactive. */
  const [selection, setSelection] = useState(() => readSelection(editor));
  useEffect(() => {
    const update = () => setSelection(readSelection(editor));
    editor.on("selectionUpdate", update);
    editor.on("update", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("update", update);
    };
  }, [editor]);

  const [draft, setDraft] = useState("");
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    if (!activeThreadId) return;
    rowRefs.current.get(activeThreadId)?.scrollIntoView({ block: "nearest" });
  }, [activeThreadId]);

  function startThread() {
    if (!doc || !me || !selection.text.trim() || !draft.trim()) return;
    const id = addCommentThread({
      editor,
      doc,
      me,
      range: { from: selection.from, to: selection.to },
      anchorText: selection.text,
      text: draft.trim(),
    });
    setDraft("");
    onActiveThreadChange(id);
  }

  function reply(thread: CommentThread, text: string) {
    if (!yThreads || !me || !text.trim()) return;
    const message: CommentMessage = {
      id: crypto.randomUUID(),
      authorId: me.id,
      authorName: me.displayName,
      text: text.trim(),
      createdAt: Date.now(),
    };
    yThreads.set(thread.id, { ...thread, messages: [...thread.messages, message] });
  }

  function toggleResolved(thread: CommentThread) {
    if (!yThreads) return;
    yThreads.set(thread.id, { ...thread, resolved: !thread.resolved });
  }

  function goTo(thread: CommentThread) {
    onActiveThreadChange(thread.id);
    scrollToComment(editor, thread.id);
  }

  return (
    <aside
      aria-label="Comments"
      className="absolute inset-y-0 end-0 z-20 flex w-[340px] flex-col border-s border-hairline bg-[var(--surface-raised)] shadow-[var(--shadow-deck-seat)]"
    >
      <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-inset bg-[var(--control)] text-ink-muted">
          <Icon.list className="h-3.5 w-3.5" />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">
          Comments
        </h2>
        {threads.length > 0 && (
          <span className="shrink-0 text-[11px] text-ink-faint tabular-nums" data-figure>
            {unresolvedCount(threads)} open
          </span>
        )}
        <button
          type="button"
          aria-label="Close comments"
          onClick={onClose}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-inset text-ink-faint hover:bg-[var(--control)] hover:text-ink"
        >
          <Icon.close className="h-3.5 w-3.5" />
        </button>
      </div>

      {!doc ? (
        <div className="px-3.5 pt-3">
          <InlineError
            compact
            message="Comments need a live connection to this document, which isn't up right now."
          />
        </div>
      ) : (
        <>
          {selection.text.trim() && (
            <div className="border-b border-hairline px-3.5 py-2.5">
              <p className="mb-1.5 truncate rounded-inset bg-[var(--surface-sunken)] px-2 py-1 text-[11px] text-ink-faint">
                &ldquo;{selection.text}&rdquo;
              </p>
              <div className="flex gap-1.5">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Comment on this selection…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && draft.trim()) {
                      e.preventDefault();
                      startThread();
                    }
                  }}
                  className="min-w-0 flex-1 rounded-inset bg-[var(--surface-raised)] px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-ink-faint shadow-[inset_0_0_0_1px_var(--color-hairline)] focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!draft.trim() || !me}
                  onClick={startThread}
                  className="shrink-0 rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Comment
                </button>
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 scroll-slim">
            {threads.length === 0 ? (
              <p className="text-[12.5px] leading-relaxed text-ink-faint">
                Select some text and leave a comment on it — everyone in this
                document sees it, live.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {threads.map((thread) => (
                  <li
                    key={thread.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(thread.id, el);
                      else rowRefs.current.delete(thread.id);
                    }}
                    className={`rounded-inset border p-2.5 transition-colors ${
                      thread.id === activeThreadId
                        ? "border-ink bg-[var(--control-active)]"
                        : thread.resolved
                          ? "border-hairline opacity-60"
                          : "border-hairline"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => goTo(thread)}
                      className="block w-full truncate text-left text-[11px] text-ink-faint hover:text-ink"
                      title={thread.anchorText}
                    >
                      &ldquo;{thread.anchorText}&rdquo;
                    </button>

                    <ul className="mt-1.5 flex flex-col gap-1.5">
                      {thread.messages.map((m) => (
                        <li key={m.id} className="text-[12.5px] leading-relaxed">
                          <span className="font-medium text-ink">{m.authorName}</span>{" "}
                          <span className="text-ink">{m.text}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="mt-2 flex items-center gap-1.5">
                      <input
                        placeholder="Reply…"
                        disabled={!me}
                        onKeyDown={(e) => {
                          const target = e.currentTarget;
                          if (e.key === "Enter" && target.value.trim()) {
                            e.preventDefault();
                            reply(thread, target.value);
                            target.value = "";
                          }
                        }}
                        className="min-w-0 flex-1 rounded-inset bg-[var(--surface-sunken)] px-2 py-1 text-[11.5px] text-ink placeholder:text-ink-faint outline-none disabled:opacity-40"
                      />
                      <button
                        type="button"
                        onClick={() => toggleResolved(thread)}
                        className="shrink-0 rounded-full px-2 py-1 text-[10.5px] text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
                      >
                        {thread.resolved ? "Reopen" : "Resolve"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function readSelection(editor: Editor): { from: number; to: number; text: string } {
  const { from, to } = editor.state.selection;
  return {
    from,
    to,
    text: from === to ? "" : editor.state.doc.textBetween(from, to, "\n", " "),
  };
}

/** Find the first mark carrying this thread id and bring it on screen. */
function scrollToComment(editor: Editor, commentId: string): void {
  let target: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (target !== null) return false;
    if (node.marks.some((m) => m.type.name === "comment" && m.attrs.commentId === commentId)) {
      target = pos;
      return false;
    }
    return true;
  });
  if (target === null) return;
  editor.chain().setTextSelection(target).scrollIntoView().run();
}
