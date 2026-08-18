/**
 * Exporting the document to Word.
 *
 * **Walked from the live editor DOM rather than from the stored HTML.** The
 * editor is what the writer is looking at: an image the writer resized is that
 * size on screen because of a style attribute, a heading is a heading because
 * of the node it is in, and the surrounding page decides how wide "100%" is.
 * Reading the DOM means the exported file matches what was on the screen,
 * which is the only definition of correct anybody applies to an export.
 *
 * The XML and the archive are built by `lib/rules/documents/docx.ts`, which is
 * pure and tested on its own. This file is only the walk — what a `<strong>`
 * means, how wide a picture is, which relationship id a link gets.
 */

import {
  buildDocx,
  docxImageExt,
  hyperlinkXml,
  imageRunXml,
  paragraphXml,
  runXml,
  tableXml,
  HORIZONTAL_RULE_XML,
  type DocxCell,
  type DocxPage,
  type DocxParagraphFormat,
  type DocxRel,
  type DocxRunFormat,
} from "@/lib/rules/documents/docx";
import { isSafeHref } from "@/lib/rules/documents/linkTools";
import { sniffImageMime } from "@/lib/rules/media/imageBytes";

export interface DocxExportInput {
  /** The live page element — what the writer is looking at. */
  page: HTMLElement;
  title: string;
  fileName: string;
  widthIn: number;
  heightIn: number;
  marginTopIn: number;
  marginRightIn: number;
  marginBottomIn: number;
  marginLeftIn: number;
}

export type DocxExportResult =
  | { ok: true; skippedImages: number }
  | { ok: false; message: string };

const PX_PER_IN = 96;

/** A colour from the DOM, as the six hex digits Word wants, or undefined. */
function hexColor(input: string | null | undefined): string | undefined {
  const raw = String(input ?? "").trim();
  if (!raw || raw === "transparent" || raw === "inherit") return undefined;

  const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1]!.split(",").map((n) => parseFloat(n.trim()));
    /* A fully transparent colour is no colour — writing it as black would
       turn an unhighlighted word into a black block. */
    if (parts.length >= 4 && parts[3] === 0) return undefined;
    const [r, g, b] = parts;
    if ([r, g, b].some((n) => n === undefined || Number.isNaN(n))) return undefined;
    return [r!, g!, b!]
      .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }

  const hex = raw.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return undefined;
  const digits = hex[1]!;
  const full =
    digits.length === 3
      ? digits.split("").map((d) => d + d).join("")
      : digits;
  return full.toUpperCase();
}

/** Black text is the default, so writing it adds noise and nothing else. */
const meaningfulColor = (hex: string | undefined) =>
  hex && hex !== "000000".toUpperCase() ? hex : undefined;

/**
 * The formatting of one text node, read from the elements above it.
 *
 * Read from tag names AND computed style, because both carry it: `<strong>`
 * says bold structurally, while the toolbar's colour and font-size arrive only
 * as inline style.
 */
