/**
 * A file attached to the page — Notion's file block.
 *
 * The block is a card with the file's name and size; clicking opens or
 * downloads it. The bytes live in Drive (uploaded through the repository
 * the same way images are); the document keeps only the link, so a
 * large attachment costs the page nothing.
 */

import { Node, mergeAttributes } from "@tiptap/core";

export interface AttachmentAttrs {
  name: string;
  url: string;
  size: number | null;
  fileId: string | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    attachment: {
      insertAttachment: (attrs: AttachmentAttrs) => ReturnType;
    };
  }
}

/** "1.2 MB", "340 KB", "12 B". */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export const Attachment = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      name: { default: "File", parseHTML: (el) => el.getAttribute("data-name") ?? "File", renderHTML: (a) => ({ "data-name": a.name }) },
      url: { default: "", parseHTML: (el) => el.getAttribute("data-url") ?? "", renderHTML: (a) => ({ "data-url": a.url }) },
      size: {
        default: null,
        parseHTML: (el) => {
          const n = Number(el.getAttribute("data-size"));
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (a) => (a.size ? { "data-size": String(a.size) } : {}),
      },
      fileId: { default: null, parseHTML: (el) => el.getAttribute("data-file-id"), renderHTML: (a) => (a.fileId ? { "data-file-id": a.fileId } : {}) },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-attachment]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const size = formatFileSize(node.attrs.size as number | null);
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-attachment": "", class: "doc-attachment" }),
      ["span", { class: "doc-attachment-icon", "aria-hidden": "true" }, "📎"],
      [
        "a",
        { href: String(node.attrs.url), target: "_blank", rel: "noopener noreferrer", class: "doc-attachment-name", download: String(node.attrs.name) },
        String(node.attrs.name),
      ],
      ["span", { class: "doc-attachment-size" }, size],
    ];
  },

  addCommands() {
    return {
      insertAttachment:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
