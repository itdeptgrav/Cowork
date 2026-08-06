import { Mark, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

/**
 * The mark that anchors a comment thread to a run of text.
 *
 * **The mark IS the position.** A thread does not store a from/to offset —
 * offsets shift under concurrent edits and would need constant remapping.
 * Anchoring with a real ProseMirror mark means the anchor moves with the
 * text automatically, the same way `bold`/`italic` do, and — because it
 * lives inside the content the `Collaboration` extension already syncs — it
 * replicates to everyone in the room for free, with no separate sync code.
 *
 * **One comment per run, by design.** A mark type excludes itself by
 * default, so a second `setComment` over already-marked text replaces
 * rather than stacks. Two genuinely overlapping threads on the same
 * characters are not supported in this version — a deliberate simplicity
 * trade, not an oversight; most editors share it.
 */

export interface CommentOptions {
  /** Fired when a marked run is clicked, with the thread id it carries. */
  onActivate: ((commentId: string) => void) | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comment: {
      setComment: (commentId: string) => ReturnType;
      unsetComment: () => ReturnType;
    };
  }
}

export const CommentMark = Mark.create<CommentOptions>({
  name: "comment",

  addOptions() {
    return { onActivate: null };
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-comment-id"),
        renderHTML: (attributes) =>
          attributes.commentId ? { "data-comment-id": attributes.commentId } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "doc-comment-mark" }),
      0,
    ];
  },

  addCommands() {
    return {
      setComment:
        (commentId) =>
        ({ commands }) =>
          commands.setMark(this.name, { commentId }),
      unsetComment:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        props: {
          handleClick(view, pos) {
            if (!options.onActivate) return false;
            const mark = view.state.doc
              .resolve(pos)
              .marks()
              .find((m) => m.type.name === "comment");
            const commentId = mark?.attrs.commentId;
            if (typeof commentId !== "string") return false;
            options.onActivate(commentId);
            return true;
          },
        },
      }),
    ];
  },
});
