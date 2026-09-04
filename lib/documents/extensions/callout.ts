import { mergeAttributes, Node } from "@tiptap/core";

/**
 * A callout — a tinted box that says "this paragraph is different".
 *
 * Four tones, named for what they mean rather than for a colour: note,
 * info, warning, success. Notion has these as the "callout" block and Google
 * Docs users fake them with a one-cell table; either way it is the block
 * people reach for to make a warning read as a warning.
 *
 * It holds blocks (paragraphs, lists), not just text, so a callout can carry
 * a checklist. The emoji at the left is the tone's, not editable — a callout
 * with a custom emoji is a Notion-ism that turns every callout into a small
 * design decision.
 */

export type CalloutTone = "note" | "info" | "warning" | "success";
const TONES: CalloutTone[] = ["note", "info", "warning", "success"];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (tone?: CalloutTone) => ReturnType;
      toggleCallout: (tone?: CalloutTone) => ReturnType;
      setCalloutTone: (tone: CalloutTone) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      tone: {
        default: "note",
        parseHTML: (el) => {
          const t = el.getAttribute("data-tone");
          return TONES.includes(t as CalloutTone) ? t : "note";
        },
        renderHTML: (attrs) => ({ "data-tone": attrs.tone }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "true", class: "doc-callout" }), 0];
  },

  addCommands() {
    return {
      setCallout:
        (tone = "note") =>
        ({ commands }) =>
          commands.wrapIn(this.name, { tone }),
      toggleCallout:
        (tone = "note") =>
        ({ commands }) =>
          commands.toggleWrap(this.name, { tone }),
      setCalloutTone:
        (tone) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { tone }),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-c": () => this.editor.commands.toggleCallout(),
    };
  },
});
