import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";

/**
 * Footnotes.
 *
 * ## The shape, and why it is one node rather than two
 *
 * A footnote is an inline marker in the text and a note at the foot of the
 * page. Word and Google Docs store those as two linked things and keep them in
 * step; every editor that has tried that on top of a CRDT has a story about
 * markers and notes drifting apart. Here the note's TEXT lives on the marker
 * (`text` attribute), so the two cannot disagree, and the list at the foot of
 * the page is DERIVED by walking the document in order — see `footnotesOf`.
 * The numbers are positions, never stored, so inserting a note above another
 * renumbers everything by construction, exactly as Word does.
 *
 * The cost is that a note is plain text, not rich text. That is the right
 * trade: a footnote is a sentence, and a footnote that wants a table is a
 * section.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: {
      insertFootnote: (text?: string) => ReturnType;
      setFootnoteText: (pos: number, text: string) => ReturnType;
    };
  }
}

export interface FootnoteEntry {
  /** 1-based, in document order. */
  number: number;
  text: string;
  /** Position of the marker node, for "go to" and for editing. */
  pos: number;
}

/** Every footnote in document order. */
export function footnotesOf(doc: PmNode): FootnoteEntry[] {
  const out: FootnoteEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "footnote") {
      out.push({ number: out.length + 1, text: String(node.attrs.text ?? ""), pos });
    }
    return true;
  });
  return out;
}

export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-text") ?? el.getAttribute("title") ?? "",
        renderHTML: (attrs) => ({ "data-text": attrs.text, title: attrs.text }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "sup[data-footnote]" }];
  },

  renderHTML({ HTMLAttributes }) {
    /* The number is painted by CSS counters (`counter-increment: footnote`)
       so the stored HTML carries no stale digit; exported HTML gets the
       counter rule inlined too. */
    return ["sup", mergeAttributes(HTMLAttributes, { "data-footnote": "true", class: "doc-footnote-ref" })];
  },

  addCommands() {
    return {
      insertFootnote:
        (text = "") =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs: { text } })
            .run(),
      setFootnoteText:
        (pos, text) =>
        ({ tr, state, dispatch }) => {
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== this.name) return false;
          if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, text });
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-f": () => this.editor.commands.insertFootnote(),
    };
  },
});