function formatAt(node: Node, root: HTMLElement): DocxRunFormat {
  const format: DocxRunFormat = {};
  let el = node.parentElement;

  while (el && el !== root.parentElement) {
    const tag = el.tagName.toLowerCase();
    if (tag === "strong" || tag === "b") format.bold = true;
    if (tag === "em" || tag === "i") format.italic = true;
    if (tag === "u") format.underline = true;
    if (tag === "s" || tag === "strike" || tag === "del") format.strike = true;
    if (tag === "sup") format.superscript = true;
    if (tag === "sub") format.subscript = true;
    if (tag === "code" || tag === "pre") format.font ??= "Consolas";
    if (tag === "mark") {
      format.highlight ??= hexColor(getComputedStyle(el).backgroundColor) ?? "FFFF00";
    }
    if (tag === "a") format.link = true;

    const style = el.style;
    if (style?.fontWeight && Number(style.fontWeight) >= 600) format.bold = true;
    if (style?.fontWeight === "bold") format.bold = true;
    if (style?.color) format.color ??= meaningfulColor(hexColor(style.color));
    if (style?.backgroundColor) {
      format.highlight ??= hexColor(style.backgroundColor);
    }
    if (style?.fontFamily) {
      format.font ??= style.fontFamily.split(",")[0]!.replace(/["']/g, "").trim();
    }
    if (style?.fontSize?.endsWith("pt")) {
      format.sizePt ??= parseFloat(style.fontSize);
    } else if (style?.fontSize?.endsWith("px")) {
      format.sizePt ??= parseFloat(style.fontSize) * 0.75;
    }

    el = el.parentElement;
  }
  return format;
}

/** The nearest ancestor `<a href>`, if the text sits inside a link. */
function linkAt(node: Node, root: HTMLElement): string | null {
  let el = node.parentElement;
  while (el && el !== root.parentElement) {
    if (el.tagName.toLowerCase() === "a") {
      const href = el.getAttribute("href");
      return isSafeHref(href) ? href : null;
    }
    el = el.parentElement;
  }
  return null;
}

/** State threaded through the walk — relationship ids are allocated in order. */
interface WalkState {
  rels: DocxRel[];
  media: { name: string; data: Uint8Array }[];
  /** Pictures that could not be fetched, reported back to the caller. */
  skipped: number;
  nextRel: number;
  nextPicture: number;
  root: HTMLElement;
  contentWidthPx: number;
}

const relId = (state: WalkState) => `rId${100 + state.nextRel++}`;

/**
 * The inline content of one block element, as Word runs.
 *
 * Links are collected as they are met rather than up front, because the same
 * address used twice gets two relationship ids and that is fine — deduplicating
 * them would save a few bytes and add a lookup that can go wrong.
 */
async function runsFor(block: HTMLElement, state: WalkState): Promise<string> {
  const parts: string[] = [];

  const walk = async (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (!text) return;
      const href = linkAt(node, state.root);
      const run = runXml(text, formatAt(node, state.root));
      parts.push(
        href
          ? hyperlinkXml(
              (() => {
                const id = relId(state);
                state.rels.push({ id, kind: "hyperlink", target: href });
                return id;
              })(),
              run,
            )
          : run,
      );
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === "br") {
      /* ProseMirror puts a placeholder `<br>` inside every empty paragraph so
         the caret has somewhere to sit. It is chrome, not content — exporting
         it turns each empty paragraph and each empty table cell into a blank
         line the writer never typed. */
      if (el.classList.contains("ProseMirror-trailingBreak")) return;
      parts.push(runXml("\n"));
      return;
    }
    if (tag === "img") {
      const run = await imageRun(el as HTMLImageElement, state);
      if (run) parts.push(run);
      return;
    }
    /* An unchecked task item still needs its box to survive as something. */
    if (tag === "input" && (el as HTMLInputElement).type === "checkbox") {
      parts.push(runXml((el as HTMLInputElement).checked ? "☑ " : "☐ "));
      return;
    }

    for (const child of Array.from(el.childNodes)) await walk(child);
  };

  for (const child of Array.from(block.childNodes)) await walk(child);
  return parts.join("");
}

/**
 * One picture, fetched and embedded.
 *
 * **A picture that cannot be fetched is skipped, not fatal.** The images live
 * on Drive and are drawn through a CDN that need not allow a cross-origin
 * read; the export is still worth having without one, and the count of what
 * was left out is reported so the writer is told rather than left to notice.
 *
 * The size is the size on screen — `getBoundingClientRect`, not the file's
 * natural size — because that is what the writer set with the resize grips.
 */
async function imageRun(
  img: HTMLImageElement,
  state: WalkState,
): Promise<string | null> {
  const rect = img.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || img.width || 200));
  const height = Math.max(1, Math.round(rect.height || img.height || 150));

  let blob: Blob;
  try {
    const response = await fetch(img.currentSrc || img.src, { mode: "cors" });
    if (!response.ok) throw new Error(String(response.status));
    blob = await response.blob();
  } catch {
    state.skipped++;
    return null;
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());

  /* The BYTES decide, not the header. A static file server labels a PNG
     `application/octet-stream` by default and a streaming proxy does the same,
     and dropping a picture the browser has already drawn because a header was
     vague is the worst kind of failure — plainly on the screen, plainly not in
     the file. See `sniffImageMime`. */
  const mime = sniffImageMime(bytes, blob.type);
  if (!mime) {
    state.skipped++;
    return null;
  }

  const ext = docxImageExt(mime);
  const name = `image${state.nextPicture}.${ext}`;
  const id = relId(state);
  state.media.push({ name, data: bytes });
  state.rels.push({ id, kind: "image", target: `media/${name}` });

  return imageRunXml(
    id,
    Math.min(width, state.contentWidthPx),
    Math.min(width, state.contentWidthPx) === width
      ? height
      : Math.round((height * state.contentWidthPx) / width),
    img.getAttribute("alt") ?? "",
    state.nextPicture++,
  );
}

/** The alignment on a block, from its class or its computed style. */
function alignOf(el: HTMLElement): DocxParagraphFormat["align"] {
  const value = (el.style.textAlign || getComputedStyle(el).textAlign || "").toLowerCase();
  if (value === "center") return "center";
  if (value === "right" || value === "end") return "right";
  if (value === "justify") return "justify";
  return "left";
}

/** How deeply a list item is nested. */
function listDepth(el: HTMLElement, root: HTMLElement): number {
  let depth = -1;
  let node: HTMLElement | null = el;
  while (node && node !== root.parentElement) {
    const tag = node.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") depth++;
    node = node.parentElement;
  }
  return Math.max(0, depth);
}

