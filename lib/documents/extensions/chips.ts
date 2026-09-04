/**
 * Smart chips — the inline date and dropdown Docs puts in a line of text.
 *
 * Both are inline atoms: a chip is one unit the caret steps over, deleted
 * with one Backspace, and carried through copy and paste. A click on a chip
 * raises a `cowork:chip` DOM event with the chip's position, and the editor
 * shell answers it with a small popover (a date picker, or the option list)
 * that writes the new value back as node attributes. Keeping the popover in
 * the shell — rather than a node view — means the chips stay plain DOM in
 * every export and in the collaborative document.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export interface ChipClickDetail {
  kind: "dateChip" | "dropdownChip";
  pos: number;
  attrs: Record<string, unknown>;
  rect: DOMRect;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    dateChip: {
      /** ISO date (YYYY-MM-DD); today when omitted. */
      insertDateChip: (date?: string) => ReturnType;
    };
    dropdownChip: {
      insertDropdownChip: (options: string[], value?: string) => ReturnType;
    };
  }
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "4 Sep 2026" for an ISO date; the raw text when it is not one. */
export function formatChipDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function clickPlugin(kind: ChipClickDetail["kind"]) {
  return new Plugin({
    key: new PluginKey(`${kind}Click`),
    props: {
      handleClickOn(view, _pos, node, nodePos, event) {
        if (node.type.name !== kind) return false;
        const target = (event.target as HTMLElement | null)?.closest(`[data-${kind === "dateChip" ? "date-chip" : "dropdown-chip"}]`);
        const rect = (target ?? (event.target as HTMLElement)).getBoundingClientRect();
        view.dom.dispatchEvent(
          new CustomEvent<ChipClickDetail>("cowork:chip", { bubbles: true, detail: { kind, pos: nodePos, attrs: { ...node.attrs }, rect } }),
        );
        return true;
      },
    },
  });
}

export const DateChip = Node.create({
  name: "dateChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      date: { default: "", parseHTML: (el) => el.getAttribute("data-date") ?? "", renderHTML: (a) => ({ "data-date": a.date }) },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-date-chip]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-date-chip": "", class: "doc-chip doc-chip-date", contenteditable: "false" }), "📅 " + formatChipDate(String(node.attrs.date))];
  },

  addCommands() {
    return {
      insertDateChip:
        (date) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs: { date: date ?? todayIso() } }, { type: "text", text: " " }]),
    };
  },

  addProseMirrorPlugins() {
    return [clickPlugin("dateChip")];
  },
});

export const DEFAULT_DROPDOWN_OPTIONS = ["Not started", "In progress", "Done"];

export const DropdownChip = Node.create({
  name: "dropdownChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      options: {
        default: DEFAULT_DROPDOWN_OPTIONS,
        parseHTML: (el) => {
          try {
            const raw = JSON.parse(el.getAttribute("data-options") ?? "[]");
            return Array.isArray(raw) && raw.length ? raw.map(String) : DEFAULT_DROPDOWN_OPTIONS;
          } catch {
            return DEFAULT_DROPDOWN_OPTIONS;
          }
        },
        renderHTML: (a) => ({ "data-options": JSON.stringify(a.options) }),
      },
      value: { default: "", parseHTML: (el) => el.getAttribute("data-value") ?? "", renderHTML: (a) => ({ "data-value": a.value }) },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-dropdown-chip]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const value = String(node.attrs.value || (node.attrs.options as string[])[0] || "Select");
    return ["span", mergeAttributes(HTMLAttributes, { "data-dropdown-chip": "", class: "doc-chip doc-chip-dropdown", contenteditable: "false" }), value + " ▾"];
  },

  addCommands() {
    return {
      insertDropdownChip:
        (options, value) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs: { options, value: value ?? options[0] ?? "" } }, { type: "text", text: " " }]),
    };
  },

  addProseMirrorPlugins() {
    return [clickPlugin("dropdownChip")];
  },
});
