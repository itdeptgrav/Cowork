/**
 * What the document editor sends Gemini — the selection and the minimum
 * surrounding material, never the whole document unless the caller has
 * already decided the person explicitly asked for whole-document analysis.
 *
 * This module does not read the editor. It takes plain strings the caller
 * already pulled from Tiptap (`editor.state.doc.textBetween(...)`), so the
 * budgeting rule is testable without mounting an editor.
 */

const MAX_SELECTION_CHARS = 6000;
const MAX_SURROUNDING_CHARS = 1200;
const MAX_HEADINGS = 20;

/** Cuts to a character budget on a word boundary where practical, and says so. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed}…`;
}

export interface DocsContextInput {
  /** The selected text, or empty when nothing is selected (cursor only). */
  selectionText: string;
  /** A short window of text immediately before the cursor/selection — for "continue writing" and local coherence. */
  precedingText: string;
  /** This document's own headings, outline-order — grounds "generate an outline" and "generate a title" without sending the body. */
  headings: string[];
  /**
   * The whole document's plain text. Only ever set by the caller when the
   * person's instruction explicitly asked for it ("summarize the whole
   * document") — this module trusts that decision rather than making it,
   * since only the caller knows what was actually asked.
   */
  wholeDocumentText?: string;
}

export function buildDocsContext(input: DocsContextInput): string {
  const parts: string[] = [];

  if (input.selectionText.trim()) {
    parts.push(`Selected text:\n"""${clamp(input.selectionText, MAX_SELECTION_CHARS)}"""`);
  } else {
    parts.push("Nothing is selected — the cursor is at the position described below.");
  }

  if (input.precedingText.trim()) {
    parts.push(`Text immediately before this position:\n"""${clamp(input.precedingText, MAX_SURROUNDING_CHARS)}"""`);
  }

  if (input.headings.length > 0) {
    const shown = input.headings.slice(0, MAX_HEADINGS);
    const truncatedNote = input.headings.length > MAX_HEADINGS ? ` (+${input.headings.length - MAX_HEADINGS} more)` : "";
    parts.push(`Document headings, in order: ${shown.join(" › ")}${truncatedNote}`);
  }

  if (input.wholeDocumentText) {
    parts.push(`Full document text (explicitly requested):\n"""${input.wholeDocumentText}"""`);
  }

  return parts.join("\n\n");
}

/** True when the instruction is plainly asking about the whole document rather than the selection. */
export function requestsWholeDocument(instruction: string): boolean {
  return /\b(whole|entire|full)\s+document\b/i.test(instruction);
}
