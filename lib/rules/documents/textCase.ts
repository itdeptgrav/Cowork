/**
 * Change the capitalisation of a selection: Format → Capitalisation.
 *
 * The everyday use is repair — a heading typed with caps-lock on, a name
 * pasted in shouting case — so the transforms are total and boring: they
 * touch letters and leave everything else exactly where it was.
 *
 * Pure string functions; the editor walks the selection's text nodes and
 * replaces each with its transformed text CARRYING THE SAME MARKS, so bold,
 * links and comments survive the change.
 */

export const CASE_MODES = ["upper", "lower", "title"] as const;
export type CaseMode = (typeof CASE_MODES)[number];

export const CASE_LABELS: Record<CaseMode, string> = {
  upper: "UPPERCASE",
  lower: "lowercase",
  title: "Title Case",
};

/**
 * Title Case, the way Docs does it: every word starts with a capital and the
 * rest is lowered.
 *
 * "Word" is anything between whitespace — deliberately no clever list of
 * small words to leave lowercase, because the lists disagree with each other
 * and with every style guide, and a person fixing one word can fix one word.
 * Punctuation-led words ("(hello") capitalise their first LETTER, not their
 * first character.
 */
function titleCase(text: string): string {
  return text.replace(/\S+/g, (word) => {
    const at = word.search(/\p{L}/u);
    if (at === -1) return word;
    return (
      word.slice(0, at) +
      word.slice(at, at + 1).toUpperCase() +
      word.slice(at + 1).toLowerCase()
    );
  });
}

/** The selected transform, total over any string. */
export function applyCase(text: string, mode: CaseMode): string {
  switch (mode) {
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "title":
      return titleCase(text);
  }
}
