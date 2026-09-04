/**
 * Markdown in and out of a document.
 *
 * Out: the editor's own JSON (ProseMirror) written as the Markdown people
 * expect — ATX headings, `**bold**`, `*italic*`, backtick code, links,
 * nested lists with `-` and `1.`, task lists as `- [ ]`, quotes, fenced
 * code, tables in the pipe form, images, horizontal rules. Blocks this
 * editor has that Markdown does not (callouts, columns, toggles, footnotes)
 * come out as their text, so nothing written is lost.
 *
 * In: the common Markdown subset back to the HTML this editor stores.
 * Kept deliberately small and predictable — a paragraph is a paragraph, a
 * line starting with `#` is a heading — rather than a full CommonMark
 * parser, because what arrives here is notes and READMEs, not the spec's
 * edge cases.
 */

export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

function escapeText(text: string): string {
  return text.replace(/([\\`*_{}[\]#>~|])/g, "\\$1");
}

function inline(nodes: PmNode[] | undefined): string {
  if (!nodes) return "";
  let out = "";
  for (const n of nodes) {
    if (n.type === "text") {
      let t = escapeText(n.text ?? "");
      const marks = n.marks ?? [];
      const has = (name: string) => marks.some((m) => m.type === name);
      if (has("code")) t = "`" + (n.text ?? "").replace(/`/g, "\\`") + "`";
      if (has("bold")) t = `**${t}**`;
      if (has("italic")) t = `*${t}*`;
      if (has("strike")) t = `~~${t}~~`;
      const link = marks.find((m) => m.type === "link");
      if (link && typeof link.attrs?.href === "string") t = `[${t}](${link.attrs.href})`;
      out += t;
    } else if (n.type === "hardBreak") out += "  \n";
    else if (n.type === "image") out += `![${String(n.attrs?.alt ?? "")}](${String(n.attrs?.src ?? "")})`;
    else if (n.type === "mention") out += `@${String(n.attrs?.label ?? n.attrs?.id ?? "")}`;
    else if (n.type === "footnote") out += `[^${String(n.attrs?.text ?? "").slice(0, 40)}]`;
    else if (n.type === "dateChip") out += String(n.attrs?.date ?? "");
    else if (n.type === "dropdownChip") out += String(n.attrs?.value ?? "");
    else if (n.type === "bookmark") out += "";
    else if (n.content) out += inline(n.content);
  }
  return out;
}

function listItems(node: PmNode, ordered: boolean, depth: number): string {
  const lines: string[] = [];
  (node.content ?? []).forEach((item, i) => {
    const indent = "  ".repeat(depth);
    const marker = ordered ? `${i + 1}.` : "-";
    const checked = item.attrs?.checked;
    const box = item.type === "taskItem" ? (checked ? "[x] " : "[ ] ") : "";
    const parts = item.content ?? [];
    const first = parts[0];
    const firstText = first && first.type === "paragraph" ? inline(first.content) : first ? block(first, depth + 1).trim() : "";
    lines.push(`${indent}${marker} ${box}${firstText}`);
    for (const rest of parts.slice(1)) {
      const nested = rest.type === "bulletList" || rest.type === "orderedList" || rest.type === "taskList";
      const text = block(rest, depth + 1).replace(/\n+$/, "");
      if (!text.trim()) continue;
      lines.push(nested ? text : text.replace(/^/gm, "  ".repeat(depth + 1)));
    }
  });
  return lines.join("\n") + "\n";
}

function tableMarkdown(node: PmNode): string {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map((cell) => inline(cell.content?.[0]?.content).replace(/\|/g, "\\|")));
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells: string[]) => "| " + Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ") + " |";
  const out = [line(rows[0]), "| " + Array.from({ length: width }, () => "---").join(" | ") + " |", ...rows.slice(1).map(line)];
  return out.join("\n") + "\n";
}

