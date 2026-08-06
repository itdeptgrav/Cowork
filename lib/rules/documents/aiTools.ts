/**
 * Turning what Gemini proposed into something safe to apply to a document —
 * or refusing it.
 *
 * ## Why this exists as a second validator, separate from the backend's
 *
 * The backend (`grav-cms-backend/services/aiAssist.service.js`) declares
 * these ten tools to Gemini and re-checks that the tool name is one it
 * knows. It does not, and should not, know anything about Tiptap — it has
 * no editor, no document. This module is the other half: given the raw
 * `{ tool, args }` the backend forwarded, decide whether the arguments are a
 * shape this editor can actually execute, and turn them into a typed
 * `DocsAiAction` the executor can run without re-checking anything. A
 * network response is untrusted input regardless of which server sent it —
 * the backend could be wrong about what it forwarded, or a future backend
 * change could add a field this version does not expect.
 *
 * Every reader on `args` is defensive (`typeof` checks, no assumed shape)
 * for exactly that reason.
 */

import {
  parseAlign,
  parseFontSize,
  parseHexColor,
  type BlockAlign,
} from "./richText.ts";

const MAX_TEXT_LENGTH = 20_000;
const MAX_BLOCKS = 200;
const MAX_LIST_ITEMS = 200;
const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLS = 20;
const MAX_COMMENT_QUOTE_LENGTH = 2_000;
const MAX_COMMENT_TEXT_LENGTH = 2_000;

/**
 * Styling any text block may carry.
 *
 * Deliberately a small set. A document assistant that can set arbitrary CSS
 * produces documents nobody can maintain and that print unpredictably; these
 * four are what actually distinguish a laid-out letter from a wall of text —
 * where a line sits, how big it is, and what colour it is.
 */
export interface BlockStyleAttrs {
  align?: BlockAlign;
  /** Hex only — validated, never passed through raw. See `richText.ts`. */
  color?: string;
  /** Points. */
  size?: number;
}

/** One element of a whole-document body. See `insert_blocks`. */
export type DocsBlock =
  | ({ type: "heading"; text: string; level: 1 | 2 | 3 | 4 } & BlockStyleAttrs)
  | ({ type: "paragraph"; text: string } & BlockStyleAttrs)
  | { type: "bullets"; items: string[] }
  | { type: "numbered"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | ({ type: "quote"; text: string } & BlockStyleAttrs)
  | { type: "divider" };

export type DocsAiAction =
  | { tool: "insert_blocks"; blocks: DocsBlock[] }
  | { tool: "insert_text"; text: string }
  | { tool: "replace_selection"; text: string }
  | { tool: "create_heading"; text: string; level: 1 | 2 | 3 | 4 }
  | { tool: "create_paragraph"; text: string }
  | { tool: "create_bullet_list"; items: string[] }
  | { tool: "create_numbered_list"; items: string[] }
  | { tool: "create_table"; headers: string[]; rows: string[][] }
  | { tool: "format_text"; bold?: boolean; italic?: boolean; underline?: boolean }
  | { tool: "insert_page_break" }
  /**
   * `quote` is the exact text the comment is about — the model's only way to
   * point at a location, since it has no notion of a document position. The
   * caller (`DocsAssistant.tsx`) searches the live document for `quote` and
   * refuses the action if it isn't found verbatim, rather than guessing a
   * nearby range — a comment anchored to the wrong sentence is worse than no
   * comment at all.
   */
  | { tool: "add_comment"; quote: string; text: string };

function str(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  return typeof v === "string" ? v : null;
}

function strArray(args: Record<string, unknown>, key: string): string[] | null {
  const v = args[key];
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === "string")) return null;
  return v as string[];
}

/**
 * Validate one tool call against its Docs shape.
 *
 * Returns the typed action, or a message meant to be shown to the user —
 * never a thrown error, because a malformed model response is an expected
 * outcome to design for, not an exceptional one.
 */
