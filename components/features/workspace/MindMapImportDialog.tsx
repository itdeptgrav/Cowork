"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button, InlineError, Textarea } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import { freeMindToNodes, looksLikeFreeMind, markdownToNodes, opmlToNodes, type ParsedOutline } from "@/lib/rules/mindmap/textio";
import { childrenOf } from "@/lib/rules/mindmap/tree";
import type { MindNode } from "@/lib/domain";

/**
 * Import a mindmap from text — pasted, or a file.
 *
 * Markdown outlines, plain indented lists and OPML all land here. The format
 * is told from the content, not from a picker: OPML declares itself with an
 * `<opml` tag, and anything else is an outline. A picker would be one more
 * thing to get wrong for somebody who only knows they copied a list out of a
 * meeting note.
 *
 * The parse runs as you type, and what it found is stated before anything is
 * created — how many cards, and the first few by name — so a paste that came
 * out as one card (the wrong indent character, say) is seen before a map with
 * one card is made.
 */
export function MindMapImportDialog({
  onImport,
  onClose,
  busy = false,
  error = null,
}: {
  onImport: (input: { title: string; nodes: MindNode[] }) => void;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  /* One stamp for this dialog's lifetime, so the ids minted below are a pure
     function of the text — a `Date.now()` inside the memo would make the same
     paste parse to different ids on each render, and is impure by the rule. */
  const [stamp] = useState(() => Date.now().toString(36));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  /* Parsed live. Ids are minted per parse and are only ever a new map's, so
     a throwaway counter is enough — the server stores whatever it is given. */
  const parsed: ParsedOutline | null = useMemo(() => {
    if (!text.trim()) return null;
    let n = 0;
    const mint = () => `n${stamp}${(++n).toString(36)}`;
    const title = fileName?.replace(/\.[^.]+$/, "") || "Imported mindmap";
    if (looksLikeFreeMind(text)) return freeMindToNodes(text, mint, title);
    return /<opml[\s>]/i.test(text) ? opmlToNodes(text, mint, title) : markdownToNodes(text, mint, title);
  }, [text, fileName, stamp]);

  const preview = useMemo(() => {
    if (!parsed) return null;
    const root = parsed.nodes[0];
    const map = { id: "", title: "", updatedAt: "", nodes: parsed.nodes };
    const top = childrenOf(map, root.id).map((n) => n.title);
    return { root: root.title, count: parsed.nodes.length, top };
  }, [parsed]);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setText(await file.text());
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mindmap-import-title"
      className="fixed inset-0 z-[97] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => !busy && onClose()}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
      />
      <div className="frost-panel relative w-[min(560px,96vw)] rounded-panel px-6 py-5">
        <h2 id="mindmap-import-title" className="text-[17px] leading-tight font-medium tracking-[-0.01em] text-ink">
          Import a mindmap
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
          Paste an outline — a Markdown list, an indented list from your notes —
          or an OPML file from another mindmap tool. Indent decides what goes
          under what; the first line or heading names the map.
        </p>

        <Textarea
          autoFocus
          rows={9}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"# Launch plan\n- Design\n  - Wireframes\n  - Copy\n- Build"}
          className="mt-4 font-mono text-[12.5px]"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[var(--control)] px-3 py-1.5 text-[12.5px] text-ink transition-colors hover:bg-[var(--control-hover)]">
            <Icon.attach className="h-3.5 w-3.5" />
            {fileName ?? "Choose a file"}
            <input
              type="file"
              accept=".md,.markdown,.txt,.opml,.xml,.mm,text/markdown,text/plain,text/x-opml,text/xml"
              className="sr-only"
              onChange={(e) => {
                void readFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <span className="text-[11px] text-ink-faint">Markdown, text or OPML.</span>
        </div>

        {preview && (
          <p className="mt-3 rounded-inset bg-[var(--surface-sunken)] px-3 py-2 text-[12px] leading-relaxed text-ink-muted">
            <span className="text-ink">{preview.root}</span>
            {" — "}
            <span data-figure>{preview.count}</span> {preview.count === 1 ? "card" : "cards"}
            {preview.top.length > 0 && (
              <>
                {": "}
                {preview.top.slice(0, 4).join(", ")}
                {preview.top.length > 4 ? "…" : ""}
              </>
            )}
            {parsed && parsed.skipped > 0 && (
              <span className="text-ink-faint">
                {" "}
                · <span data-figure>{parsed.skipped}</span> line{parsed.skipped === 1 ? "" : "s"} could not be placed
              </span>
            )}
          </p>
        )}

        {error && (
          <div className="mt-3">
            <InlineError message={error} />
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button size="sm" tone="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            tone="primary"
            disabled={!parsed || busy}
            loading={busy}
            onClick={() => parsed && onImport({ title: parsed.nodes[0].title, nodes: parsed.nodes })}
          >
            {busy ? "Importing…" : "Import"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