function block(node: PmNode, depth = 0): string {
  switch (node.type) {
    case "paragraph":
      return inline(node.content) + "\n";
    case "heading":
      return "#".repeat(Math.min(6, Number(node.attrs?.level ?? 1))) + " " + inline(node.content) + "\n";
    case "bulletList":
      return listItems(node, false, depth);
    case "orderedList":
      return listItems(node, true, depth);
    case "taskList":
      return listItems(node, false, depth);
    case "blockquote":
      return (node.content ?? []).map((c) => block(c, depth)).join("").replace(/^/gm, "> ").replace(/> $/gm, ">") + "\n";
    case "codeBlock": {
      const lang = String(node.attrs?.language ?? "");
      return "```" + lang + "\n" + (node.content ?? []).map((c) => c.text ?? "").join("") + "\n```\n";
    }
    case "horizontalRule":
      return "---\n";
    case "pageBreak":
      return "\n";
    case "table":
      return tableMarkdown(node);
    case "image":
      return `![${String(node.attrs?.alt ?? "")}](${String(node.attrs?.src ?? "")})\n`;
    case "callout":
      return (node.content ?? []).map((c) => block(c, depth)).join("").replace(/^/gm, "> ") + "\n";
    case "details":
    case "detailsSummary":
    case "detailsContent":
    case "columns":
    case "column":
      return (node.content ?? []).map((c) => block(c, depth)).join("");
    case "tableOfContents":
      return "";
    case "embed":
    case "youtube":
      return `${String(node.attrs?.src ?? "")}\n`;
    case "attachment":
      return `[${String(node.attrs?.name ?? "Attachment")}](${String(node.attrs?.url ?? "")})\n`;
    case "mathematics":
      return `$${String(node.attrs?.latex ?? "")}$\n`;
    default:
      return node.content ? node.content.map((c) => block(c, depth)).join("") : node.text ? node.text + "\n" : "";
  }
}

/** The document as Markdown. Blank lines separate blocks. */
export function docToMarkdown(doc: PmNode): string {
  const blocks = (doc.content ?? []).map((n) => block(n).replace(/\n+$/, ""));
  return blocks.filter((b) => b !== "").join("\n\n") + "\n";
}

/* ── In ─────────────────────────────────────────────────────────────────── */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Inline Markdown → HTML: code, bold, italic, strike, links, images. */
export function inlineToHtml(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, src: string) => `<img src="${src}" alt="${alt}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => `<a href="${href}">${label}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  s = s.replace(/ {2}$/gm, "<br>");
  return s;
}

/** The common Markdown subset as the HTML this editor stores. */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const listStack: { type: "ul" | "ol"; indent: number; task: boolean }[] = [];
  const closeLists = (toIndent = -1) => {
    while (listStack.length && listStack[listStack.length - 1].indent > toIndent) {
      const l = listStack.pop()!;
      out.push(l.type === "ul" ? "</ul>" : "</ol>");
    }
  };
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inlineToHtml(para.join("\n"))}</p>`);
      para = [];
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      flushPara();
      closeLists();
      i++;
      continue;
    }
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      closeLists();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code${fence[1] ? ` class="language-${fence[1]}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      closeLists();
      out.push(`<h${heading[1].length}>${inlineToHtml(heading[2].trim())}</h${heading[1].length}>`);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      closeLists();
      out.push("<hr>");
      i++;
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushPara();
      closeLists();
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${markdownToHtml(body.join("\n"))}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      flushPara();
      closeLists();
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{3,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      const th = head.map((c) => `<th><p>${inlineToHtml(c)}</p></th>`).join("");
      const tr = body.map((r) => `<tr>${r.map((c) => `<td><p>${inlineToHtml(c)}</p></td>`).join("")}</tr>`).join("");
      out.push(`<table><tbody><tr>${th}</tr>${tr}</tbody></table>`);
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (item) {
      flushPara();
      const indent = item[1].replace(/\t/g, "  ").length;
      const ordered = /\d/.test(item[2]);
      const task = !!item[3];
      const type = ordered ? "ol" : "ul";
      const top = listStack[listStack.length - 1];
      if (!top || top.indent < indent) {
        listStack.push({ type, indent, task });
        out.push(type === "ul" ? (task ? '<ul data-type="taskList">' : "<ul>") : "<ol>");
      } else if (top.indent > indent) {
        closeLists(indent);
      }
      const checked = /\[[xX]\]/.test(item[3] ?? "");
      const li = task
        ? `<li data-type="taskItem" data-checked="${checked}"><p>${inlineToHtml(item[4])}</p></li>`
        : `<li><p>${inlineToHtml(item[4])}</p></li>`;
      out.push(li);
      i++;
      continue;
    }
    if (listStack.length && /^\s{2,}\S/.test(line)) {
      /* A continuation line inside a list item joins the previous item. */
      const last = out.length - 1;
      out[last] = out[last].replace(/<\/p><\/li>$/, ` ${inlineToHtml(line.trim())}</p></li>`);
      i++;
      continue;
    }
    closeLists();
    para.push(line);
    i++;
  }
  flushPara();
  closeLists();
  return out.join("");
}

/** A title for an imported Markdown file: its first heading, else the name. */
export function markdownTitle(md: string, fallback: string): string {
  const m = /^#\s+(.+)$/m.exec(md);
  return m ? m[1].trim().slice(0, 120) : fallback;
}
