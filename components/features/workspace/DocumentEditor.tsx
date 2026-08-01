"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Icon } from "@/components/ui/Icons";
import { InlineError, SkeletonRows } from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { getRepository } from "@/lib/repositories";
import { formatStamp } from "@/lib/utils/format";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { EditorToolbar } from "./EditorToolbar";
import { useCollabSession } from "./useCollabSession";

/**
 * The document editor.
 *
 * **Phase 1: one writer.** Tiptap on ProseMirror, autosaving HTML. Phase 2 adds
 * Yjs over the engine's Socket.IO and makes the CRDT state the authority, with
 * HTML kept as its projection.
 *
 * ## The page
 *
 * A fixed-width sheet on a recessed ground, because that is what makes a
 * document read as a document: the measure stays at a readable ~80 characters
 * however wide the window is. A full-bleed editor is the single thing that most
 * makes a rich-text box feel like a form field rather than a page.
 *
 * The sheet is **not white in dark mode**. A white page on a dark deck is a
 * lamp, and nobody edits prose on one for an hour — `--doc-page` is tuned per
 * theme, like every other surface in this product.
 *
 * ## Full screen
 *
 * Two mechanisms, because one is not reliable. `requestFullscreen` is the real
 * one; it is refused in some embeddings and by some browser settings, so the
 * component ALSO applies a fixed, top-layer maximised state. Either path alone
 * leaves a case where the button appears to do nothing.
 */

const SAVE_DEBOUNCE_MS = 1200;

