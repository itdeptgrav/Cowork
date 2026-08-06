"use client";

import { useEffect, useMemo } from "react";
import type { Editor } from "@tiptap/react";

/**
 * The ambient "continue writing" card — a proposal, never an insertion.
 *
 * Deliberately a plain positioned React element, not a ProseMirror
 * decoration: a decoration would render the ghost text INLINE in the
 * document flow, which is the real Phase-3 version of this feature (needs
 * token streaming to feel right, per the plan this shipped from). This is
 * the single-shot v1 — the whole suggestion arrives at once, so a small
 * floating card next to the cursor is the honest shape for it, not a
 * character-by-character reveal this build can't actually do.
 *
 * Position comes from `editor.view.coordsAtPos`, which already accounts for
 * the page's zoom transform and scroll position — the same live DOM
 * measurement Tiptap's own `BubbleMenu` positioning relies on — so this
 * tracks the cursor correctly at any zoom level without its own transform
 * math.
 */
export function ContinueSuggestion({
  editor,
  text,
  pos,
  onAccept,
  onDismiss,
}: {
  editor: Editor;
  text: string;
  /** Document position the suggestion continues from. */
  pos: number;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  /* A pure read of layout already on screen — this component only ever
     mounts once `pos` names a position the editor has already laid out (the
     suggestion arrives well after mount, from an async reply), so there is
     no "not ready yet" case to wait out in an effect. Plain `useMemo`
     avoids the render-then-effect-then-setState round trip a `useState` +
     `useEffect` pair here would cost for no benefit. */
  const coords = useMemo(() => {
    if (editor.isDestroyed) return null;
    try {
      const c = editor.view.coordsAtPos(pos);
      return { top: c.bottom + 4, left: c.left };
    } catch {
      /* A stale position past the end of a document that changed underneath
         it — nothing sane to anchor to, so nothing is shown. */
      return null;
    }
  }, [editor, pos]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        onAccept();
      } else if (e.key === "Escape") {
        onDismiss();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onAccept, onDismiss]);

  if (!coords) return null;

  return (
    <>
      {/* Click-away. Behind the card, ahead of everything else. */}
      <button
        type="button"
        aria-label="Dismiss suggestion"
        onClick={onDismiss}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        role="status"
        style={{ top: coords.top, left: coords.left }}
        className="frost-bar fixed z-50 max-w-[380px] rounded-panel border border-hairline p-2.5 shadow-[var(--deck-seat)]"
      >
        <p className="text-[12.5px] leading-relaxed text-ink-faint">
          {text}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onAccept}
            className="rounded-full bg-ink px-3 py-1 text-[11px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90"
          >
            Tab to accept
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full px-3 py-1 text-[11px] text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
          >
            Esc to dismiss
          </button>
        </div>
      </div>
    </>
  );
}
