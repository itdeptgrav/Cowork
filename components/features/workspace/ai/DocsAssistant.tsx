"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { AssistantPanel } from "./AssistantPanel";
import { DiffPreview } from "./DiffPreview";
import { buildDocsContext, requestsWholeDocument } from "@/lib/rules/documents/aiContext";
import { docsActionRequiresConfirmation, validateDocsToolCall, type DocsAiAction } from "@/lib/rules/documents/aiTools";

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
  onClose,
}: {
  editor: Editor;
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
      apply={(action) => applyDocsAction(editor, action, selection)}
      undo={() => editor.chain().focus().undo().run()}
      onClose={onClose}
    />
  );
}

function applyDocsAction(
  editor: Editor,
  action: DocsAiAction,
  selection: { from: number; to: number },
) {
  const chain = editor.chain().focus();

  switch (action.tool) {
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
