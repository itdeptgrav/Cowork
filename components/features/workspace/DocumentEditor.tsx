"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  Color,
  FontFamily,
  FontSize,
  TextStyle,
} from "@tiptap/extension-text-style";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { Icon } from "@/components/ui/Icons";
import { InlineError } from "@/components/ui/Primitives";
import { StageError, StageSkeleton } from "./WorkspaceStage";
import { useQuery } from "@/lib/hooks/useRepository";
import { getRepository } from "@/lib/repositories";
import { notifyRepositoryChanged } from "@/lib/repositories/events";
import { formatStamp } from "@/lib/utils/format";
import { canManage, editRefusal, roleOf } from "@/lib/rules/documents/access";
import { outlineRows, type OutlineHeading } from "@/lib/rules/documents/outline";
import {
  DEFAULT_PAGE_SETUP,
  PX_PER_INCH,
  clampZoom,
  contentWidthIn,
  fitZoom,
  pageSizeIn,
  stepZoom,
} from "@/lib/rules/documents/pageSetup";
import { readingMinutes, wordCount } from "@/lib/rules/documents/textStats";
import { BlockStyle } from "@/lib/documents/extensions/blockStyle";
import { PageBreak } from "@/lib/documents/extensions/pageBreak";
import { SearchHighlight } from "@/lib/documents/extensions/searchHighlight";
import { CommentMark } from "@/lib/documents/extensions/comment";
import { ShareMenu } from "./ShareMenu";
import { useCollabSession } from "./useCollabSession";
import { Presence } from "./Presence";
import { documentRoom } from "@/lib/rules/workspace/collabRoom";
import { caretRender, caretSelection } from "./collabCaret";
import { DocIcon } from "./docs/DocsIcons";
import { DocsAssistant } from "./ai/DocsAssistant";
import { DocsMenuBar } from "./docs/DocsMenuBar";
import { DocsToolbar } from "./docs/DocsToolbar";
import { DocsRuler } from "./docs/DocsRuler";
import { DocsSidebar } from "./docs/DocsSidebar";
import { DocsFindReplace } from "./docs/DocsFindReplace";
import { DocsSelectionToolbar } from "./docs/DocsSelectionToolbar";
import { DocsComments } from "./docs/DocsComments";
import { DocsVersionHistory } from "./docs/DocsVersionHistory";
import { exportDocumentPdf } from "@/lib/documents/pdfExport";
import { ContinueSuggestion } from "./ai/ContinueSuggestion";
import { requestAssist } from "@/lib/workspace/ai/client";
import { buildDocsContext } from "@/lib/rules/documents/aiContext";
import { validateDocsToolCall } from "@/lib/rules/documents/aiTools";
import { shouldOfferContinuation, CONTINUATION_PAUSE_MS } from "@/lib/workspace/ai/continuationSuggest";
import {
  AddressDialog,
  PageSetupDialog,
  ShortcutsDialog,
  WordCountDialog,
} from "./docs/DocsDialogs";
import type { DocumentPageSetup, DocumentSummary, TaskId } from "@/lib/domain";

/**
 * The document surface.
 *
 * ## The shape, and why it is this shape
 *
 * Title and menus, then a toolbar, then a ruler, then the page on a recessed
 * ground, with the outline beside it and the counts underneath. That is the
 * layout of every word processor since the eighties, and the reason to follow
 * it is not familiarity for its own sake: each strip answers a different
 * question, and putting them in a different order makes people hunt.
 *
 * - The **menus** hold everything, named, in groups that can be read.
 * - The **toolbar** holds what is used constantly.
 * - The **ruler** shows the measure and lets it be changed on the page it
 *   governs.
 * - The **outline** is the document's own structure, generated, never authored.
 * - The **status bar** holds the figures — words, zoom, the page.
 *
 * ## The page is a page
 *
 * A fixed measure on a recessed ground is what makes a document read as a
 * document rather than as a large form field. The width comes from the stored
 * page setup, so the line breaks somebody sees are the line breaks that will
 * print, and everybody in a shared document sees the same ones.
 *
 * The sheet is **not white in dark mode**. A white page on a dark deck is a
 * lamp, and nobody edits prose on one for an hour — `--doc-page` is tuned per
 * theme, like every other surface in this product. Print forces white and dark
 * ink, because paper has no theme.
 *
 * ## Nothing here is a control that does not work
 *
 * There is no version history and no Extensions menu, because there is no
 * revision store and no add-on system. The repository's rule is that an
 * unimplemented method throws rather than resolving empty; the same
 * principle applies to chrome — a button that opens a panel saying "coming
 * soon" was found by somebody who needed the feature. Comments (see
 * `DocsComments.tsx`) are the one exception since this note was written —
 * a real thread store, riding the same Yjs room the prose syncs through.
 */

const SAVE_DEBOUNCE_MS = 1200;

