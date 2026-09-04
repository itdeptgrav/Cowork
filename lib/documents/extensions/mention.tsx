"use client";

import Mention from "@tiptap/extension-mention";
import type { Employee } from "@/lib/domain";
import type { SuggestionItem } from "@/components/features/workspace/docs/SuggestionMenu";
import { suggestionRender } from "./suggestionRender";

/**
 * @mentions of colleagues.
 *
 * Type `@` and a name; pick one and the document carries a mention chip with
 * the person's id, so a later reader can follow it and a later feature can
 * notify them.
 *
 * ## Where the names come from
 *
 * `mentionDirectory` is a module-level slot the editor fills from the
 * workspace directory in an effect. The extension is built once when the
 * editor mounts and reads the slot each time the menu opens, so it always
 * sees the latest list without the editor having to be rebuilt — and without
 * a React ref being read during render, which the compiler rule forbids.
 */
export const mentionDirectory: { people: Employee[] } = { people: [] };

export function mentionExtension() {
  return Mention.configure({
    HTMLAttributes: { class: "doc-mention" },
    renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    renderHTML: ({ options, node }) => [
      "span",
      { ...options.HTMLAttributes, "data-mention-id": node.attrs.id, "data-type": "mention" },
      `@${node.attrs.label ?? node.attrs.id}`,
    ],
    suggestion: {
      char: "@",
      items: ({ query }): SuggestionItem[] => {
        const q = query.trim().toLowerCase();
        return mentionDirectory.people
          .filter((p) => !q || p.displayName.toLowerCase().includes(q))
          .slice(0, 8)
          .map((p) => ({
            id: p.id,
            label: p.displayName,
            hint: [p.designation, p.departmentName].filter(Boolean).join(" · ") || undefined,
            glyph: p.displayName.trim().charAt(0).toUpperCase(),
          }));
      },
      command: ({ editor, range, props }) => {
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            { type: "mention", attrs: { id: props.id, label: props.label } },
            { type: "text", text: " " },
          ])
          .run();
      },
      render: suggestionRender("People"),
    },
  });
}
