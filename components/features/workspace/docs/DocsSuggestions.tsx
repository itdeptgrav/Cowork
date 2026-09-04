"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { Button } from "@/components/ui/Primitives";
import { suggestionsOf, type SuggestionEntry } from "@/lib/documents/extensions/suggestions";

/**
 * The review panel for suggestions — every proposed insertion and deletion
 * in the document, in order, each with Accept and Reject. Read straight off
 * the editor's document on every change, so a suggestion made by someone
 * else live appears here as they type it.
 *
 * Cards are grouped by suggestion id: replacing a word is one card showing
 * the struck text and the new text together, because that is one decision.
 */

interface Card {
  id: string;
  byName: string;
  at: string;
  removed: string;
  added: string;
  from: number;
}

function cardsOf(entries: SuggestionEntry[]): Card[] {
  const byId = new Map<string, Card>();
  for (const e of entries) {
    const card = byId.get(e.id) ?? { id: e.id, byName: e.byName, at: e.at, removed: "", added: "", from: e.from };
    if (e.kind === "delete") card.removed += e.text;
    else card.added += e.text;
    card.from = Math.min(card.from, e.from);
    byId.set(e.id, card);
  }
  return [...byId.values()].sort((a, b) => a.from - b.from);
}

function when(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function DocsSuggestions({
  editor,
  canResolve,
  onClose,
}: {
  editor: Editor;
  /** Only an editor of the document may accept or reject — a commenter
      may suggest, but cannot decide. */
  canResolve: boolean;
  onClose: () => void;
}) {
  const [cards, setCards] = useState<Card[]>(() => cardsOf(suggestionsOf(editor.state.doc)));
  useEffect(() => {
    const read = () => setCards(cardsOf(suggestionsOf(editor.state.doc)));
    editor.on("transaction", read);
    return () => {
      editor.off("transaction", read);
    };
  }, [editor]);

  const jump = (from: number) => {
    editor.chain().focus().setTextSelection(from).scrollIntoView().run();
  };

  return (
    <aside
      aria-label="Suggestions"
      className="flex w-[300px] shrink-0 flex-col border-l border-hairline bg-[var(--surface-raised)]"
    >
      <header className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <h2 className="text-[12px] font-medium text-ink">
          Suggestions <span className="text-ink-faint">{cards.length}</span>
        </h2>
        <div className="flex items-center gap-1">
          {canResolve && cards.length > 0 && (
            <>
              <Button size="sm" tone="ghost" onClick={() => editor.chain().focus().acceptAllSuggestions().run()}>
                Accept all
              </Button>
              <Button size="sm" tone="ghost" onClick={() => editor.chain().focus().rejectAllSuggestions().run()}>
                Reject all
              </Button>
            </>
          )}
          <button type="button" onClick={onClose} aria-label="Close suggestions" className="rounded-inset px-1.5 text-ink-faint hover:bg-[var(--control)] hover:text-ink">
            ×
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-2">
        {cards.length === 0 ? (
          <p className="px-1 py-2 text-[12px] text-ink-faint">
            No suggestions yet. In Suggesting mode, everything you type or delete is proposed here for review rather than applied.
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {cards.map((c) => (
              <li key={c.id} className="rounded-inset border border-hairline bg-[var(--surface-raised)] p-2">
                <button type="button" onClick={() => jump(c.from)} className="block w-full text-left">
                  <p className="text-[11px] text-ink-faint">
                    <span className="text-ink">{c.byName || "Someone"}</span>
                    {c.at && <> · {when(c.at)}</>}
                  </p>
                  <p className="mt-1 text-[12.5px] leading-snug text-ink">
                    {c.removed && (
                      <del className="rounded-sm bg-[color-mix(in_oklab,#c0392b_12%,transparent)] px-0.5 text-ink-muted line-through decoration-[#c0392b]">
                        {c.removed}
                      </del>
                    )}
                    {c.removed && c.added && " "}
                    {c.added && (
                      <ins className="rounded-sm bg-[color-mix(in_oklab,#1f8a4c_16%,transparent)] px-0.5 no-underline">
                        {c.added}
                      </ins>
                    )}
                  </p>
                </button>
                {canResolve && (
                  <div className="mt-1.5 flex gap-1">
                    <Button size="sm" onClick={() => editor.chain().focus().acceptSuggestion(c.id).run()}>
                      Accept
                    </Button>
                    <Button size="sm" tone="ghost" onClick={() => editor.chain().focus().rejectSuggestion(c.id).run()}>
                      Reject
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