/** Every block in the document, in order, as Word paragraphs and tables. */
async function blocksFor(container: HTMLElement, state: WalkState): Promise<string> {
  const out: string[] = [];

  const walk = async (el: HTMLElement) => {
    const tag = el.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      out.push(
        paragraphXml(await runsFor(el, state), {
          heading: Number(tag[1]),
          align: alignOf(el),
        }),
      );
      return;
    }

    if (tag === "p") {
      const runs = await runsFor(el, state);
      const quoted = el.closest("blockquote");
      out.push(
        paragraphXml(runs, {
          align: alignOf(el),
          style: quoted ? "Quote" : undefined,
        }),
      );
      return;
    }

    if (tag === "li") {
      const ordered = el.closest("ol") !== null;
      const task = el.getAttribute("data-checked") !== null ||
        el.querySelector(":scope > label > input[type=checkbox]") !== null;

      /* A list item's own text is its first paragraph; nested lists inside it
         are walked after, so they become their own items at a deeper level
         rather than being flattened into this one's text. */
      const inline = document.createElement("div");
      for (const child of Array.from(el.childNodes)) {
        const childTag =
          child.nodeType === Node.ELEMENT_NODE
            ? (child as HTMLElement).tagName.toLowerCase()
            : "";
        if (childTag !== "ul" && childTag !== "ol") inline.appendChild(child.cloneNode(true));
      }
      out.push(
        paragraphXml(await runsFor(inline, state), {
          list: ordered ? "number" : "bullet",
          level: listDepth(el, state.root),
          align: alignOf(el),
        }),
      );
      if (task) {
        /* A checklist keeps its box: the marker above is a bullet, and the
           state of the box is what the item is actually about. */
      }
      for (const child of Array.from(el.children)) {
        const childTag = child.tagName.toLowerCase();
        if (childTag === "ul" || childTag === "ol") await walk(child as HTMLElement);
      }
      return;
    }

    if (tag === "ul" || tag === "ol") {
      for (const child of Array.from(el.children)) await walk(child as HTMLElement);
      return;
    }

    if (tag === "table") {
      const rows: DocxCell[][] = [];
      for (const tr of Array.from(el.querySelectorAll("tr"))) {
        const cells: DocxCell[] = [];
        for (const td of Array.from(tr.children)) {
          const cell = td as HTMLElement;
          const inner: string[] = [];
          const blocks = cell.querySelectorAll(":scope > p, :scope > h1, :scope > h2, :scope > h3");
          if (blocks.length) {
            for (const block of Array.from(blocks)) {
              inner.push(paragraphXml(await runsFor(block as HTMLElement, state)));
            }
          } else {
            inner.push(paragraphXml(await runsFor(cell, state)));
          }
          cells.push({
            content: inner.join(""),
            header: cell.tagName.toLowerCase() === "th",
          });
        }
        rows.push(cells);
      }
      if (rows.length) out.push(tableXml(rows, state.contentWidthPx));
      return;
    }

    if (tag === "hr") {
      out.push(HORIZONTAL_RULE_XML);
      return;
    }

    if (tag === "pre") {
      out.push(paragraphXml(await runsFor(el, state), { style: "Code" }));
      return;
    }

    if (el.getAttribute("data-page-break") !== null || el.classList.contains("page-break")) {
      out.push(paragraphXml("", { pageBreakBefore: true }));
      return;
    }

    if (tag === "img") {
      const run = await imageRun(el as HTMLImageElement, state);
      out.push(paragraphXml(run ?? "", { align: alignOf(el) }));
      return;
    }

    for (const child of Array.from(el.children)) await walk(child as HTMLElement);
  };

  for (const child of Array.from(container.children)) await walk(child as HTMLElement);

  /* Word requires at least one paragraph; an empty document is an empty page,
     not a file that fails to open. */
  return out.length ? out.join("") : paragraphXml("");
}

/**
 * Export the document as a `.docx` and hand it to the browser.
 *
 * Never throws: a failed export reports its reason so the caller can show it,
 * because an export that silently does nothing is the one people retry three
 * times before giving up.
 */
export async function exportDocumentDocx(
  input: DocxExportInput,
): Promise<DocxExportResult> {
  try {
    const content =
      input.page.querySelector<HTMLElement>(".ProseMirror") ?? input.page;

    const page: DocxPage = {
      widthPx: input.widthIn * PX_PER_IN,
      heightPx: input.heightIn * PX_PER_IN,
      marginTopPx: input.marginTopIn * PX_PER_IN,
      marginRightPx: input.marginRightIn * PX_PER_IN,
      marginBottomPx: input.marginBottomIn * PX_PER_IN,
      marginLeftPx: input.marginLeftIn * PX_PER_IN,
      landscape: input.widthIn > input.heightIn,
    };

    const state: WalkState = {
      rels: [],
      media: [],
      skipped: 0,
      nextRel: 1,
      nextPicture: 1,
      root: content,
      contentWidthPx: Math.max(
        100,
        page.widthPx - page.marginLeftPx - page.marginRightPx,
      ),
    };

    const body = await blocksFor(content, state);
    const bytes = buildDocx({
      documentBody: body,
      page,
      rels: state.rels,
      media: state.media,
    });

    const blob = new Blob([bytes as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${input.fileName}.docx`;
    anchor.click();
    URL.revokeObjectURL(url);

    return { ok: true, skippedImages: state.skipped };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? `The document could not be exported: ${e.message}`
          : "The document could not be exported.",
    };
  }
}
