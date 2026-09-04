import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";

/**
 * A table of contents that draws itself from the headings.
 *
 * The node stores nothing but its place: the entries are computed from the
 * document on every render (`tocEntriesOf`), so a heading renamed, added or
 * moved is reflected the moment it happens — there is no "update table of
 * contents" button because there is nothing stale to update. Google Docs makes
 * you press one; Word makes you press one; both are a source of documents
 * whose contents page names sections that no longer exist.
 *
 * Rendered as a node view (`TableOfContentsView`) inside the editor, and as a
 * static list by the HTML exporter, so print and PDF carry it too.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tableOfContents: {
      insertTableOfContents: () => ReturnType;
    };
  }
}

export interface TocEntry {
  level: 1 | 2 | 3;
  text: string;
  /** The heading's position, for scrolling to it. */
  pos: number;
}

export function tocEntriesOf(doc: PmNode): TocEntry[] {
  const out: TocEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const level = Math.min(3, Math.max(1, Number(node.attrs.level ?? 1))) as 1 | 2 | 3;
      const text = node.textContent.trim();
      if (text) out.push({ level, text, pos });
      return false;
    }
    return true;
  });
  return out;
}

/** The static markup the exporter writes, from the same entries. */
export function tocHtml(entries: TocEntry[]): string {
  if (entries.length === 0) return `<nav class="doc-toc"><p class="doc-toc-empty">No headings yet.</p></nav>`;
  const items = entries
    .map((e) => `<li class="doc-toc-l${e.level}">${escapeHtml(e.text)}</li>`)
    .join("");
  return `<nav class="doc-toc"><p class="doc-toc-title">Contents</p><ol>${items}</ol></nav>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: "nav[data-toc]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["nav", mergeAttributes(HTMLAttributes, { "data-toc": "true", class: "doc-toc" })];
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ chain }) =>
          chain().insertContent({ type: this.name }).insertContent({ type: "paragraph" }).run(),
    };
  },
});