export function DocumentEditor({ documentId }: { documentId: string }) {
  const doc = useQuery((r) => r.getDocument(documentId), [documentId]);
  const body = useQuery((r) => r.getDocumentBody(documentId), [documentId]);
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  const collab = useCollabSession(documentId, me.data ?? null);

  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [full, setFull] = useState(false);

  const shell = useRef<HTMLDivElement | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestHtml = useRef("");

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          link: { openOnClick: false },
          /* Yjs owns undo when collaborating — ProseMirror's own history would
             undo OTHER PEOPLE's edits, which is the classic way a shared
             document loses somebody else's paragraph. */
          undoRedo: collab.session ? false : undefined,
        }),
        TextStyle,
        Color,
        Highlight,
        Subscript,
        Superscript,
        Image,
        TaskList,
        TaskItem.configure({ nested: true }),
        TableKit.configure({ table: { resizable: true } }),
        /* Headings too, or a centred title reverts to left the moment the
           caret enters it. */
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Placeholder.configure({ placeholder: "Start writing…" }),
        ...(collab.session
          ? [
              Collaboration.configure({ document: collab.session.doc }),
              CollaborationCaret.configure({
                provider: collab.session.provider,
                user: collab.identity,
              }),
            ]
          : []),
      ],
      content: body.data?.html ?? "",
      /* Tiptap renders server-side by default in v3. This content comes from a
         client-side read, so there is nothing correct to render there. */
      immediatelyRender: false,
      editorProps: {
        attributes: { class: "prose-cowork focus:outline-none" },
      },
      onUpdate: ({ editor: e }) => {
        latestHtml.current = e.getHTML();
        dirty.current = true;
        setStatus("saving");
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
      },
    },
    [documentId, collab.session],
  );

  /* `useEditor` reads `content` only at creation, so a body that resolves later
     has to be set explicitly. Guarded on `dirty` so a slow read cannot
     overwrite something already typed. */
  useEffect(() => {
    /* **Never when Yjs is driving.** The CRDT is seeded from the server's
       stored state; calling `setContent` on top of it inserts the whole
       document a second time, and the duplicate is then replicated to
       everybody as a genuine edit. */
    if (collab.session) return;
    if (!editor || body.isLoading || dirty.current) return;
    const html = body.data?.html ?? "";
    if (html !== editor.getHTML()) {
      editor.commands.setContent(html, { emitUpdate: false });
      latestHtml.current = html;
    }
  }, [editor, body.data?.html, body.isLoading, collab.session]);

  const flush = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    try {
      const result = await getRepository().saveDocumentBody(documentId, {
        html: latestHtml.current,
      });
      if (result.ok) {
        setStatus("saved");
        setSavedAt(result.data.updatedAt);
        setError(null);
      } else {
        /* Marked dirty again so the next save retries rather than treating a
           refused write as though it had landed. */
        dirty.current = true;
        setStatus("error");
        setError(result.message);
      }
    } catch (e) {
      dirty.current = true;
      setStatus("error");
      setError(e instanceof Error ? e.message : "That could not be saved.");
    }
  }, [documentId]);

  /* The two paths a debounce alone loses: leaving the page, and the tab being
     hidden — on a phone that is often the last event before the process dies. */
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      if (timer.current) clearTimeout(timer.current);
      void flush();
    };
  }, [flush]);

  /* Follows the browser rather than assuming. Pressing Escape exits native
     fullscreen without going through the button, and the state must not be
     left claiming otherwise. */
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
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      return;
    }
    setFull(true);
    /* The CSS maximise above is what actually guarantees the change; this is
       the upgrade to a real fullscreen surface where it is permitted. */
    try {
      await shell.current?.requestFullscreen?.();
    } catch {
      /* Refused — the maximised state still applies. */
    }
  };

  if (doc.isLoading || body.isLoading) return <SkeletonRows rows={8} />;
  if (!doc.data)
    return (
      <InlineError message="This document is not available. It may have been deleted, or you may not be in it." />
    );

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
        {collab.connected && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--control)] px-2 py-0.5 text-[10px] text-ink-muted"
            title="Live collaboration is on"
          >
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
        <SaveState status={status} savedAt={savedAt} />
        <button
          type="button"
          aria-label={full ? "Exit full screen" : "Full screen"}
          aria-pressed={full}
          title={full ? "Exit full screen (Esc)" : "Full screen"}
          onClick={() => void toggleFull()}
          className="grid h-7 w-7 place-items-center rounded-inset text-ink-muted hover:bg-[var(--control)] hover:text-ink"
        >
          <Icon.external className={`h-3.5 w-3.5 ${full ? "rotate-180" : ""}`} />
        </button>
      </header>

      {editor && <EditorToolbar editor={editor} />}

      {error && (
        <div className="px-4 pt-3">
          <InlineError compact message={error} />
        </div>
      )}

      {/* The recessed ground the sheet sits on. */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface-sunken)] px-4 py-6 scroll-slim">
        <div
          className="mx-auto rounded-[3px] shadow-[var(--shadow-deck-seat)]"
          style={{
            /* 816px is US Letter at 96dpi, which is what makes the measure feel
               like a page rather than an arbitrary column. */
            maxWidth: 816,
            background: "var(--doc-page)",
            padding: "clamp(28px, 5vw, 72px)",
            minHeight: full ? "auto" : 420,
          }}
        >
          <EditorContent editor={editor} />
        </div>
      </div>

      <footer className="shrink-0 border-t border-hairline px-4 py-2">
        <p className="text-[10px] text-ink-faint">
          {/* Says which mode is ACTUALLY in force, rather than claiming the
              feature exists. A live session that quietly fell back to
              single-writer is the one failure people must not be left guessing
              about — two of them would overwrite each other believing they were
              collaborating. */}
          {collab.connected
            ? "Edits are shared live. Everyone in this document sees them as you type."
            : (collab.reason ??
              "Working offline — edits are saved to this document, but nobody else sees them live.")}
        </p>
      </footer>
    </div>
  );
}

function SaveState({
  status,
  savedAt,
}: {
  status: "idle" | "saving" | "saved" | "error";
  savedAt: string | null;
}) {
  if (status === "error")
    return <span className="text-[11px] text-[var(--state-overdue-ink)]">Not saved</span>;
  if (status === "saving")
    return <span className="text-[11px] text-ink-faint">Saving…</span>;
  if (status === "saved" && savedAt)
    return (
      <span className="text-[11px] text-ink-faint">Saved {formatStamp(savedAt)}</span>
    );
  return null;
}
