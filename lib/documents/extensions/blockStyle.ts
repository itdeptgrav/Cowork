import { Extension } from "@tiptap/core";

/**
 * Line spacing and paragraph indentation — as BLOCK attributes.
 *
 * ## Why not the shipped `LineHeight`
 *
 * Tiptap's own line-height extension sets a mark on `textStyle`, so the value
 * lands on a `<span>` around the selected characters. That is wrong for this
 * property in two ways a reader will meet immediately: an empty paragraph has
 * no characters to hold the span, so pressing 1.5 on a blank line does nothing;
 * and selecting half a paragraph gives that half a different leading from the
 * rest of the same block, which is not a thing a paragraph can be.
 *
 * Line spacing belongs to the paragraph. So does indentation — the caret only
 * has to be inside a block for the whole block to move, which is what every
 * word processor's indent button does.
 *
 * ## Indentation is stored in steps, not in inches
 *
 * `indent: 2` is "two steps in", rendered at half an inch each. Storing the
 * inches would freeze today's step size into every document ever written, and
 * a later change to the step would silently re-lay out old text.
 */

export const INDENT_STEP_IN = 0.5;
export const MAX_INDENT_STEPS = 12;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockStyle: {
      /** Set the leading of every block in the selection. `null` clears it. */
      setLineSpacing: (value: string | null) => ReturnType;
      /** Move every block in the selection in or out by `delta` steps. */
      indentBlocks: (delta: number) => ReturnType;
    };
  }
}

export interface BlockStyleOptions {
  /** Node names that carry the attributes. */
  types: string[];
}

export const BlockStyle = Extension.create<BlockStyleOptions>({
  name: "blockStyle",

  addOptions() {
    return { types: ["paragraph", "heading"] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => element.style.lineHeight || null,
            renderHTML: (attributes) =>
              attributes.lineHeight
                ? { style: `line-height: ${attributes.lineHeight}` }
                : {},
          },
          indent: {
            default: 0,
            /* Parsed from the data attribute rather than from the inches in
               `style`, so a document round-trips through HTML without its
               indentation drifting as the step size is re-divided. */
            parseHTML: (element) => {
              const raw = Number(element.getAttribute("data-indent"));
              return Number.isFinite(raw) ? Math.min(MAX_INDENT_STEPS, Math.max(0, raw)) : 0;
            },
            renderHTML: (attributes) => {
              const steps = Number(attributes.indent) || 0;
              if (steps <= 0) return {};
              return {
                "data-indent": String(steps),
                /* Inline inches as well as the step count: the HTML is what
                   export, print and the mail preview read, and none of them
                   runs this extension. */
                style: `margin-inline-start: ${steps * INDENT_STEP_IN}in`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineSpacing:
        (value) =>
        ({ commands }) =>
          /* `every` rather than `some`: the selection may span a heading and a
             paragraph, and both must move or the block that missed out keeps a
             leading nobody chose. `updateAttributes` is a no-op for a type the
             selection does not touch, so this is not as strict as it reads. */
          this.options.types.every((type) =>
            commands.updateAttributes(type, { lineHeight: value }),
          ),

      indentBlocks:
        (delta) =>
        ({ state, tr, dispatch }) => {
          const { from, to } = state.selection;
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!this.options.types.includes(node.type.name)) return;
            const current = Number(node.attrs.indent) || 0;
            const next = Math.min(
              MAX_INDENT_STEPS,
              Math.max(0, current + delta),
            );
            if (next === current) return;
            tr.setNodeAttribute(pos, "indent", next);
            changed = true;
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
    };
  },
});
