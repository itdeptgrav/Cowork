import type { MindNode, MindNodeId } from "../../domain/mindmap.ts";
import { childrenOf, newNode, rootOf, type MindMap } from "./tree.ts";

/**
 * A mindmap as text, both ways: Markdown outlines and OPML.
 *
 * ## Why these two
 *
 * Every mindmap tool exports an outline and most import one — it is how a map
 * leaves for a document, arrives from a meeting's notes, or moves between two
 * products that share no file format. Markdown is the one people can write by
 * hand; OPML is the one the tools exchange (XMind, MindNode, Workflowy, every
 * outliner). Between them a map can go anywhere.
 *
 * ## The shape of the text
 *
 * Markdown: the root as a `#` heading, then one nested bullet per card, two
 * spaces of indent per depth. A description follows its card as an indented
 * quote, one line — enough to survive a round trip without inventing a syntax.
 *
 * Both readers are forgiving: tabs or spaces, `-` or `*` or `+` bullets,
 * numbered items, blank lines anywhere. Indent decides the parent — a line
 * indented more than the one above is its child, the same is its sibling, and
 * less climbs back up. A line indented more than one step deeper than its
 * parent is still just a child; nothing is refused for being ragged.
 */

/* ── Markdown ─────────────────────────────────────────────────────────────── */

export function mapToMarkdown(map: MindMap): string {
  const root = rootOf(map);
  if (!root) return "";
  const lines: string[] = [`# ${root.title.trim() || "Untitled"}`];
  if (root.description.trim()) lines.push("", `> ${oneLine(root.description)}`);
  lines.push("");
  const walk = (node: MindNode, depth: number) => {
    for (const child of childrenOf(map, node.id)) {
      const pad = "  ".repeat(depth);
      lines.push(`${pad}- ${child.title.trim() || "Untitled"}`);
      if (child.description.trim()) lines.push(`${pad}  > ${oneLine(child.description)}`);
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return lines.join("\n") + "\n";
}

function oneLine(text: string): string {
  return text.replace(/\s*\n+\s*/g, " ").trim();
}

export interface ParsedOutline {
  nodes: MindNode[];
  /** Lines that could not be placed and were skipped, for the import summary. */
  skipped: number;
}

/**
 * A Markdown or plain-text outline, as a card tree.
 *
 * The root is the first `#` heading if there is one, else the first
 * non-blank line, else "Imported". Everything after it is bullets. A line that
 * is neither a bullet nor a quote nor a heading is treated as a bullet at its
 * indent — pasted notes are usually indented lists without dashes.
 */
export function markdownToNodes(
  text: string,
  mintId: () => MindNodeId,
  fallbackTitle = "Imported",
): ParsedOutline {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  const nodes: MindNode[] = [];
  let skipped = 0;

  /* The root. */
  let start = 0;
  let rootTitle = fallbackTitle;
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (!line.trim()) continue;
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      rootTitle = heading[1].trim() || fallbackTitle;
      start = i + 1;
    } else if (!/^\s*([-*+]|\d+[.)])\s/.test(line)) {
      /* A plain first line names the map. */
      rootTitle = line.trim();
      start = i + 1;
    } else {
      start = i;
    }
    break;
  }
  const root = newNode(mintId(), null, rootTitle);
  nodes.push(root);

  /* The bullets. A stack of (indent, id) decides parents. */
  const stack: { indent: number; id: MindNodeId }[] = [{ indent: -1, id: root.id }];
  let last: MindNode | null = null;

  for (let i = start; i < raw.length; i++) {
    const line = raw[i];
    if (!line.trim()) continue;

    const quote = /^(\s*)>\s?(.*)$/.exec(line);
    if (quote && last) {
      last.description = last.description ? `${last.description}\n${quote[2].trim()}` : quote[2].trim();
      continue;
    }

    const m = /^(\s*)(?:([-*+]|\d+[.)])\s+)?(.*)$/.exec(line);
    if (!m) {
      skipped += 1;
      continue;
    }
    const indent = m[1].replace(/\t/g, "    ").length;
    const title = m[3].trim().replace(/^#+\s*/, "");
    if (!title) {
      skipped += 1;
      continue;
    }
    /* A root-level heading after the first is a top-level card. */
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].id;
    const node = newNode(mintId(), parent, title);
    nodes.push(node);
    stack.push({ indent, id: node.id });
    last = node;
  }

  return { nodes, skipped };
}

