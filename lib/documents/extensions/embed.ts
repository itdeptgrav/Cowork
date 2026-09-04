import { mergeAttributes, Node } from "@tiptap/core";

/**
 * An embedded page — a map, a design, a form, a video that is not YouTube.
 *
 * YouTube has its own extension (Tiptap's), because it needs the privacy
 * domain and player options. Everything else is an `<iframe>` with the
 * strictest sandbox that still lets the embedded page run: scripts and
 * same-origin for itself, and nothing that reaches back into this page or
 * navigates it. Only `https:` addresses are accepted; anything else is refused
 * at insert time rather than rendered as a broken frame.
 */

export function embedSrc(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return null;
    /* A YouTube watch link belongs to the YouTube node, but somebody who pastes
       one here gets the embeddable form rather than a refusal. */
    if (/(^|\.)youtube\.com$/.test(url.hostname) && url.searchParams.get("v"))
      return `https://www.youtube-nocookie.com/embed/${url.searchParams.get("v")}`;
    if (url.hostname === "youtu.be") return `https://www.youtube-nocookie.com/embed/${url.pathname.slice(1)}`;
    return url.toString();
  } catch {
    return null;
  }
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embed: {
      setEmbed: (src: string) => ReturnType;
    };
  }
}

export const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (el) => el.querySelector("iframe")?.getAttribute("src") ?? el.getAttribute("data-src"),
        renderHTML: () => ({}),
      },
      height: {
        default: 360,
        parseHTML: (el) => Number(el.getAttribute("data-height")) || 360,
        renderHTML: (attrs) => ({ "data-height": String(attrs.height) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-embed]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-embed": "true", "data-src": node.attrs.src, class: "doc-embed" }),
      [
        "iframe",
        {
          src: node.attrs.src,
          height: String(node.attrs.height),
          loading: "lazy",
          allowfullscreen: "true",
          referrerpolicy: "no-referrer",
          sandbox: "allow-scripts allow-same-origin allow-popups allow-forms",
        },
      ],
    ];
  },

  addCommands() {
    return {
      setEmbed:
        (raw) =>
        ({ chain }) => {
          const src = embedSrc(raw);
          if (!src) return false;
          return chain().insertContent({ type: this.name, attrs: { src } }).insertContent({ type: "paragraph" }).run();
        },
    };
  },
});
