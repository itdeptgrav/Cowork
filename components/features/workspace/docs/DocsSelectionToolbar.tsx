"use client";

import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { AiTextAssistButton } from "@/components/ui/AiTextAssist";
import { Icon } from "@/components/ui/Icons";

/**
 * "Improve with AI," anchored to whatever text is selected — the Word/Notion
 * pattern of a small floating toolbar over a selection, rather than a chat
 * panel opened separately for the same request.
 *
 * Deliberately not a new interaction: this hosts the exact popover
 * (`AiTextAssistButton`, already shipped and already used in mail compose
 * and task forms) inside a Tiptap `BubbleMenu` instead of a fixed field
 * icon. `improveText()` needs no document context — a selection is a plain
 * string in, a plain string out — so nothing here talks to the tool-calling
 * assistant (`requestAssist`) that inserts blocks/headings/tables; it only
 * ever replaces the range the person already chose.
 *
 * The selector below reads `state.selection`, not the whole document — a
 * bounded `textBetween(from, to, …)` over a selection is exactly the "cheap,
 * live" half `DocumentEditor.tsx`'s own outline/word-count fix split away
 * from the expensive, full-document half. Keeping it reactive here is
 * correct, not a regression of that fix.
 *
 * `onComment` just opens the Comments panel — it does not itself write a
 * thread. `DocsComments.tsx` reads the editor's live selection on its own,
 * so surfacing that panel with this exact range still selected is the whole
 * job; duplicating its compose box in here would be two places that could
 * disagree about what a "new comment" looks like.
 */
export function DocsSelectionToolbar({
  editor,
  onComment,
}: {
  editor: Editor | null;
  /** Omitted where commenting isn't offered — a read-only view, or no live
      collaboration room for a thread to live in. */
  onComment?: () => void;
}) {
  const selectionText = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return "";
      const { from, to } = e.state.selection;
      return from === to ? "" : e.state.doc.textBetween(from, to, "\n", " ");
    },
  });

  if (!editor) return null;

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, state }) => {
        const { from, to } = state.selection;
        return e.isEditable && from !== to && !state.selection.empty;
      }}
    >
      <div className="frost-bar flex items-center gap-0.5 rounded-full border border-hairline p-0.5 shadow-[var(--deck-seat)]">
        <AiTextAssistButton
          value={selectionText ?? ""}
          fieldLabel="selection"
          onApply={(next) => {
            const { from, to } = editor.state.selection;
            /* The range is re-read here rather than closed over at open time:
               the popover stays open across the async `improveText` round
               trip, during which — rare, but possible — a collaborator's own
               edit could have shifted positions. ProseMirror's own mapped
               selection is the current, correct range regardless. */
            editor.chain().focus().insertContentAt({ from, to }, textToHtml(next)).run();
          }}
        />
        {onComment && (
          <button
            type="button"
            aria-label="Comment on this selection"
            title="Comment on this selection"
            onClick={onComment}
            className="flex h-6 w-6 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
          >
            <Icon.chat className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </BubbleMenu>
  );
}

/**
 * The assistant returns plain text; the editor wants content. Blank-line runs
 * become paragraph breaks, single newlines become soft breaks within one —
 * good enough to read like the prose it replaced rather than landing as one
 * run-on line, without trying to reconstruct headings/lists/formatting the
 * plain-text round trip through `improveText` never carried in the first
 * place.
 */
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
