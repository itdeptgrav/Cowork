"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import type * as Y from "yjs";
import { AssistantPanel } from "./AssistantPanel";
import { DiffPreview } from "./DiffPreview";
import { buildDocsContext, requestsWholeDocument } from "@/lib/rules/documents/aiContext";
import { docsActionRequiresConfirmation, validateDocsToolCall, type DocsAiAction } from "@/lib/rules/documents/aiTools";
import { parseInline } from "@/lib/rules/documents/richText";
import { flattenDocument, positionOf } from "@/lib/documents/searchText";
import { findMatches } from "@/lib/rules/documents/find";
import { addCommentThread } from "@/lib/documents/commentsStore";

/**
 * The Docs executor.
 *
 * The only file in this feature that both reads Tiptap's selection AND
 * issues Tiptap commands. `AssistantPanel` never sees the editor; it sees
 * three callbacks this component closes over. That boundary is what makes
 * "Gemini must never directly mutate a document" true in the code, not just
 * in a comment: `validate` only classifies and describes, `apply` is the one
 * function in this whole feature that calls `editor.chain()...run()`, and it
 * only ever runs on an action this same file already validated.
 */

const SUGGESTED_ACTIONS = [
  { label: "Rewrite for clarity", instruction: "Rewrite the selected text to be clearer and more concise." },
  { label: "Fix grammar", instruction: "Fix the grammar and spelling in the selected text without changing its meaning." },
  { label: "Shorten", instruction: "Shorten the selected text while keeping its meaning." },
  { label: "Expand", instruction: "Expand the selected text with more detail." },
  { label: "Make it more formal", instruction: "Rewrite the selected text in a more formal, professional tone." },
  { label: "Summarize", instruction: "Summarize the selected text in a short paragraph." },
  { label: "Continue writing", instruction: "Continue writing from where the cursor is, in the same voice as the surrounding text." },
  { label: "Turn into bullet points", instruction: "Convert the selected text into a bulleted list." },
  { label: "Extract action items", instruction: "Extract the action items from the selected text as a bulleted list." },
  { label: "Suggest a title", instruction: "Suggest a short, clear title for this document as a heading." },
  { label: "Build an outline", instruction: "Propose a heading for the next section, based on the document so far." },
];

