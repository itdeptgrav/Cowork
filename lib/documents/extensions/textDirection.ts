/**
 * Right-to-left text — Arabic, Hebrew, Urdu, Persian.
 *
 * Direction is a property of the block (`dir="rtl"`), as in Docs' Format ▸
 * Paragraph direction: the whole paragraph, heading or list item flips,
 * with its alignment, and mixed-language pages can set it block by block.
 */

import { Extension } from "@tiptap/core";

export type TextDirection = "ltr" | "rtl";

const TYPES = ["paragraph", "heading", "listItem", "taskItem", "blockquote", "tableCell", "tableHeader"];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textDirection: {
      /** `null` returns the blocks to the page's own direction. */
      setTextDirection: (dir: TextDirection | null) => ReturnType;
    };
  }
}

export const TextDirectionExtension = Extension.create({
  name: "textDirection",

  addGlobalAttributes() {
    return [
      {
        types: TYPES,
        attributes: {
          dir: {
            default: null,
            parseHTML: (el) => {
              const v = el.getAttribute("dir");
              return v === "rtl" || v === "ltr" ? v : null;
            },
            renderHTML: (attrs) => (attrs.dir ? { dir: attrs.dir } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTextDirection:
        (dir) =>
        ({ commands }) =>
          TYPES.map((t) => commands.updateAttributes(t, { dir })).some(Boolean),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-x": () => {
        const current = this.editor.getAttributes("paragraph").dir ?? this.editor.getAttributes("heading").dir ?? null;
        return this.editor.commands.setTextDirection(current === "rtl" ? null : "rtl");
      },
    };
  },
});
