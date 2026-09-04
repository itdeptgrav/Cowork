import { mergeAttributes, Node } from "@tiptap/core";

/**
 * Columns — two or three side by side.
 *
 * Two nodes: `columns` holds `column`s, and a `column` holds blocks. The count
 * is an attribute on the container so the CSS grid can be set from it; each
 * column is equal width, which is what a document wants (a newsletter's two
 * columns are the same width) and what keeps the block predictable in print.
 *
 * Deleting the last content in a column leaves an empty paragraph rather than
 * collapsing the column, so a column never disappears under the caret. Unwrap
 * (Format ▸ Columns ▸ Remove) lifts every column's blocks back into the flow
 * in order.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columns: {
      setColumns: (count: 2 | 3) => ReturnType;
      unsetColumns: () => ReturnType;
    };
  }
}

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-column": "true", class: "doc-column" }), 0];
  },
});

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,3}",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      count: {
        default: 2,
        parseHTML: (el) => (el.getAttribute("data-count") === "3" ? 3 : 2),
        renderHTML: (attrs) => ({ "data-count": String(attrs.count) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-columns": "true", class: "doc-columns" }), 0];
  },

  addCommands() {
    return {
      setColumns:
        (count) =>
        ({ chain, state }) => {
          /* The current block goes into the first column; the rest start empty. */
          const columns = Array.from({ length: count }, (_, i) => ({
            type: "column",
            content: [
              i === 0 && !state.selection.empty ? { type: "paragraph" } : { type: "paragraph" },
            ],
          }));
          return chain()
            .insertContent({ type: this.name, attrs: { count }, content: columns })
            .run();
        },
      unsetColumns:
        () =>
        ({ state, tr, dispatch }) => {
          /* Find the enclosing columns node and replace it with its columns'
             children, flattened in order. */
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name !== this.name) continue;
            const pos = $from.before(d);
            const blocks: import("@tiptap/pm/model").Node[] = [];
            node.forEach((column) => column.forEach((block) => blocks.push(block)));
            if (dispatch) tr.replaceWith(pos, pos + node.nodeSize, blocks);
            return true;
          }
          return false;
        },
    };
  },
});