export function DocsAssistant({
  editor,
  doc,
  me,
  onClose,
}: {
  editor: Editor;
  /** The document's live Yjs room, or null — `add_comment` needs it to have
      somewhere to write the thread; every other tool works without it. */
  doc: Y.Doc | null;
  me: { id: string; displayName: string } | null;
  onClose: () => void;
}) {
  /* Re-renders only when the selection actually changes — the same pattern
     the toolbar and menu bar use, so typing elsewhere in the document costs
     this panel nothing. */
  const selection = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { from, to } = e.state.selection;
      const text = from === to ? "" : e.state.doc.textBetween(from, to, "\n", " ");
      const precedingFrom = Math.max(0, from - 400);
      const preceding = e.state.doc.textBetween(precedingFrom, from, "\n", " ");
      const headings: string[] = [];
      e.state.doc.descendants((node) => {
        if (node.type.name === "heading") headings.push(node.textContent);
        return true;
      });
      return { from, to, text, preceding, headings };
    },
  });

  const contextLabel = selection.text
    ? `Selected: ${selection.text.length} characters`
    : "Nothing selected — writing from the cursor";

  function buildPreview(action: DocsAiAction): React.ReactNode {
    switch (action.tool) {
      case "insert_blocks":
        /* The whole body, laid out the way it will land — this is the one
           proposal a person genuinely has to read before accepting, so it
           gets rendered rather than summarised as "12 blocks". */
        return (
          <div className="flex flex-col gap-1.5">
            {action.blocks.map((b, i) => {
              if (b.type === "divider")
                return <hr key={i} className="my-1 border-0 border-t border-hairline" />;

              if (b.type === "bullets" || b.type === "numbered")
                return (
                  <ul
                    key={i}
                    className={`space-y-0.5 pl-4 text-[12px] text-ink-muted ${
                      b.type === "bullets" ? "list-disc" : "list-decimal"
                    }`}
                  >
                    {b.items.map((item, j) => (
                      <li key={j}>
                        <Marked text={item} />
                      </li>
                    ))}
                  </ul>
                );

              if (b.type === "table")
                return (
                  <table key={i} className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr>
                        {b.headers.map((h, j) => (
                          <th key={j} className="border border-hairline px-1.5 py-1 text-left font-medium text-ink">
                            <Marked text={h} />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {b.rows.map((row, j) => (
                        <tr key={j}>
                          {row.map((cell, k) => (
                            <td key={k} className="border border-hairline px-1.5 py-1 text-ink-muted">
                              <Marked text={cell} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );

              /* The preview carries the same alignment, colour and size the
                 document will — a preview that showed everything flush-left
                 in default ink would be approving one thing and applying
                 another. */
              const style: React.CSSProperties = {
                textAlign: b.align,
                color: b.color,
                fontSize: b.size ? `${Math.min(b.size, 20)}px` : undefined,
              };

              if (b.type === "heading")
                return (
                  <p
                    key={i}
                    style={style}
                    className={`font-medium ${b.color ? "" : "text-ink"} ${
                      b.level === 1 ? "text-[14px]" : "text-[12.5px]"
                    }`}
                  >
                    <Marked text={b.text} />
                  </p>
                );

              if (b.type === "quote")
                return (
                  <p
                    key={i}
                    style={style}
                    className={`border-s-2 border-hairline ps-2 text-[12px] leading-relaxed italic ${
                      b.color ? "" : "text-ink-muted"
                    }`}
                  >
                    <Marked text={b.text} />
                  </p>
                );

              return (
                <p
                  key={i}
                  style={style}
                  className={`text-[12px] leading-relaxed ${b.color ? "" : "text-ink-muted"}`}
                >
                  <Marked text={b.text} />
                </p>
              );
            })}
          </div>
        );
      case "replace_selection":
        return <DiffPreview before={selection.text} after={action.text} />;
      case "insert_text":
      case "create_paragraph":
        return <p className="whitespace-pre-wrap text-ink">{action.text}</p>;
      case "create_heading":
        return (
          <p className="font-medium text-ink">
            {"#".repeat(action.level)} {action.text}
          </p>
        );
      case "create_bullet_list":
      case "create_numbered_list":
        return (
          <ul className="list-disc space-y-0.5 pl-4 text-ink">
            {action.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        );
      case "create_table":
        return (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr>
                  {action.headers.map((h, i) => (
                    <th key={i} className="border border-hairline px-1.5 py-1 text-left font-medium text-ink">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {action.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className="border border-hairline px-1.5 py-1 text-ink-muted">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "format_text": {
        const parts = [
          action.bold !== undefined && (action.bold ? "bold on" : "bold off"),
          action.italic !== undefined && (action.italic ? "italic on" : "italic off"),
          action.underline !== undefined && (action.underline ? "underline on" : "underline off"),
        ].filter(Boolean);
        return <p className="text-ink-muted">Formatting: {parts.join(", ")}</p>;
      }
      case "insert_page_break":
        return <p className="text-ink-muted">A page break at the cursor.</p>;
      case "add_comment":
        return (
          <div className="flex flex-col gap-1">
            <p className="truncate rounded-inset bg-[var(--surface-sunken)] px-2 py-1 text-[11px] text-ink-faint">
              &ldquo;{action.quote}&rdquo;
            </p>
            <p className="text-ink">{action.text}</p>
          </div>
        );
    }
  }

  return (
    <AssistantPanel<DocsAiAction>
      surface="docs"
      surfaceLabel="Document"
      placeholder="Rewrite, summarize, translate, or 'continue writing'…"
      suggestedActions={SUGGESTED_ACTIONS}
      contextLabel={contextLabel}
      getContextSummary={(instruction) =>
        buildDocsContext({
          selectionText: selection.text,
          precedingText: selection.preceding,
          headings: selection.headings,
          /* Only when THIS instruction plainly asked for the whole
             document — never assumed, never left on from a previous turn. */
          wholeDocumentText: requestsWholeDocument(instruction)
            ? editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " ")
            : undefined,
        })
      }
      validate={(tool, args) => {
        const result = validateDocsToolCall(tool, args);
        if (!result.ok) return result;
        if (result.action.tool === "add_comment") {
          if (!doc || !me)
            return {
              ok: false,
              message: "Comments need a live connection to this document, which isn't up right now.",
            };
          if (!findQuoteRange(editor, result.action.quote))
            return {
              ok: false,
              message: "Couldn't find that exact text in the document to comment on.",
            };
        }
        const requiresConfirmation = docsActionRequiresConfirmation(result.action, selection.text.length);
        return {
          ok: true,
          action: result.action,
          preview: buildPreview(result.action),
          requiresConfirmation,
          confirmationMessage: requiresConfirmation
            ? `This replaces ${selection.text.length} selected characters. Review the change above before applying it.`
            : undefined,
        };
      }}
      apply={(action) => applyDocsAction(editor, action, selection, doc, me)}
      undo={() => editor.chain().focus().undo().run()}
      onClose={onClose}
    />
  );
}

/** The preview's half of {@link inlineNodes} — same parse, different renderer. */
function Marked({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((span, i) => (
        <span
          key={i}
          className={[
            span.bold ? "font-semibold text-ink" : "",
            span.italic ? "italic" : "",
            span.underline ? "underline" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {span.text}
        </span>
      ))}
    </>
  );
}

/**
 * One block's text as Tiptap text nodes, with its emphasis and any block
 * colour/size carried as marks.
 *
 * `textStyle` holds colour and size together — that is one mark with two
 * attrs in this editor's configuration (`Color` and `FontSize` both extend
 * it), not two marks, and splitting them drops whichever is applied second.
 */
function inlineNodes(
  text: string,
  style?: { color?: string; size?: number },
): { type: "text"; text: string; marks?: { type: string; attrs?: Record<string, unknown> }[] }[] {
  const textStyle: Record<string, unknown> = {};
  if (style?.color) textStyle.color = style.color;
  if (style?.size) textStyle.fontSize = `${style.size}pt`;
  const hasTextStyle = Object.keys(textStyle).length > 0;

  return parseInline(text).map((span) => {
    const marks: { type: string; attrs?: Record<string, unknown> }[] = [];
    if (span.bold) marks.push({ type: "bold" });
    if (span.italic) marks.push({ type: "italic" });
    if (span.underline) marks.push({ type: "underline" });
    if (hasTextStyle) marks.push({ type: "textStyle", attrs: textStyle });
    return marks.length
      ? { type: "text" as const, text: span.text, marks }
      : { type: "text" as const, text: span.text };
  });
}

/** The flattened-text range `quote` occupies in the live document, or null. */
function findQuoteRange(
  editor: Editor,
  quote: string,
): { from: number; to: number } | null {
  const { text, runs } = flattenDocument(editor.state.doc);
  const match = findMatches(text, quote)[0];
  if (!match) return null;
  const from = positionOf(runs, match.from);
  const to = positionOf(runs, match.to);
  return from !== null && to !== null && to > from ? { from, to } : null;
}

function applyDocsAction(
  editor: Editor,
  action: DocsAiAction,
  selection: { from: number; to: number },
  doc: Y.Doc | null,
  me: { id: string; displayName: string } | null,
) {
  /* Validated already refused an `add_comment` with no live room or no
     match for `quote` — by the time this runs both are known to hold, so
     this is read once rather than threaded through every other branch. */
  if (action.tool === "add_comment") {
    if (!doc || !me) return;
    const range = findQuoteRange(editor, action.quote);
    if (!range) return;
    addCommentThread({
      editor,
      doc,
      me,
      range,
      anchorText: action.quote,
      text: action.text,
    });
    return;
  }

  const chain = editor.chain().focus();

  switch (action.tool) {
    case "insert_blocks": {
      /* One `insertContentAt` with the whole body, so the entire document
         arrives as a SINGLE undo step — inserting block by block would make
         Ctrl-Z peel a twelve-block letter off one paragraph at a time. */
      const content = action.blocks.map((b) => {
        if (b.type === "divider") return { type: "horizontalRule" };

        if (b.type === "bullets" || b.type === "numbered")
          return {
            type: b.type === "bullets" ? "bulletList" : "orderedList",
            content: b.items.map((item) => ({
              type: "listItem",
              content: [{ type: "paragraph", content: inlineNodes(item) }],
            })),
          };

        if (b.type === "table")
          return {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: b.headers.map((h) => ({
                  type: "tableHeader",
                  content: [{ type: "paragraph", content: inlineNodes(h) }],
                })),
              },
              ...b.rows.map((row) => ({
                type: "tableRow",
                content: row.map((cell) => ({
                  type: "tableCell",
                  content: [{ type: "paragraph", content: inlineNodes(cell) }],
                })),
              })),
            ],
          };

        /* Heading, paragraph, quote — the three that carry block styling. */
        const attrs: Record<string, unknown> = {};
        if (b.align) attrs.textAlign = b.align;
        const nodes = inlineNodes(b.text, { color: b.color, size: b.size });

        if (b.type === "heading")
          return { type: "heading", attrs: { ...attrs, level: b.level }, content: nodes };
        if (b.type === "quote")
          return {
            type: "blockquote",
            content: [{ type: "paragraph", attrs, content: nodes }],
          };
        return { type: "paragraph", attrs, content: nodes };
      });
      chain.insertContentAt(selection.to, content).run();
      return;
    }
    case "insert_text":
      /* Inserted at the END of the selection, never replacing it — "insert"
         adds, it does not overwrite what was already there. */
      chain.insertContentAt(selection.to, action.text).run();
      return;
    case "replace_selection":
      chain.insertContentAt({ from: selection.from, to: selection.to }, action.text).run();
      return;
    case "create_heading":
      chain
        .insertContentAt(selection.to, {
          type: "heading",
          attrs: { level: action.level },
          content: action.text ? [{ type: "text", text: action.text }] : [],
        })
        .run();
      return;
    case "create_paragraph":
      chain
        .insertContentAt(selection.to, {
          type: "paragraph",
          content: action.text ? [{ type: "text", text: action.text }] : [],
        })
        .run();
      return;
    case "create_bullet_list":
    case "create_numbered_list": {
      const listType = action.tool === "create_bullet_list" ? "bulletList" : "orderedList";
      const listNode = {
        type: listType,
        content: action.items.map((item) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: item }] }],
        })),
      };
      /* Replaces a real selection (the tool's own description: "convert the
         selection... into a list"); otherwise inserts at the cursor. */
      if (selection.from !== selection.to) chain.insertContentAt({ from: selection.from, to: selection.to }, listNode).run();
      else chain.insertContentAt(selection.to, listNode).run();
      return;
    }
    case "create_table": {
      const tableNode = {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: action.headers.map((h) => ({
              type: "tableHeader",
              content: [{ type: "paragraph", content: h ? [{ type: "text", text: h }] : [] }],
            })),
          },
          ...action.rows.map((row) => ({
            type: "tableRow",
            content: row.map((cell) => ({
              type: "tableCell",
              content: [{ type: "paragraph", content: cell ? [{ type: "text", text: cell }] : [] }],
            })),
          })),
        ],
      };
      chain.insertContentAt(selection.to, tableNode).run();
      return;
    }
    case "format_text":
      if (action.bold === true) chain.setBold();
      else if (action.bold === false) chain.unsetBold();
      if (action.italic === true) chain.setItalic();
      else if (action.italic === false) chain.unsetItalic();
      if (action.underline === true) chain.setUnderline();
      else if (action.underline === false) chain.unsetUnderline();
      chain.run();
      return;
    case "insert_page_break":
      chain.setPageBreak().run();
      return;
  }
}