export function validateDocsToolCall(
  tool: string,
  args: Record<string, unknown>,
): { ok: true; action: DocsAiAction } | { ok: false; message: string } {
  switch (tool) {
    case "insert_blocks": {
      const raw = args["blocks"];
      if (!Array.isArray(raw) || raw.length === 0)
        return { ok: false, message: "The assistant returned an empty document." };
      if (raw.length > MAX_BLOCKS)
        return { ok: false, message: `That document is too long (over ${MAX_BLOCKS} blocks).` };

      const blocks: DocsBlock[] = [];
      let totalText = 0;
      for (const entry of raw) {
        if (!entry || typeof entry !== "object")
          return { ok: false, message: "The assistant returned a malformed block." };
        const b = entry as Record<string, unknown>;
        const type = b["type"];
        const text = typeof b["text"] === "string" ? (b["text"] as string) : "";
        totalText += text.length;
        if (totalText > MAX_TEXT_LENGTH)
          return { ok: false, message: "That document is too long to insert safely." };

        /* Every styling attribute is parsed, never trusted: an unrecognised
           alignment, a non-hex colour or an illegible size is dropped and the
           block keeps the document's own defaults, rather than the whole
           document being refused over a cosmetic field. */
        const style: BlockStyleAttrs = {};
        const align = parseAlign(b["align"]);
        const color = parseHexColor(b["color"]);
        const size = parseFontSize(b["size"]);
        if (align) style.align = align;
        if (color) style.color = color;
        if (size) style.size = size;

        if (type === "heading") {
          const level = typeof b["level"] === "number" ? Math.round(b["level"] as number) : 1;
          if (!text.trim()) return { ok: false, message: "The assistant returned a heading with no text." };
          /* Clamped rather than refused: an out-of-range heading level is a
             cosmetic slip in an otherwise good document, and throwing the
             whole page away over it would be the wrong trade. */
          const safe = Math.min(4, Math.max(1, level)) as 1 | 2 | 3 | 4;
          blocks.push({ type: "heading", text, level: safe, ...style });
        } else if (type === "paragraph") {
          if (!text.trim()) continue; /* A blank paragraph is spacing, not content — drop it. */
          blocks.push({ type: "paragraph", text, ...style });
        } else if (type === "quote") {
          if (!text.trim()) continue;
          blocks.push({ type: "quote", text, ...style });
        } else if (type === "divider") {
          blocks.push({ type: "divider" });
        } else if (type === "bullets" || type === "numbered") {
          const items = strArray(b, "items")?.filter((i) => i.trim()) ?? [];
          if (items.length === 0) continue;
          if (items.length > MAX_LIST_ITEMS)
            return { ok: false, message: `A list in that document is too long (over ${MAX_LIST_ITEMS} items).` };
          blocks.push({ type, items });
        } else if (type === "table") {
          const headers = strArray(b, "headers");
          const rowsRaw = b["rows"];
          if (!headers || headers.length === 0 || !Array.isArray(rowsRaw))
            return { ok: false, message: "The assistant returned a malformed table." };
          if (headers.length > MAX_TABLE_COLS || rowsRaw.length > MAX_TABLE_ROWS)
            return { ok: false, message: "A table in that document is too large." };
          const rows: string[][] = [];
          for (const row of rowsRaw) {
            if (!Array.isArray(row) || !row.every((c) => typeof c === "string"))
              return { ok: false, message: "The assistant returned a malformed table row." };
            /* Padded/trimmed rather than refused — a ragged row in an
               otherwise usable table is worth fixing, not discarding. */
            const cells = (row as string[]).slice(0, headers.length);
            while (cells.length < headers.length) cells.push("");
            rows.push(cells);
          }
          blocks.push({ type: "table", headers, rows });
        } else {
          return { ok: false, message: `The assistant returned an unknown block type (${String(type)}).` };
        }
      }

      if (blocks.length === 0)
        return { ok: false, message: "The assistant returned a document with nothing in it." };
      return { ok: true, action: { tool: "insert_blocks", blocks } };
    }

    case "insert_text":
    case "replace_selection":
    case "create_paragraph": {
      const text = str(args, "text");
      if (!text || !text.trim()) return { ok: false, message: "The assistant returned no text." };
      if (text.length > MAX_TEXT_LENGTH)
        return { ok: false, message: "That reply is too long to insert safely." };
      return { ok: true, action: { tool, text } as DocsAiAction };
    }

    case "create_heading": {
      const text = str(args, "text");
      const levelRaw = args["level"];
      const level = typeof levelRaw === "number" ? Math.round(levelRaw) : NaN;
      if (!text || !text.trim())
        return { ok: false, message: "The assistant returned a heading with no text." };
      if (!(level >= 1 && level <= 4))
        return { ok: false, message: "The assistant proposed an invalid heading level." };
      return { ok: true, action: { tool: "create_heading", text, level: level as 1 | 2 | 3 | 4 } };
    }

    case "create_bullet_list":
    case "create_numbered_list": {
      const items = strArray(args, "items");
      if (!items || items.length === 0)
        return { ok: false, message: "The assistant returned an empty list." };
      if (items.some((i) => !i.trim()))
        return { ok: false, message: "The assistant returned a blank list item." };
      if (items.length > MAX_LIST_ITEMS)
        return { ok: false, message: `That list is too long (over ${MAX_LIST_ITEMS} items).` };
      return { ok: true, action: { tool, items } as DocsAiAction };
    }

    case "create_table": {
      const headers = strArray(args, "headers");
      const rowsRaw = args["rows"];
      if (!headers || headers.length === 0)
        return { ok: false, message: "The assistant returned a table with no headers." };
      if (headers.length > MAX_TABLE_COLS)
        return { ok: false, message: `That table is too wide (over ${MAX_TABLE_COLS} columns).` };
      if (!Array.isArray(rowsRaw))
        return { ok: false, message: "The assistant returned a table with no rows." };
      if (rowsRaw.length > MAX_TABLE_ROWS)
        return { ok: false, message: `That table is too tall (over ${MAX_TABLE_ROWS} rows).` };
      const rows: string[][] = [];
      for (const row of rowsRaw) {
        if (!Array.isArray(row) || !row.every((c) => typeof c === "string"))
          return { ok: false, message: "The assistant returned a malformed table row." };
        if (row.length !== headers.length)
          return {
            ok: false,
            message: "The assistant returned a table where a row doesn't match the header count.",
          };
        rows.push(row as string[]);
      }
      return { ok: true, action: { tool: "create_table", headers, rows } };
    }

    case "format_text": {
      const bold = typeof args["bold"] === "boolean" ? (args["bold"] as boolean) : undefined;
      const italic = typeof args["italic"] === "boolean" ? (args["italic"] as boolean) : undefined;
      const underline =
        typeof args["underline"] === "boolean" ? (args["underline"] as boolean) : undefined;
      if (bold === undefined && italic === undefined && underline === undefined)
        return { ok: false, message: "The assistant proposed a formatting change with nothing to apply." };
      return { ok: true, action: { tool: "format_text", bold, italic, underline } };
    }

    case "insert_page_break":
      return { ok: true, action: { tool: "insert_page_break" } };

    case "add_comment": {
      const quote = str(args, "quote");
      const text = str(args, "text");
      if (!quote || !quote.trim())
        return { ok: false, message: "The assistant didn't say what text to comment on." };
      if (!text || !text.trim())
        return { ok: false, message: "The assistant returned an empty comment." };
      if (quote.length > MAX_COMMENT_QUOTE_LENGTH || text.length > MAX_COMMENT_TEXT_LENGTH)
        return { ok: false, message: "That comment is too long." };
      return { ok: true, action: { tool: "add_comment", quote, text } };
    }

    default:
      return { ok: false, message: `The assistant proposed an action this editor doesn't support (${tool}).` };
  }
}

/**
 * Does applying this action need an explicit confirmation first, rather than
 * a straight Apply?
 *
 * Additive actions (inserting new content, adding a heading) never need one
 * — the worst case is an unwanted paragraph, trivially undone. Replacing a
 * large selection does, because it can discard a meaningful amount of
 * somebody's own writing in one step.
 */
export function docsActionRequiresConfirmation(
  action: DocsAiAction,
  selectionLength: number,
): boolean {
  if (action.tool !== "replace_selection") return false;
  /* A short selection replaced with a short correction (typical grammar/tone
     fixes) is exactly what "rewrite" is for and doesn't need a gate; a large
     replacement is functionally a delete-and-rewrite of real content. */
  const LARGE_SELECTION_CHARS = 400;
  return selectionLength > LARGE_SELECTION_CHARS;
}
