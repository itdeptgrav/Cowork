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

const MAX_TEXT_LENGTH = 20_000;
const MAX_LIST_ITEMS = 200;
const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLS = 20;

export type DocsAiAction =
  | { tool: "insert_text"; text: string }
  | { tool: "replace_selection"; text: string }
  | { tool: "create_heading"; text: string; level: 1 | 2 | 3 | 4 }
  | { tool: "create_paragraph"; text: string }
  | { tool: "create_bullet_list"; items: string[] }
  | { tool: "create_numbered_list"; items: string[] }
  | { tool: "create_table"; headers: string[]; rows: string[][] }
  | { tool: "format_text"; bold?: boolean; italic?: boolean; underline?: boolean }
  | { tool: "insert_page_break" };

/**
 * `add_comment` is deliberately not in {@link DocsAiAction}.
 *
 * It is declared to Gemini — see the backend's tool list — so the model can
 * recognise "add a comment saying..." as a real request rather than
 * hallucinating a different tool for it. But there is no comment layer in
 * this editor (`DocumentEditor.tsx`'s own header comment: "There are no
 * comments... because there is no comment store"), so every `add_comment`
 * call is refused here, with the same honesty the rest of the product
 * applies to unimplemented features — a control that pretends to work is
 * worse than one that says plainly it does not exist yet.
 */
const UNSUPPORTED_TOOLS = new Set(["add_comment"]);

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
  if (UNSUPPORTED_TOOLS.has(tool)) {
    return {
      ok: false,
      message: "Comments aren't available in Cowork's document editor yet.",
    };
  }

  switch (tool) {
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