export function DocumentEditor({
  documentId,
  documents = [],
  onOpen,
  onNew,
  onClose,
  onChanged,
  creating = false,
  reportTaskId = null,
  reportTaskTitle = null,
  reportProgress = null,
}: {
  documentId: string;
  /** The other documents, for the rail. Empty is a perfectly good rail. */
  documents?: DocumentSummary[];
  onOpen?: (id: string) => void;
  onNew?: () => void;
  onClose?: () => void;
  /** The list needs re-reading — a rename, a copy or a delete happened. */
  onChanged?: () => void;
  creating?: boolean;
  /**
   * Set when this document was opened as the long form of a specific task's
   * daily report — see `ReportComposer.tsx`'s "Write a doc" link. Renders a
   * banner offering to finish the report from here, rather than making
   * someone go back to the composer once they are done writing.
   */
  reportTaskId?: string | null;
  reportTaskTitle?: string | null;
  /** Carried from the composer's progress selector at the moment the link was
      opened, so the report this banner files doesn't lose that choice. */
  reportProgress?: number | null;
}) {
  const doc = useQuery((r) => r.getDocument(documentId), [documentId]);
  const body = useQuery((r) => r.getDocumentBody(documentId), [documentId]);
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  const collab = useCollabSession(documentRoom(documentId), me.data ?? null);

  const myRole = doc.data ? roleOf(doc.data, me.data?.id ?? null) : null;
  const refusal = doc.data ? editRefusal(doc.data, me.data?.id ?? null) : null;
  const mayEdit = doc.data ? refusal === null : false;
  const mayManage = doc.data ? canManage(doc.data, me.data?.id ?? null) : false;

  /* View state. None of it is stored: zoom, the rail and the guides are this
     reader's view of the document, not properties of it. Page setup is the
     opposite and lives on the body — see `DocumentPageSetup`. */
  const [mode, setMode] = useState<"editing" | "viewing">("editing");
  const [zoom, setZoom] = useState(1);
  const [showOutline, setShowOutline] = useState(true);
  const [showAssistant, setShowAssistant] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  /** The thread a click on a comment mark in the prose just asked to see. */
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [showRuler, setShowRuler] = useState(true);
  const [showPageGuides, setShowPageGuides] = useState(false);
  const [spellcheck, setSpellcheck] = useState(true);
  /**
   * "Continue writing" — off by default. Fires a real network request on a
   * typing pause, so it is opt-in rather than something that starts
   * happening to everyone the moment this shipped. Session-only, matching
   * every other view toggle here (`spellcheck`, `showPageGuides`, …) — there
   * is no settings-persistence layer for a per-user editor preference.
   */
  const [suggestEnabled, setSuggestEnabled] = useState(false);
  const [suggestion, setSuggestion] = useState<{ text: string; pos: number } | null>(null);
  /**
   * Whether the BROWSER is showing its own chrome — not whether this document
   * is maximised, which it always is now. See {@link WorkspaceStage}.
   *
   * There used to be one flag meaning both, and the two meanings could
   * disagree: leaving native fullscreen with Escape left a document claiming to
   * be maximised while sitting in a 78vh box. All this decides now is the tab
   * strip and the address bar, which is a real thing to want for a long read
   * and a different thing from the size of the editor.
   */
  const [chromeless, setChromeless] = useState(false);

  const [dialog, setDialog] = useState<
    null | "page-setup" | "word-count" | "shortcuts" | "link" | "image"
  >(null);
  const [finding, setFinding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  /** The "submit this as report" banner, present only when `reportTaskId` is set. */
  const [reportState, setReportState] = useState<
    "idle" | "submitting" | "submitted" | "error"
  >("idle");
  const [reportError, setReportError] = useState<string | null>(null);

  /**
   * The page.
   *
   * Derived from the stored body, with a local override so an applied change is
   * on screen immediately rather than after the write and the re-read. Derived
   * rather than copied into state by an effect: a copy has to be kept in step
   * with the read, and the moment it is not, two people are laying out one
   * document to different measures.
   *
   * A rejected write clears the override, which puts the stored page straight
   * back — there is no third state to get stuck in.
   */
  const [pageOverride, setPageOverride] = useState<DocumentPageSetup | null>(null);
  const pageSetup = pageOverride ?? body.data?.pageSetup ?? DEFAULT_PAGE_SETUP;

  const shell = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const page = useRef<HTMLDivElement | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestHtml = useRef("");

  const readOnly = !mayEdit || mode === "viewing";

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
        FontFamily,
        FontSize,
        /* Multicolour, or `setHighlight({ color })` silently applies the one
           default tint and the whole highlight palette does nothing. */
        Highlight.configure({ multicolor: true }),
        Subscript,
        Superscript,
        Image,
        TaskList,
        TaskItem.configure({ nested: true }),
        TableKit.configure({ table: { resizable: true } }),
        /* Headings too, or a centred title reverts to left the moment the
           caret enters it. */
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        BlockStyle,
        PageBreak,
        SearchHighlight,
        CommentMark.configure({
          onActivate: (id) => {
            setActiveThreadId(id);
            setShowComments(true);
          },
        }),
        Placeholder.configure({ placeholder: "Start writing…" }),
        ...(collab.session
          ? [
              Collaboration.configure({ document: collab.session.doc }),
              CollaborationCaret.configure({
                provider: collab.session.provider,
                user: collab.identity,
                /* A thin caret and a small persistent name flag, rather than
                   the default's solid full-width label bar. */
                render: caretRender,
                selectionRender: caretSelection,
              }),
            ]
          : []),
      ],
      /**
       * **Nothing when Yjs is driving.**
       *
       * Tiptap forbids initial content alongside `Collaboration`: the value is
       * inserted into the shared Y.Doc by EVERY client that opens the document,
       * so two people joining produce two copies of the text and neither sees a
       * coherent version of the other's edits. The content comes from the CRDT,
       * which the server seeds from `ydocState`.
       */
      content: collab.session ? undefined : (body.data?.html ?? ""),
      /* Tiptap renders server-side by default in v3. This content comes from a
         client-side read, so there is nothing correct to render there. */
      immediatelyRender: false,
      /* The UI half of the permission. The socket refuses a viewer's updates
         regardless — this only stops them typing into a document that would
         then silently discard it. */
      editable: !readOnly,
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
    [documentId, collab.session, readOnly],
  );

  /**
   * The outline and the word count — off the typing path.
   *
   * This used to be a `useEditorState` selector, re-run by Tiptap on every
   * transaction: every local keystroke, and every incoming Yjs update from a
   * collaborator. Its selector did TWO full-document walks —
   * `descendants()` for the headings, `textBetween(0, doc.content.size)` for
   * a word count — which is invisible on a short document and is the
   * reported "hangs" on a long one: the whole document, twice, on every
   * character typed by anyone in the room.
   *
   * Neither consumer needs per-keystroke freshness. The outline sidebar and
   * the status-bar count are read continuously but a few hundred
   * milliseconds behind typing is unnoticeable, and `WordCountDialog` is
   * opened deliberately, never mid-type — so it reads the editor directly at
   * the moment it opens (see `dialog === "word-count"` below) rather than
   * needing a live subscription of its own.
   *
   * So this is now plain state, written by a debounced recompute off the
   * editor's own `update` event (fires for local AND remote changes alike —
   * correct, a collaborator's paragraph should still eventually appear in
   * the outline, just not synchronously inside their keystroke) rather than
   * inside a selector Tiptap re-runs unconditionally.
   */
  const [derived, setDerived] = useState<{
    headings: OutlineHeading[];
    text: string;
  }>({ headings: [], text: "" });
  const outlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recomputeOutline = useCallback((e: typeof editor) => {
    if (!e || e.isDestroyed) return;
    const headings: OutlineHeading[] = [];
    e.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading")
        headings.push({
          pos,
          level: Number(node.attrs.level) || 1,
          text: node.textContent,
        });
      return true;
    });
    setDerived({
      headings,
      text: e.state.doc.textBetween(0, e.state.doc.content.size, "\n", " "),
    });
  }, []);
  useEffect(() => {
    if (!editor) return;
    const scheduleRecompute = () => {
      if (outlineTimer.current) clearTimeout(outlineTimer.current);
      outlineTimer.current = setTimeout(() => recomputeOutline(editor), 300);
    };
    /* Scheduled rather than called straight away: a direct `setDerived` here
       would run synchronously inside the effect body on every mount, which
       is exactly the cascading-render shape effects are supposed to avoid.
       The one-time cost is the outline sitting empty for the same ~300ms
       debounce everything else already accepts. */
    scheduleRecompute();
    editor.on("update", scheduleRecompute);
    return () => {
      editor.off("update", scheduleRecompute);
      if (outlineTimer.current) clearTimeout(outlineTimer.current);
    };
  }, [editor, recomputeOutline]);

  const rows = useMemo(() => outlineRows(derived.headings), [derived.headings]);
  const words = wordCount(derived.text);

  /**
   * "Continue writing" — a debounced single-shot suggestion, not a stream.
   *
   * `requestAssist` is one request/response call (see `client.ts`'s header
   * comment); real streamed ghost text is a later phase this build does not
   * attempt. Approximated instead as: wait for a genuine pause in typing,
   * ask once, and show the whole reply as a dismissible card — never
   * inserted without the person choosing to accept it.
   *
   * A request id guards against a reply arriving after the person has since
   * kept typing or moved the cursor — `schedule` (fired by every
   * `update`/`selectionUpdate`) clears any shown suggestion immediately, and
   * the stale reply is dropped by the id check rather than resurrecting a
   * card for a moment that has passed.
   */
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestRequestId = useRef(0);
  useEffect(() => {
    /* Nothing to clear when this turns off: no listener is attached below,
       so no new suggestion can arrive, and the render below only shows one
       while `suggestEnabled` is also true — a stale one left in state from
       just before the toggle switched off simply stops being rendered. */
    if (!editor || !suggestEnabled) return;

    const tryOffer = async () => {
      if (editor.isDestroyed) return;
      const { $from, from, to } = editor.state.selection;
      const hasSelection = from !== to;
      const cursorAtParagraphEnd = $from.parentOffset === $from.parent.content.size;
      const precedingFrom = Math.max(0, from - 400);
      const precedingText = editor.state.doc.textBetween(precedingFrom, from, "\n", " ");
      if (
        !shouldOfferContinuation({
          precedingText,
          hasSelection,
          cursorAtParagraphEnd,
          enabled: suggestEnabled,
        })
      )
        return;

      const myRequestId = ++suggestRequestId.current;
      const headings: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "heading") headings.push(node.textContent);
        return true;
      });
      const outcome = await requestAssist({
        surface: "docs",
        instruction:
          "Continue writing from where the cursor is, in the same voice as the surrounding text.",
        contextSummary: buildDocsContext({ selectionText: "", precedingText, headings }),
        history: [],
      });
      /* Superseded by a later attempt, or the editor unmounted while this
         was in flight — either way, nothing from this round should reach
         the screen. */
      if (myRequestId !== suggestRequestId.current || editor.isDestroyed) return;
      if (!outcome.ok || outcome.kind !== "tool_call") return;
      const validated = validateDocsToolCall(outcome.tool, outcome.args);
      /* Only ever `insert_text` — a suggestion that proposed a table or a
         heading would not read as "the next few words", so anything else
         the model returned here is discarded silently rather than shown. */
      if (!validated.ok || validated.action.tool !== "insert_text") return;
      setSuggestion({ text: validated.action.text, pos: editor.state.selection.from });
    };

    const schedule = () => {
      /* Typing or moving the cursor retracts whatever was being shown — a
         suggestion computed for a position the person has since left is not
         an answer to anything anymore. */
      setSuggestion(null);
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
      suggestTimer.current = setTimeout(() => void tryOffer(), CONTINUATION_PAUSE_MS);
    };

    editor.on("update", schedule);
    editor.on("selectionUpdate", schedule);
    return () => {
      editor.off("update", schedule);
      editor.off("selectionUpdate", schedule);
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
    };
  }, [editor, suggestEnabled]);

  /* Which heading the reader is in. Read from the scroll container rather than
     from the caret, because the outline follows what is on SCREEN — somebody
     scrolling to check a later section has not moved their cursor. */
  const [activeHeadingPos, setActiveHeadingPos] = useState<number | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !editor) return;
    const onScroll = () => {
      let active: number | null = null;
      for (const row of rows) {
        const node = editor.view.nodeDOM(row.pos) as HTMLElement | null;
        if (!node?.getBoundingClientRect) continue;
        const top = node.getBoundingClientRect().top - el.getBoundingClientRect().top;
        if (top - 8 <= 0) active = row.pos;
        else break;
      }
      setActiveHeadingPos(active);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [editor, rows]);

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

  /**
   * Carry a phase-1 document into the CRDT.
   *
   * Documents written before collaboration have `html` and no `ydocState`, so
   * the server seeds their room with nothing and they open blank. This inserts
   * the stored prose once — but ONLY after the provider reports `synced`, so it
   * is acting on the server's real state rather than on an empty document it
   * has not finished loading, and ONLY when the shared document is genuinely
   * empty, so the second person to open it does not append a second copy.
   */
  const seeded = useRef(false);
  useEffect(() => {
    const session = collab.session;
    if (!editor || !session || seeded.current) return;
    const html = body.data?.html;
    if (!html) return;

    const trySeed = () => {
      if (seeded.current) return;
      seeded.current = true;
      if (editor.isDestroyed) return;
      /* `isEmpty` is ProseMirror's own view of the shared document after the
         server's state has been applied. Anything already there wins. */
      if (!editor.isEmpty) return;
      editor.commands.setContent(html, { emitUpdate: true });
    };

    if (session.provider.synced) trySeed();
    else session.provider.once("sync", trySeed);
  }, [editor, collab.session, body.data?.html]);

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

  /* Follows the browser rather than assuming. Pressing Escape leaves native
     fullscreen without going through the button, and the state must not be
     left claiming otherwise. This is now the ONLY thing that sets the flag —
     there is no second, CSS-level meaning for it to disagree with. */
  useEffect(() => {
    const sync = () => setChromeless(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleChrome = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shell.current?.requestFullscreen?.();
    } catch {
      /* Refused by the browser — a kiosk policy, or a permissions setting. The
         document is already occupying the window either way, so there is
         nothing to report and nothing to put back. */
    }
  };

  /* ── Page geometry ──────────────────────────────────────────────────────
   *
   * The sheet is laid out at its true size in CSS pixels and then SCALED. Zoom
   * cannot be a width, because a page at 150% has to keep its inch measure —
   * widening the column instead would re-break every line and print
   * differently from what is on screen.
   */
  const { widthIn, heightIn } = pageSizeIn(pageSetup);
  const pageWidthPx = widthIn * PX_PER_INCH;
  const pageHeightPx = heightIn * PX_PER_INCH;
  const [naturalHeight, setNaturalHeight] = useState(pageHeightPx);

  useEffect(() => {
    const el = page.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    /* The scaled sheet is out of flow as far as its parent is concerned, so
       the parent's height has to be set from the sheet's real height times the
       zoom — otherwise the scroll area ends where the unscaled page ends and
       the bottom of a zoomed document is unreachable. */
    const observer = new ResizeObserver(() => setNaturalHeight(el.offsetHeight));
    observer.observe(el);
    setNaturalHeight(el.offsetHeight);
    return () => observer.disconnect();
  }, [pageSetup, editor]);

  const fitToWidth = useCallback(() => {
    const width = scroller.current?.clientWidth;
    if (width) setZoom(fitZoom(pageSetup, width - 48));
  }, [pageSetup]);

  /* ── Actions ─────────────────────────────────────────────────────────── */

  const applyPageSetup = async (next: DocumentPageSetup) => {
    setPageOverride(next);
    setDialog(null);
    const result = await getRepository().saveDocumentBody(documentId, {
      pageSetup: next,
    });
    if (result.ok) {
      body.refetch();
      return;
    }
    setError(result.message);
    /* Back to what is actually stored. Leaving the rejected page on screen
       would show a measure nobody else in the document has. */
    setPageOverride(null);
  };

  const download = (kind: "html" | "text") => {
    if (!editor || !doc.data) return;
    const name = doc.data.title.replace(/[^\w\d -]+/g, "").trim() || "document";
    const content =
      kind === "text"
        ? editor.getText()
        : exportHtml(doc.data.title, editor.getHTML(), pageSetup);
    const blob = new Blob([content], {
      type: kind === "text" ? "text/plain;charset=utf-8" : "text/html;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name}.${kind === "text" ? "txt" : "html"}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  /**
   * PDF export — captures the live page element, so the zoom transform it
   * normally carries has to come off first (`exportDocumentPdf`'s own input
   * says why: the PDF's page size already comes from the true inch measure,
   * and a zoomed capture would double it). Restored in `finally` regardless
   * of how the export finishes.
   */
  const downloadPdf = async () => {
    const el = page.current;
    if (!el || !doc.data) return;
    const name = doc.data.title.replace(/[^\w\d -]+/g, "").trim() || "document";
    const { widthIn, heightIn } = pageSizeIn(pageSetup);
    const previousTransform = el.style.transform;
    el.style.transform = "none";
    try {
      const result = await exportDocumentPdf({ page: el, widthIn, heightIn, fileName: name });
      if (!result.ok) setError(result.message);
    } finally {
      el.style.transform = previousTransform;
    }
  };

  /**
   * Print.
   *
   * The page size and margins are injected as an `@page` rule, because CSS
   * cannot read a custom property there — and without it the browser prints at
   * whatever its own default paper is, which is the one place a document's
   * stated setup would silently stop applying.
   */
  const print = useCallback(() => {
    const { widthIn: w, heightIn: h } = pageSizeIn(pageSetup);
    const style = document.createElement("style");
    style.id = "doc-print-page";
    style.textContent = `@page { size: ${w}in ${h}in; margin: ${pageSetup.margins.top}in ${pageSetup.margins.right}in ${pageSetup.margins.bottom}in ${pageSetup.margins.left}in; }`;
    document.head.appendChild(style);
    document.body.classList.add("doc-printing");
    const cleanup = () => {
      document.body.classList.remove("doc-printing");
      style.remove();
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
  }, [pageSetup]);

  const duplicate = async () => {
    if (!editor || !doc.data) return;
    const created = await getRepository().createDocument({
      title: `Copy of ${doc.data.title}`,
      kind: "doc",
    });
    if (!created.ok) {
      setError(created.message);
      return;
    }
    const saved = await getRepository().saveDocumentBody(created.data.id, {
      html: editor.getHTML(),
      pageSetup,
    });
    if (!saved.ok) setError(saved.message);
    /* Every mutation invalidates every query — see `useAction` in
       `useRepository.ts`. These three calls go straight to the repository
       rather than through `useAction` (each has its own error/refresh
       handling `useAction`'s generic shape doesn't fit), so they have to
       raise the same signal by hand — without it, a rename or delete here
       updates this screen and nothing else: a command palette, a "recent
       documents" list, or any other open tab's query keeps showing the old
       title (or the deleted document) until something unrelated happens to
       refetch it. */
    notifyRepositoryChanged();
    onChanged?.();
    onOpen?.(created.data.id);
  };

  const commitRename = async () => {
    const next = titleDraft.trim();
    setRenaming(false);
    if (!next || next === doc.data?.title) return;
    const result = await getRepository().renameDocument(documentId, next);
    if (!result.ok) setError(result.message);
    else {
      notifyRepositoryChanged();
      doc.refetch();
      onChanged?.();
    }
  };

  const remove = async () => {
    const result = await getRepository().deleteDocument(documentId);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    notifyRepositoryChanged();
    onChanged?.();
    onClose?.();
  };

  /* ── Keyboard ────────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "f") {
        e.preventDefault();
        setFinding(true);
      } else if (e.key === "k") {
        /* What Ctrl-K means in every editor anybody has used. It is also why
           the workspace's command palette is mounted on the browsing surface
           and not in here — two things cannot own one reflex. */
        e.preventDefault();
        setDialog("link");
      } else if (e.key === "p") {
        e.preventDefault();
        print();
      } else if (e.key === "/") {
        e.preventDefault();
        setDialog("shortcuts");
      } else if (e.shiftKey && (e.key === "C" || e.key === "c")) {
        e.preventDefault();
        setDialog("word-count");
      } else if (e.key === "s") {
        /* Saving is continuous, but Ctrl-S is muscle memory and the browser's
           own "save this page" dialog is a confusing answer to it. */
        e.preventDefault();
        void flush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush, print]);

  if (doc.isLoading || body.isLoading) return <StageSkeleton onClose={onClose} />;
  if (!doc.data)
    return (
      <StageError
        message="This document is not available. It may have been deleted, or you may not be in it."
        onClose={onClose}
      />
    );

  const record = doc.data;

  /**
   * File this document as today's report for `reportTaskId`.
   *
   * Flushes first — the report should carry whatever was just typed, not a
   * stale autosave from a few seconds ago. Progress carries over from
   * whatever the composer had selected when the link was opened; there is no
   * progress control here, and re-asking for it would just be a second place
   * that number can be set.
   */
  async function submitAsReport() {
    if (!reportTaskId) return;
    setReportState("submitting");
    setReportError(null);
    await flush();
    const r = await getRepository().submitDailyReport({
      taskId: reportTaskId as TaskId,
      message: "",
      progressPercent: reportProgress ?? 50,
      attachmentIds: [],
      documentId,
      documentTitle: record.title,
    });
    if (!r.ok) {
      setReportState("error");
      setReportError(r.message);
      return;
    }
    setReportState("submitted");
  }

  return (
    /* One shape. The surface this fills is the whole window — the stage owns
       the frame; this owns the document inside it. */
    <div
      ref={shell}
      className="flex h-full min-h-0 flex-col bg-[var(--body-bg)]"
    >
      {/* ── Title bar ───────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-start gap-x-3 gap-y-1 border-b border-hairline bg-[var(--surface-raised)] px-3 pt-2 pb-1">
        {/* The way out, in the corner every application puts it. This slot used
            to hold a document icon, which told somebody looking at a document
            that they were looking at a document; now that the editor takes the
            window, leaving it is the thing that needs a control — the rail
            carries one too, and the rail can be closed. */}
        <button
          type="button"
          aria-label="Back to all documents"
          title="Back to all documents"
          onClick={() => onClose?.()}
          className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-inset bg-[var(--control)] text-ink-muted transition-colors hover:bg-[var(--control-hover)] hover:text-ink"
        >
          <DocIcon.chevronLeft className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {renaming ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
                aria-label="Document name"
                className="h-7 min-w-0 flex-1 rounded-inset border border-hairline bg-transparent px-1.5 text-[15px] text-ink"
              />
            ) : (
              <button
                type="button"
                disabled={!mayManage}
                title={mayManage ? "Rename" : "Only an owner can rename this document"}
                onClick={() => {
                  setTitleDraft(record.title);
                  setRenaming(true);
                }}
                className="min-w-0 truncate rounded-inset px-1 text-left text-[15px] text-ink enabled:hover:bg-[var(--control)] disabled:cursor-default"
              >
                {record.title}
              </button>
            )}

            {myRole && myRole !== "owner" && (
              <span className="shrink-0 rounded-full bg-[var(--control)] px-2 py-0.5 text-[10px] text-ink-muted">
                {myRole === "viewer" ? "View only" : "Editor"}
              </span>
            )}
            <SaveState status={status} savedAt={savedAt} />
          </div>

          <DocsMenuBar
            editor={editor}
            actions={{
              onNewDocument: () => onNew?.(),
              onDuplicate: () => void duplicate(),
              onRename: () => {
                setTitleDraft(record.title);
                setRenaming(true);
              },
              onDownloadHtml: () => download("html"),
              onDownloadText: () => download("text"),
              onDownloadPdf: () => void downloadPdf(),
              onPrint: print,
              onPageSetup: () => setDialog("page-setup"),
              onVersionHistory: () => setShowVersionHistory(true),
              onDelete: () => void remove(),
              canManage: mayManage,
              onFind: () => setFinding(true),
              onInsertLink: () => setDialog("link"),
              onInsertImage: () => setDialog("image"),
              onWordCount: () => setDialog("word-count"),
              onShortcuts: () => setDialog("shortcuts"),
              showOutline,
              onShowOutline: setShowOutline,
              showRuler,
              onShowRuler: setShowRuler,
              showPageGuides,
              onShowPageGuides: setShowPageGuides,
              suggestEnabled,
              onSuggestEnabled: setSuggestEnabled,
              chromeless,
              onChromeless: () => void toggleChrome(),
              spellcheck,
              onSpellcheck: setSpellcheck,
              mode,
              onMode: setMode,
              canEdit: mayEdit,
            }}
          />
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pt-1">
          {collab.connected && <Presence peers={collab.peers} />}
          {canManage(record, me.data?.id ?? null) && (
            <ShareMenu
              target={{ kind: "document", id: record.id, noun: "document" }}
              members={record.members}
              onChanged={doc.refetch}
            />
          )}
          {mayEdit && (
            <button
              type="button"
              aria-label={showAssistant ? "Close assistant" : "Open assistant"}
              aria-pressed={showAssistant}
              title="Assistant (Gemini Flash-Lite)"
              onClick={() => setShowAssistant((v) => !v)}
              className={`grid h-7 w-7 place-items-center rounded-inset transition-colors hover:bg-[var(--control)] hover:text-ink ${
                showAssistant ? "bg-[var(--control-active)] text-ink" : "text-ink-muted"
              }`}
            >
              <Icon.chat className="h-4 w-4" />
            </button>
          )}
          {mayEdit && (
            <button
              type="button"
              aria-label={showComments ? "Close comments" : "Open comments"}
              aria-pressed={showComments}
              title="Comments"
              onClick={() => setShowComments((v) => !v)}
              className={`grid h-7 w-7 place-items-center rounded-inset transition-colors hover:bg-[var(--control)] hover:text-ink ${
                showComments ? "bg-[var(--control-active)] text-ink" : "text-ink-muted"
              }`}
            >
              <Icon.list className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            aria-label={chromeless ? "Show browser chrome" : "Hide browser chrome"}
            aria-pressed={chromeless}
            title={
              chromeless
                ? "Show the browser's tabs and address bar (Esc)"
                : "Hide the browser's tabs and address bar"
            }
            onClick={() => void toggleChrome()}
            className={`grid h-7 w-7 place-items-center rounded-inset transition-colors hover:bg-[var(--control)] hover:text-ink ${
              chromeless ? "bg-[var(--control-active)] text-ink" : "text-ink-muted"
            }`}
          >
            <DocIcon.fullscreen className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ── "Submit as report" banner ──────────────────────────────────────
          Present only when this document was opened as the long form of a
          specific task's daily report (see ReportComposer.tsx's doc link).
          A persistent bar rather than a toast: the person may write for a
          while before they are ready, and a toast that already faded would
          leave them hunting for how to finish. */}
      {reportTaskId && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline bg-[var(--surface-sunken)] px-4 py-2">
          {reportState === "submitted" ? (
            <>
              <Icon.check className="h-4 w-4 shrink-0 text-[var(--state-positive-ink)]" />
              <span className="text-[12.5px] text-ink">
                Submitted as today&rsquo;s report for{" "}
                <strong>{reportTaskTitle ?? "this task"}</strong>.
              </span>
              <a
                href={`/tasks/${reportTaskId}/reports`}
                className="ml-auto shrink-0 rounded-full bg-ink px-3 py-1 text-[12px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-80"
              >
                View report
              </a>
            </>
          ) : (
            <>
              <Icon.overview className="h-4 w-4 shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-muted">
                Writing the report for{" "}
                <strong className="text-ink">
                  {reportTaskTitle ?? "a task"}
                </strong>
              </span>
              {reportError && (
                <span className="shrink-0 text-[11px] text-[var(--state-overdue-ink)]">
                  {reportError}
                </span>
              )}
              <button
                type="button"
                disabled={reportState === "submitting"}
                onClick={() => void submitAsReport()}
                className="ml-auto shrink-0 rounded-full bg-ink px-3 py-1 text-[12px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-80 disabled:opacity-40"
              >
                {reportState === "submitting"
                  ? "Submitting…"
                  : `Submit this as report for ${reportTaskTitle ?? "task"}`}
              </button>
            </>
          )}
        </div>
      )}

      {editor && (
        <DocsToolbar
          editor={editor}
          actions={{
            onFind: () => setFinding(true),
            onPrint: print,
            onInsertLink: () => setDialog("link"),
            onInsertImage: () => setDialog("image"),
            zoom,
            onZoom: (z) => setZoom(clampZoom(z)),
            spellcheck,
            onSpellcheck: setSpellcheck,
            mode,
            onMode: setMode,
            canEdit: mayEdit,
          }}
        />
      )}

      {error && (
        <div className="px-4 pt-3">
          <InlineError compact message={error} />
        </div>
      )}

      {/* `relative`: the assistant panel below is an OVERLAY, `absolute`
          against this row specifically — so it floats over the page without
          reserving flex space and squeezing the page down to a sliver, and
          without covering the title bar / toolbar / ruler above it. */}
      <div className="relative flex min-h-0 flex-1">
        {showOutline && (
          <DocsSidebar
            documents={documents}
            openId={documentId}
            onOpen={(id) => onOpen?.(id)}
            onNew={() => onNew?.()}
            creating={creating}
            rows={rows}
            activePos={activeHeadingPos}
            onGoToHeading={(pos) => {
              if (!editor) return;
              const node = editor.view.nodeDOM(pos) as HTMLElement | null;
              node?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            onClose={() => onClose?.()}
          />
        )}

        <div className="relative flex min-w-0 flex-1 flex-col">
          {showRuler && (
            <DocsRuler
              setup={pageSetup}
              zoom={zoom}
              onChange={(next) => void applyPageSetup(next)}
              editable={mayEdit && mode === "editing"}
            />
          )}

          {finding && editor && (
            <DocsFindReplace
              editor={editor}
              canEdit={!readOnly}
              onClose={() => setFinding(false)}
            />
          )}

          {/* The recessed ground the sheet sits on. */}
          <div
            ref={scroller}
            className="min-h-0 flex-1 overflow-auto bg-[var(--surface-sunken)] px-6 py-6 scroll-slim"
          >
            <div
              className="mx-auto"
              style={{ width: pageWidthPx * zoom, height: naturalHeight * zoom }}
            >
              <div
                ref={page}
                data-doc-print
                spellCheck={spellcheck}
                className="relative rounded-[3px] shadow-[var(--shadow-deck-seat)]"
                style={{
                  width: pageWidthPx,
                  minHeight: pageHeightPx,
                  background: "var(--doc-page)",
                  paddingTop: `${pageSetup.margins.top}in`,
                  paddingBottom: `${pageSetup.margins.bottom}in`,
                  paddingLeft: `${pageSetup.margins.left}in`,
                  paddingRight: `${pageSetup.margins.right}in`,
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                }}
              >
                {showPageGuides && (
                  /* Approximate, and the menu says so: the printer decides the
                     real break from content height, and it will not split a
                     heading away from its paragraph the way a flat rule here
                     would suggest. */
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background: `repeating-linear-gradient(to bottom, transparent 0, transparent ${pageHeightPx - 1}px, var(--doc-rule) ${pageHeightPx - 1}px, var(--doc-rule) ${pageHeightPx}px)`,
                    }}
                  />
                )}
                <EditorContent editor={editor} />
                {!readOnly && (
                  <DocsSelectionToolbar
                    editor={editor}
                    onComment={
                      mayEdit ? () => setShowComments(true) : undefined
                    }
                  />
                )}
                {editor && suggestion && suggestEnabled && !readOnly && (
                  <ContinueSuggestion
                    editor={editor}
                    text={suggestion.text}
                    pos={suggestion.pos}
                    onAccept={() => {
                      const insertPos = editor.state.selection.from;
                      editor.chain().focus().insertContentAt(insertPos, suggestion.text).run();
                      setSuggestion(null);
                    }}
                    onDismiss={() => setSuggestion(null)}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {showAssistant && editor && (
          <DocsAssistant
            editor={editor}
            doc={collab.session?.doc ?? null}
            me={me.data ? { id: me.data.id, displayName: me.data.displayName } : null}
            onClose={() => setShowAssistant(false)}
          />
        )}
        {showComments && editor && (
          <DocsComments
            editor={editor}
            doc={collab.session?.doc ?? null}
            me={me.data ? { id: me.data.id, displayName: me.data.displayName } : null}
            activeThreadId={activeThreadId}
            onActiveThreadChange={setActiveThreadId}
            onClose={() => setShowComments(false)}
          />
        )}
        {showVersionHistory && (
          <DocsVersionHistory
            documentId={documentId}
            canEdit={mayEdit}
            onClose={() => setShowVersionHistory(false)}
            onRestored={() => body.refetch()}
          />
        )}
      </div>

      {/* ── Status bar ──────────────────────────────────────────────────── */}
      <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline bg-[var(--surface-raised)] px-3 py-1.5 text-[11px] text-ink-faint">
        <button
          type="button"
          onClick={() => setDialog("word-count")}
          className="rounded-inset px-1 hover:bg-[var(--control)] hover:text-ink"
          title="Word count (Ctrl Shift C)"
        >
          <span data-figure>{words}</span> {words === 1 ? "word" : "words"}
          {words > 0 && <> · {readingMinutes(words)} min read</>}
        </button>

        <span>
          {contentWidthIn(pageSetup).toFixed(2)}″ measure ·{" "}
          {pageSetup.paper.toUpperCase()} {pageSetup.orientation}
        </span>

        <span className="ms-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setZoom((z) => stepZoom(z, -1))}
            className="grid h-6 w-6 place-items-center rounded-inset hover:bg-[var(--control)] hover:text-ink"
          >
            <DocIcon.minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-10 text-center tabular-nums" data-figure>
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setZoom((z) => stepZoom(z, 1))}
            className="grid h-6 w-6 place-items-center rounded-inset hover:bg-[var(--control)] hover:text-ink"
          >
            <DocIcon.plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={fitToWidth}
            className="rounded-inset px-1.5 py-0.5 hover:bg-[var(--control)] hover:text-ink"
          >
            Fit
          </button>
        </span>

        <span className="w-full text-[10px] leading-snug text-ink-faint deck:w-auto">
          {/* Says which mode is ACTUALLY in force, rather than claiming the
              feature exists. A live session that quietly fell back to
              single-writer is the one failure people must not be left guessing
              about — two of them would overwrite each other believing they were
              collaborating. */}
          {!mayEdit
            ? (refusal ?? "You have view access.")
            : mode === "viewing"
              ? "Viewing. Switch to Editing in the toolbar to make changes."
              : collab.connected
                ? "Edits are shared live. Everyone in this document sees them as you type."
                : (collab.reason ??
                  "Working offline — edits are saved to this document, but nobody else sees them live.")}
        </span>
      </footer>

      {dialog === "page-setup" && (
        <PageSetupDialog
          value={pageSetup}
          onApply={(next) => void applyPageSetup(next)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "word-count" && (
        <WordCountDialog
          documentText={derived.text}
          /* Read fresh here rather than kept live in state: nobody needs a
             selection count updating while they are not looking at it, and
             computing it only when this dialog is actually open is what lets
             `derived` above skip tracking selection at all. */
          selectionText={(() => {
            if (!editor) return "";
            const { from, to } = editor.state.selection;
            return from === to
              ? ""
              : editor.state.doc.textBetween(from, to, "\n", " ");
          })()}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "shortcuts" && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === "link" && editor && (
        <AddressDialog
          kind="link"
          initial={(editor.getAttributes("link").href as string) ?? ""}
          onRemove={
            editor.isActive("link")
              ? () => {
                  editor.chain().focus().unsetLink().run();
                  setDialog(null);
                }
              : undefined
          }
          onSubmit={(value) => {
            const safe = /^(https?:|mailto:)/i.test(value) ? value : `https://${value}`;
            editor.chain().focus().setLink({ href: safe }).run();
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "image" && editor && (
        <AddressDialog
          kind="image"
          onSubmit={(value) => {
            editor.chain().focus().setImage({ src: value }).run();
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
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
    return <span className="text-[11px] text-ink-faint">Saved {formatStamp(savedAt)}</span>;
  return null;
}

/**
 * A standalone HTML file.
 *
 * The page setup travels with it as an `@page` rule and the prose styles are
 * inlined, because a downloaded file opens in a browser with none of this
 * application's stylesheet — and an export that arrives as unstyled markup is
 * one people conclude was corrupted.
 */
function exportHtml(title: string, inner: string, setup: DocumentPageSetup): string {
  const { widthIn, heightIn } = pageSizeIn(setup);
  const escaped = title.replace(/[<>&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;",
  );
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escaped}</title>
<style>
  @page { size: ${widthIn}in ${heightIn}in; margin: ${setup.margins.top}in ${setup.margins.right}in ${setup.margins.bottom}in ${setup.margins.left}in; }
  body { margin: 0; background: #f4f4f6; color: #101014;
         font: 16px/1.6 Geist, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  .page { max-width: ${widthIn - setup.margins.left - setup.margins.right}in; margin: 0 auto;
          padding: ${setup.margins.top}in 0; background: #fff; }
  h1 { font-size: 1.75em; font-weight: 400; }
  h2 { font-size: 1.4em; font-weight: 400; }
  h3 { font-size: 1.15em; font-weight: 500; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d8d8de; padding: 0.45em 0.6em; vertical-align: top; }
  th { background: #f2f2f5; text-align: start; }
  blockquote { border-inline-start: 3px solid #d8d8de; padding-inline-start: 1em; color: #4a4a55; }
  pre { background: #f2f2f5; padding: 0.85em 1em; overflow-x: auto; }
  img { max-width: 100%; height: auto; }
  ul[data-type="taskList"] { list-style: none; padding-inline-start: 0.25em; }
  ul[data-type="taskList"] li { display: flex; gap: 0.55em; align-items: flex-start; }
  [data-page-break] { break-after: page; border: 0; }
  @media print { body { background: #fff; } .page { padding: 0; max-width: none; } }
</style></head>
<body><div class="page">${inner}</div></body></html>`;
}
