"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { footnotesOf, type FootnoteEntry } from "@/lib/documents/extensions/footnote";

/**
 * The notes at the foot of the page, in document order.
 *
 * Derived from the markers on every editor update — the number beside each
 * is its position, the same counter the marker shows — and each note is an
 * input that writes straight back to its marker's `text`. Hidden entirely
 * when the document has no footnotes: an empty "Notes" heading is furniture.
 */
export function FootnotesList({ editor, readOnly }: { editor: Editor; readOnly: boolean }) {
  const [entries, setEntries] = useState<FootnoteEntry[]>(() => footnotesOf(editor.state.doc));

  useEffect(() => {
    const update = () => setEntries(footnotesOf(editor.state.doc));
    update();
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor]);

  if (entries.length === 0) return null;

  return (
    <aside className="doc-footnotes" aria-label="Footnotes" contentEditable={false}>
      <ol>
        {entries.map((e) => (
          <li key={e.pos}>
            <input
              value={e.text}
              readOnly={readOnly}
              placeholder="Footnote text"
              aria-label={`Footnote ${e.number}`}
              onChange={(ev) => editor.commands.setFootnoteText(e.pos, ev.target.value)}
              onFocus={() => editor.commands.setNodeSelection(e.pos)}
            />
          </li>
        ))}
      </ol>
    </aside>
  );
}
