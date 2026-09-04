import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";

/**
 * A bookmark — a named place in the document a link can point to.
 *
 * Invisible in print and almost invisible on screen (a small flag at the
 * caret), it exists so that "see the pricing table" can be a link that lands
 * on the pricing table rather than a sentence. Headings are bookmarks too,
 * automatically: the link dialog offers both.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    bookmark: {
      insertBookmark: (name: string) => ReturnType;
    };
  }
}

export interface BookmarkEntry {
  id: string;
  name: string;
  pos: number;
}

export function bookmarksOf(doc: PmNode): BookmarkEntry[] {
  const out: BookmarkEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "bookmark") out.push({ id: String(node.attrs.id), name: String(node.attrs.name), pos });
    return true;
  });
  return out;
}

export function bookmarkId(name: string): string {
  return (
    "bm-" +
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
  );
}

export const Bookmark = Node.create({
  name: "bookmark",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: { default: "", parseHTML: (el) => el.getAttribute("id") ?? "", renderHTML: (a) => ({ id: a.id }) },
      name: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-name") ?? "",
        renderHTML: (a) => ({ "data-name": a.name, title: `Bookmark: ${a.name}` }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-bookmark]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-bookmark": "true", class: "doc-bookmark" })];
  },

  addCommands() {
    return {
      insertBookmark:
        (name) =>
        ({ chain }) => {
          const clean = name.trim();
          if (!clean) return false;
          return chain().insertContent({ type: this.name, attrs: { id: bookmarkId(clean), name: clean } }).run();
        },
    };
  },
});
