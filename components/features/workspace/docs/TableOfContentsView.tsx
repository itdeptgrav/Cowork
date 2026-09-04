"use client";

import { useEffect, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { tocEntriesOf, type TocEntry } from "@/lib/documents/extensions/tableOfContents";

/**
 * The table of contents, drawn live from the headings.
 *
 * Subscribes to the editor's updates and recomputes; clicking an entry scrolls
 * the heading into view and puts the caret there. There is nothing to refresh
 * and nothing stored — see the extension's header.
 */
export function TableOfContentsView({ editor, selected }: NodeViewProps) {
  const [entries, setEntries] = useState<TocEntry[]>(() => tocEntriesOf(editor.state.doc));

  useEffect(() => {
    const update = () => setEntries(tocEntriesOf(editor.state.doc));
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor]);

  return (
    <NodeViewWrapper
      as="nav"
      className={`doc-toc ${selected ? "doc-toc-selected" : ""}`}
      contentEditable={false}
      data-toc="true"
    >
      <p className="doc-toc-title">Contents</p>
      {entries.length === 0 ? (
        <p className="doc-toc-empty">Add headings and they appear here.</p>
      ) : (
        <ol>
          {entries.map((e) => (
            <li key={`${e.pos}-${e.text}`} className={`doc-toc-l${e.level}`}>
              <button
                type="button"
                onClick={() => {
                  editor.commands.focus(e.pos + 1);
                  const dom = editor.view.nodeDOM(e.pos) as HTMLElement | null;
                  dom?.scrollIntoView({ block: "start", behavior: "smooth" });
                }}
              >
                {e.text}
              </button>
            </li>
          ))}
        </ol>
      )}
    </NodeViewWrapper>
  );
}
