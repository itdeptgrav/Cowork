import type { Editor, Range } from "@tiptap/core";
import type { SuggestionItem } from "@/components/features/workspace/docs/SuggestionMenu";

/**
 * What the slash menu offers, as data — kept apart from the extension so the
 * list and its matching can be tested without a browser.
 *
 * Each entry runs a chain on the editor at the trigger's range, so the `/`
 * and whatever was typed after it are replaced by the block. Entries that
 * need a value (a link, an equation, an embed) hand off to the editor's own
 * dialogs through `ask`, because a prompt inside a keyboard menu is one more
 * thing to dismiss.
 */

export type SlashAsk = (kind: "link" | "image" | "embed" | "youtube" | "math" | "footnote" | "bookmark" | "attachment") => void;

export interface SlashCommandItem extends SuggestionItem {
  keywords: string[];
  run: (editor: Editor, range: Range, ask: SlashAsk) => void;
}

export function slashItems(): SlashCommandItem[] {
  const del = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);
  return [
    { id: "h1", label: "Heading 1", hint: "The document's title size", glyph: "H1", keywords: ["title", "heading"], run: (e, r) => del(e, r).setHeading({ level: 1 }).run() },
    { id: "h2", label: "Heading 2", hint: "A section", glyph: "H2", keywords: ["section", "heading"], run: (e, r) => del(e, r).setHeading({ level: 2 }).run() },
    { id: "h3", label: "Heading 3", hint: "A sub-section", glyph: "H3", keywords: ["heading"], run: (e, r) => del(e, r).setHeading({ level: 3 }).run() },
    { id: "text", label: "Text", hint: "Plain paragraph", glyph: "¶", keywords: ["paragraph", "normal"], run: (e, r) => del(e, r).setParagraph().run() },
    { id: "bullets", label: "Bulleted list", glyph: "•", keywords: ["list", "ul"], run: (e, r) => del(e, r).toggleBulletList().run() },
    { id: "numbers", label: "Numbered list", glyph: "1.", keywords: ["list", "ol", "ordered"], run: (e, r) => del(e, r).toggleOrderedList().run() },
    { id: "checklist", label: "Checklist", hint: "Tick boxes", glyph: "☑", keywords: ["todo", "task", "checkbox"], run: (e, r) => del(e, r).toggleTaskList().run() },
    { id: "quote", label: "Quote", glyph: "❝", keywords: ["blockquote"], run: (e, r) => del(e, r).toggleBlockquote().run() },
    { id: "code", label: "Code block", hint: "With syntax colouring", glyph: "</>", keywords: ["code", "pre", "snippet"], run: (e, r) => del(e, r).toggleCodeBlock().run() },
    { id: "callout", label: "Callout", hint: "A tinted note box", glyph: "💡", keywords: ["note", "info", "warning", "tip"], run: (e, r) => del(e, r).setCallout("note").run() },
    { id: "toggle", label: "Toggle", hint: "A collapsible section", glyph: "▸", keywords: ["details", "collapse", "expand"], run: (e, r) => del(e, r).setDetails().run() },
    { id: "columns2", label: "Two columns", glyph: "▥", keywords: ["columns", "layout"], run: (e, r) => del(e, r).setColumns(2).run() },
    { id: "columns3", label: "Three columns", glyph: "▦", keywords: ["columns", "layout"], run: (e, r) => del(e, r).setColumns(3).run() },
    { id: "table", label: "Table", hint: "3 × 3 with a header row", glyph: "⊞", keywords: ["grid"], run: (e, r) => del(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: "toc", label: "Table of contents", hint: "Built from the headings, always current", glyph: "≡", keywords: ["toc", "contents", "index", "outline"], run: (e, r) => del(e, r).insertTableOfContents().run() },
    { id: "image", label: "Image", glyph: "🖼", keywords: ["picture", "photo"], run: (e, r, ask) => { del(e, r).run(); ask("image"); } },
    { id: "link", label: "Link", glyph: "🔗", keywords: ["url", "href"], run: (e, r, ask) => { del(e, r).run(); ask("link"); } },
    { id: "youtube", label: "YouTube video", glyph: "▶", keywords: ["video", "embed"], run: (e, r, ask) => { del(e, r).run(); ask("youtube"); } },
    { id: "embed", label: "Embed a page", hint: "A map, a design, a form", glyph: "⧉", keywords: ["iframe", "embed", "figma", "maps"], run: (e, r, ask) => { del(e, r).run(); ask("embed"); } },
    { id: "math", label: "Equation", hint: "LaTeX, rendered", glyph: "∑", keywords: ["formula", "latex", "katex", "maths"], run: (e, r, ask) => { del(e, r).run(); ask("math"); } },
    { id: "footnote", label: "Footnote", glyph: "¹", keywords: ["note", "reference", "citation"], run: (e, r, ask) => { del(e, r).run(); ask("footnote"); } },
    { id: "bookmark", label: "Bookmark", hint: "A place a link can point to", glyph: "⚑", keywords: ["anchor", "jump"], run: (e, r, ask) => { del(e, r).run(); ask("bookmark"); } },
    { id: "attachment", label: "Attachment", hint: "A file from your computer, kept in Drive", glyph: "📎", keywords: ["file", "upload", "pdf", "attach"], run: (e, r, ask) => { del(e, r).run(); ask("attachment"); } },
    { id: "date", label: "Date chip", hint: "Today; click it to change", glyph: "📅", keywords: ["today", "calendar", "chip", "when"], run: (e, r) => del(e, r).insertDateChip().run() },
    { id: "dropdown", label: "Dropdown chip", hint: "A status picked from a list", glyph: "▾", keywords: ["status", "select", "chip", "option"], run: (e, r) => del(e, r).insertDropdownChip(["Not started", "In progress", "Done"]).run() },
    { id: "hr", label: "Horizontal line", glyph: "—", keywords: ["divider", "rule", "separator"], run: (e, r) => del(e, r).setHorizontalRule().run() },
    { id: "pagebreak", label: "Page break", glyph: "⤓", keywords: ["page", "break", "new page"], run: (e, r) => del(e, r).setPageBreak().run() },
    { id: "date", label: "Today's date", glyph: "📅", keywords: ["today", "date"], run: (e, r) => del(e, r).insertContent(new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })).run() },
  ];
}

export function filterSlashItems(items: SlashCommandItem[], query: string): SlashCommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (i) => i.label.toLowerCase().includes(q) || i.keywords.some((k) => k.includes(q)),
  );
}
