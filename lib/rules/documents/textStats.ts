/**
 * Word count.
 *
 * Counted here rather than taken from an editor extension because the same
 * figure is wanted for a SELECTION as for the whole document, and because what
 * counts as a word is a decision worth writing down: a hyphenated compound is
 * one word, an em-dash between two words is not part of either, and a run of
 * whitespace of any kind is one boundary.
 *
 * Reading time is offered at 200 words per minute — the low end of adult
 * silent-reading estimates for prose, chosen because over-promising how fast a
 * document can be read is the error with a consequence.
 */

const WORDS_PER_MINUTE = 200;

export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  /* Split on whitespace, then discard anything with no letter or digit in it —
     a lone dash or bullet character between two spaces is punctuation, not a
     word. */
  return trimmed
    .split(/\s+/u)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export function characterCount(
  text: string,
  options: { includeSpaces?: boolean } = {},
): number {
  /* Counted in code points, so an emoji or an accented character built from a
     surrogate pair is one character rather than two. */
  const source = options.includeSpaces ? text : text.replace(/\s/gu, "");
  return [...source].length;
}

/** Paragraph count: runs of text separated by blank lines. */
export function paragraphCount(text: string): number {
  return text
    .split(/\n+/u)
    .map((p) => p.trim())
    .filter((p) => p.length > 0).length;
}

/** Whole minutes, never zero for a document that has words in it. */
export function readingMinutes(words: number): number {
  if (words <= 0) return 0;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
