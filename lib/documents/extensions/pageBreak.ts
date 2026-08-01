import { Node } from "@tiptap/core";

/**
 * An explicit page break.
 *
 * ## Why this exists when the page is one continuous sheet
 *
 * Where the printer breaks a page is decided by the browser at print time, from
 * content height. That is out of the editor's hands and it is fine — except for
 * the one case a writer genuinely needs to control: *this section starts on a
 * new page*. A horizontal rule cannot say that, and a screenful of empty
 * paragraphs says it only until somebody edits the text above.
 *
 * So the break is a real node in the document. On screen it is a labelled line,
 * because an invisible break is one people delete by accident and then cannot
 * find. In print it is `break-after: page`, which is the whole point of it.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: {
      setPageBreak: () => ReturnType;
    };
  }
}

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  /* No content and not selectable as text, but selectable as a node — so it can
     be deleted with Backspace like any other block. */
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },

  renderHTML() {
    return ["div", { "data-page-break": "true", class: "doc-page-break" }];
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name })
            /* A paragraph after it, or a break inserted at the end of a
               document leaves nowhere to type on the new page. */
            .insertContent({ type: "paragraph" })
            .run(),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => this.editor.commands.setPageBreak(),
    };
  },
});