/* ── OPML ─────────────────────────────────────────────────────────────────── */

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function mapToOpml(map: MindMap): string {
  const root = rootOf(map);
  const outline = (node: MindNode, depth: number): string => {
    const pad = "  ".repeat(depth + 2);
    const note = node.description.trim() ? ` _note="${escapeXml(node.description.trim())}"` : "";
    const kids = childrenOf(map, node.id);
    if (kids.length === 0) return `${pad}<outline text="${escapeXml(node.title)}"${note} />`;
    return [
      `${pad}<outline text="${escapeXml(node.title)}"${note}>`,
      ...kids.map((k) => outline(k, depth + 1)),
      `${pad}</outline>`,
    ].join("\n");
  };
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<opml version="2.0">`,
    `  <head><title>${escapeXml(map.title || "Mindmap")}</title></head>`,
    `  <body>`,
    root ? outline(root, 0) : "",
    `  </body>`,
    `</opml>`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/**
 * OPML back to cards. Uses the platform's `DOMParser` where there is one and a
 * small tolerant scanner otherwise, so the same function serves the browser
 * and the test runner. One top-level outline becomes the root; several become
 * children of a root named for the document.
 */
export function opmlToNodes(
  xml: string,
  mintId: () => MindNodeId,
  fallbackTitle = "Imported",
): ParsedOutline {
  const items = scanOpml(xml);
  const nodes: MindNode[] = [];
  /* Nothing is skipped inside a well-formed OPML — an outline with no text
     becomes "Untitled" rather than being dropped, so the tree keeps its shape. */
  const skipped = 0;

  if (items.length === 0) return { nodes: [newNode(mintId(), null, fallbackTitle)], skipped: 1 };

  const build = (item: OpmlItem, parentId: MindNodeId | null): void => {
    const node = newNode(mintId(), parentId, item.text.trim() || "Untitled");
    if (item.note) node.description = item.note;
    nodes.push(node);
    for (const child of item.children) build(child, node.id);
  };

  if (items.length === 1) {
    build(items[0], null);
  } else {
    const title = /<title>([^<]*)<\/title>/.exec(xml)?.[1];
    const root = newNode(mintId(), null, (title && unescapeXml(title).trim()) || fallbackTitle);
    nodes.push(root);
    for (const item of items) build(item, root.id);
  }
  return { nodes, skipped };
}

interface OpmlItem {
  text: string;
  note: string;
  children: OpmlItem[];
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** The `<outline>` tree, by a tag scanner that needs no DOM. */
function scanOpml(xml: string): OpmlItem[] {
  const root: OpmlItem = { text: "", note: "", children: [] };
  const stack: OpmlItem[] = [root];
  const tag = /<outline\b([^>]*?)(\/?)>|<\/outline\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(xml))) {
    if (m[0].startsWith("</")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = m[1];
    const text = /\btext="([^"]*)"/i.exec(attrs)?.[1] ?? /\btitle="([^"]*)"/i.exec(attrs)?.[1] ?? "";
    const note = /\b_note="([^"]*)"/i.exec(attrs)?.[1] ?? "";
    const item: OpmlItem = { text: unescapeXml(text), note: unescapeXml(note), children: [] };
    stack[stack.length - 1].children.push(item);
    if (!m[2]) stack.push(item);
  }
  return root.children;
}

/* ── Plain text ───────────────────────────────────────────────────────────── */

/** An indented plain-text outline: tabs per depth, one card per line. */
export function mapToText(map: MindMap): string {
  const root = rootOf(map);
  if (!root) return "";
  const lines: string[] = [root.title.trim() || "Untitled"];
  const walk = (node: MindNode, depth: number) => {
    for (const child of childrenOf(map, node.id)) {
      lines.push(`${"\t".repeat(depth + 1)}${child.title.trim() || "Untitled"}`);
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return lines.join("\n") + "\n";
}

/* ── FreeMind / Freeplane (.mm) ──────────────────────────────────────────── */

/**
 * The `.mm` file FreeMind and Freeplane read and write, and XMind and
 * MindMeister import: nested `<node TEXT="…">` elements under one `<map>`.
 * Notes travel as the `richcontent` element those tools use.
 */
export function mapToFreeMind(map: MindMap): string {
  const root = rootOf(map);
  const nodeXml = (node: MindNode, depth: number): string => {
    const pad = "  ".repeat(depth + 1);
    const kids = childrenOf(map, node.id);
    const note = node.description.trim()
      ? `\n${pad}  <richcontent TYPE="NOTE"><html><body><p>${escapeXml(node.description.trim())}</p></body></html></richcontent>`
      : "";
    const open = `${pad}<node TEXT="${escapeXml(node.title)}" ID="${escapeXml(node.id)}"${node.collapsed ? ' FOLDED="true"' : ""}>`;
    return [open + note, ...kids.map((k) => nodeXml(k, depth + 1)), `${pad}</node>`].join("\n");
  };
  return [`<map version="1.0.1">`, root ? nodeXml(root, 0) : `  <node TEXT="${escapeXml(map.title || "Mindmap")}" />`, `</map>`].join("\n");
}

interface MmItem {
  text: string;
  note: string;
  folded: boolean;
  children: MmItem[];
}

function scanFreeMind(xml: string): MmItem[] {
  const root: MmItem = { text: "", note: "", folded: false, children: [] };
  const stack: MmItem[] = [root];
  const tag = /<node\b([^>]*?)(\/?)>|<\/node\s*>|<richcontent\b[^>]*TYPE="NOTE"[^>]*>([\s\S]*?)<\/richcontent>/gi;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(xml))) {
    if (m[0].startsWith("</")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (m[0].toLowerCase().startsWith("<richcontent")) {
      const current = stack[stack.length - 1];
      if (current !== root) current.note = unescapeXml(m[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      continue;
    }
    const attrs = m[1];
    const text = /\bTEXT="([^"]*)"/i.exec(attrs)?.[1] ?? "";
    const folded = /\bFOLDED="true"/i.test(attrs);
    const item: MmItem = { text: unescapeXml(text), note: "", folded, children: [] };
    stack[stack.length - 1].children.push(item);
    if (!m[2]) stack.push(item);
  }
  return root.children;
}

/** A `.mm` file back to cards: the single top node is the root; several
    become children of a root named for the file. */
export function freeMindToNodes(xml: string, mintId: () => MindNodeId, fallbackTitle = "Imported"): ParsedOutline {
  const items = scanFreeMind(xml);
  const nodes: MindNode[] = [];
  if (items.length === 0) return { nodes: [newNode(mintId(), null, fallbackTitle)], skipped: 1 };
  const build = (item: MmItem, parentId: MindNodeId | null): void => {
    const node = newNode(mintId(), parentId, item.text.trim() || "Untitled");
    if (item.note) node.description = item.note;
    if (item.folded && item.children.length) node.collapsed = true;
    nodes.push(node);
    for (const child of item.children) build(child, node.id);
  };
  if (items.length === 1) build(items[0], null);
  else {
    const rootNode = newNode(mintId(), null, fallbackTitle);
    nodes.push(rootNode);
    for (const item of items) build(item, rootNode.id);
  }
  return { nodes, skipped: 0 };
}

/** Whether a text is a FreeMind file rather than OPML or an outline. */
export function looksLikeFreeMind(text: string): boolean {
  return /<map[\s>]/i.test(text) && /<node\b/i.test(text);
}
