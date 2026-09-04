"use client";

import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
/* Type-level only: the Details package augments `ChainedCommands` with
   `setDetails`, and that augmentation is only seen once the module is loaded. */
import "@tiptap/extension-details";
import "./callout";
import "./columns";
import "./tableOfContents";
import "./pageBreak";
import { suggestionRender } from "./suggestionRender";
import { filterSlashItems, slashItems, type SlashAsk, type SlashCommandItem } from "./slashItems";

export type { SlashAsk, SlashCommandItem } from "./slashItems";

/**
 * Slash commands — type `/` at the start of a line and choose what to insert.
 *
 * The list itself is `slashItems.ts`; this is the Tiptap plumbing around it.
 */
export function slashCommandsExtension(ask: SlashAsk) {
  const items = slashItems();
  return Extension.create({
    name: "slashCommands",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommandItem>({
          editor: this.editor,
          char: "/",
          /* Only at the start of a line — a slash in a URL or a date must not
             open a menu. */
          startOfLine: true,
          allowSpaces: false,
          items: ({ query }) => filterSlashItems(items, query).slice(0, 12),
          command: ({ editor, range, props }) => props.run(editor, range, ask),
          render: suggestionRender("Insert"),
        }),
      ];
    },
  });
}
