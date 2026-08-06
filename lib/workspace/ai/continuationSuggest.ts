/**
 * Whether to offer an ambient "continue writing" suggestion right now.
 *
 * Approximates a streaming ghost-text feature without actually streaming —
 * `requestAssist` is a single request/response call (see `client.ts`), so
 * this fires it once, after a real pause in typing, rather than
 * continuously. Kept pure and DOM-free so the gating rule can be tested
 * without a Tiptap instance; the caller (`DocumentEditor.tsx`) supplies
 * everything by reading the live editor state at the moment the debounce
 * timer fires.
 */

/** How long a typing pause has to last before a suggestion is offered. */
export const CONTINUATION_PAUSE_MS = 2_500;

/** Below this, there isn't enough voice/context for a continuation to sound
    like the same writer rather than a guess from nothing. */
const MIN_PRECEDING_CHARS = 40;

export function shouldOfferContinuation(input: {
  precedingText: string;
  hasSelection: boolean;
  cursorAtParagraphEnd: boolean;
  enabled: boolean;
}): boolean {
  if (!input.enabled) return false;
  /* A selection means the person is reviewing or about to replace
     something — offering to append text under their cursor at the same
     moment is answering a question nobody asked. */
  if (input.hasSelection) return false;
  /* Mid-sentence is mid-thought. Only the end of a block reads as "done
     with this thought, about to start the next one" — the one moment a
     continuation is actually useful rather than an interruption. */
  if (!input.cursorAtParagraphEnd) return false;
  return input.precedingText.trim().length >= MIN_PRECEDING_CHARS;
}
