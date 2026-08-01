/**
 * Find and replace — the matching rule, kept away from the editor.
 *
 * The editor knows how to map a character offset to a document position and how
 * to paint a decoration; it should not also be the place where "whole word" is
 * defined. This module answers one question — *where does this query occur in
 * this text* — over a plain string, so the awkward cases (an empty query, a
 * query that overlaps itself, a word boundary next to punctuation) are testable
 * without a ProseMirror document.
 *
 * ## Offsets are ProseMirror's, not JavaScript's
 *
 * The caller passes text extracted with a block separator of exactly one
 * character per block gap, so an index into that string is a position in the
 * document. That correspondence is the caller's contract to keep; everything
 * here is plain string arithmetic.
 */

export interface FindMatch {
  /** Index of the first character. */
  from: number;
  /** Index one past the last character. */
  to: number;
}

export interface FindOptions {
  matchCase?: boolean;
  /** Match only where the query is bounded by non-word characters. */
  wholeWord?: boolean;
}

const isWordChar = (ch: string | undefined): boolean =>
  ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

/**
 * Every occurrence, left to right, **non-overlapping**.
 *
 * Non-overlapping is the behaviour every editor has and the one replace-all
 * requires: with overlaps, replacing every match of `aa` in `aaaa` would
 * consume characters twice and produce a result the reader cannot predict.
 */
export function findMatches(
  text: string,
  query: string,
  options: FindOptions = {},
): FindMatch[] {
  if (!query) return [];
  const haystack = options.matchCase ? text : text.toLowerCase();
  const needle = options.matchCase ? query : query.toLowerCase();
  const matches: FindMatch[] = [];

  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    const to = at + needle.length;
    if (
      !options.wholeWord ||
      (!isWordChar(text[at - 1]) && !isWordChar(text[to]))
    ) {
      matches.push({ from: at, to });
      from = to;
    } else {
      /* A rejected candidate advances by ONE character, not by the query
         length: `cat` inside `cathedral` is refused, but `cat` two characters
         later would be missed if the whole word were skipped. */
      from = at + 1;
    }
  }
  return matches;
}

/**
 * The match to select next, given where the caret is.
 *
 * Wraps, because a search that stops at the end of the document and says
 * nothing looks like a search that failed. `direction` is +1 for next and -1
 * for previous.
 */
export function matchIndexFrom(
  matches: readonly FindMatch[],
  caret: number,
  direction: 1 | -1,
): number | null {
  if (matches.length === 0) return null;
  if (direction === 1) {
    const at = matches.findIndex((m) => m.from >= caret);
    return at === -1 ? 0 : at;
  }
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    if (matches[i].to <= caret) return i;
  }
  return matches.length - 1;
}

/**
 * Apply replacements right to left.
 *
 * Right to left because each replacement shifts every offset after it; walking
 * forward would require re-deriving the remaining matches after every step, and
 * getting that wrong silently corrupts the tail of a document. Returned as a
 * list of edits rather than a rewritten string so the caller can apply them as
 * one transaction — a replace-all that lands as forty undo steps is one people
 * cannot back out of.
 */
export function replacementEdits(
  matches: readonly FindMatch[],
): FindMatch[] {
  return [...matches].sort((a, b) => b.from - a.from);
}
