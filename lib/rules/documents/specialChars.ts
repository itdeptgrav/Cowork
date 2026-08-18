/**
 * The special-character picker.
 *
 * **A short, practical set rather than the whole of Unicode.** A grid of ten
 * thousand glyphs is a worse tool than a list of the fifty a working document
 * actually needs — nobody scrolls to find an em dash. What is here is what
 * turns up in ordinary business writing: the punctuation a keyboard cannot
 * type, currency, maths, arrows, and the accented letters that appear in
 * names.
 *
 * Every character carries the words somebody would search for rather than only
 * its Unicode name: "degree" finds the degree sign, but so does "temperature",
 * because the Unicode name is what you know only if you already knew what you
 * were looking for.
 */

export interface SpecialChar {
  /** The character itself — what is inserted. */
  readonly char: string;
  /** What it is called, shown under the glyph. */
  readonly name: string;
  /** The group it is listed under. */
  readonly group: SpecialCharGroup;
  /** Extra words that should find it. The name is always searched too. */
  readonly keywords?: readonly string[];
}

export const SPECIAL_CHAR_GROUPS = [
  "Punctuation",
  "Currency",
  "Maths",
  "Arrows",
  "Letters",
  "Symbols",
] as const;

export type SpecialCharGroup = (typeof SPECIAL_CHAR_GROUPS)[number];

export const SPECIAL_CHARS: readonly SpecialChar[] = [
  /* Punctuation — the reason most people open this panel. */
  { char: "—", name: "Em dash", group: "Punctuation", keywords: ["long dash", "hyphen"] },
  { char: "–", name: "En dash", group: "Punctuation", keywords: ["range", "hyphen"] },
  { char: "…", name: "Ellipsis", group: "Punctuation", keywords: ["dots", "three dots"] },
  { char: "“", name: "Left double quote", group: "Punctuation", keywords: ["curly", "smart"] },
  { char: "”", name: "Right double quote", group: "Punctuation", keywords: ["curly", "smart"] },
  { char: "‘", name: "Left single quote", group: "Punctuation", keywords: ["curly"] },
  { char: "’", name: "Right single quote", group: "Punctuation", keywords: ["apostrophe", "curly"] },
  { char: "«", name: "Left guillemet", group: "Punctuation", keywords: ["french quote"] },
  { char: "»", name: "Right guillemet", group: "Punctuation", keywords: ["french quote"] },
  { char: "•", name: "Bullet", group: "Punctuation", keywords: ["dot", "list"] },
  { char: "·", name: "Middle dot", group: "Punctuation", keywords: ["interpunct"] },
  { char: "†", name: "Dagger", group: "Punctuation", keywords: ["footnote"] },
  { char: "‡", name: "Double dagger", group: "Punctuation", keywords: ["footnote"] },
  { char: "§", name: "Section", group: "Punctuation", keywords: ["clause", "legal"] },
  { char: "¶", name: "Pilcrow", group: "Punctuation", keywords: ["paragraph"] },
  { char: "¿", name: "Inverted question mark", group: "Punctuation", keywords: ["spanish"] },
  { char: "¡", name: "Inverted exclamation mark", group: "Punctuation", keywords: ["spanish"] },

  /* Currency. */
  { char: "₹", name: "Indian rupee", group: "Currency", keywords: ["inr", "money", "rs"] },
  { char: "€", name: "Euro", group: "Currency", keywords: ["eur", "money"] },
  { char: "£", name: "Pound sterling", group: "Currency", keywords: ["gbp", "money"] },
  { char: "¥", name: "Yen", group: "Currency", keywords: ["jpy", "yuan", "money"] },
  { char: "¢", name: "Cent", group: "Currency", keywords: ["money"] },
  { char: "₽", name: "Rouble", group: "Currency", keywords: ["rub", "money"] },
  { char: "₩", name: "Won", group: "Currency", keywords: ["krw", "money"] },
  { char: "¤", name: "Currency sign", group: "Currency", keywords: ["money", "generic"] },

  /* Maths. */
  { char: "×", name: "Multiplication", group: "Maths", keywords: ["times", "multiply"] },
  { char: "÷", name: "Division", group: "Maths", keywords: ["divide"] },
  { char: "±", name: "Plus-minus", group: "Maths", keywords: ["tolerance", "margin"] },
  { char: "≈", name: "Approximately equal", group: "Maths", keywords: ["about", "roughly"] },
  { char: "≠", name: "Not equal", group: "Maths", keywords: ["different"] },
  { char: "≤", name: "Less than or equal", group: "Maths", keywords: ["at most"] },
  { char: "≥", name: "Greater than or equal", group: "Maths", keywords: ["at least"] },
  { char: "∞", name: "Infinity", group: "Maths", keywords: ["endless"] },
  { char: "√", name: "Square root", group: "Maths", keywords: ["radical"] },
  { char: "∑", name: "Sum", group: "Maths", keywords: ["sigma", "total"] },
  { char: "∆", name: "Delta", group: "Maths", keywords: ["change", "difference"] },
  { char: "π", name: "Pi", group: "Maths", keywords: ["circle"] },
  { char: "µ", name: "Micro", group: "Maths", keywords: ["mu", "millionth"] },
  { char: "°", name: "Degree", group: "Maths", keywords: ["temperature", "angle", "celsius"] },
  { char: "‰", name: "Per mille", group: "Maths", keywords: ["per thousand"] },
  { char: "½", name: "One half", group: "Maths", keywords: ["fraction"] },
  { char: "¼", name: "One quarter", group: "Maths", keywords: ["fraction"] },
  { char: "¾", name: "Three quarters", group: "Maths", keywords: ["fraction"] },

  /* Arrows. */
  { char: "→", name: "Right arrow", group: "Arrows", keywords: ["next", "then"] },
  { char: "←", name: "Left arrow", group: "Arrows", keywords: ["back", "previous"] },
  { char: "↑", name: "Up arrow", group: "Arrows", keywords: ["increase", "rise"] },
  { char: "↓", name: "Down arrow", group: "Arrows", keywords: ["decrease", "fall"] },
  { char: "↔", name: "Left-right arrow", group: "Arrows", keywords: ["both ways"] },
  { char: "⇒", name: "Double right arrow", group: "Arrows", keywords: ["implies", "therefore"] },
  { char: "⇐", name: "Double left arrow", group: "Arrows" },
  { char: "↵", name: "Return arrow", group: "Arrows", keywords: ["enter", "newline"] },

  /* Accented letters that appear in names. */
  { char: "á", name: "a acute", group: "Letters", keywords: ["accent", "spanish"] },
  { char: "à", name: "a grave", group: "Letters", keywords: ["accent", "french"] },
  { char: "ä", name: "a umlaut", group: "Letters", keywords: ["accent", "german", "diaeresis"] },
  { char: "å", name: "a ring", group: "Letters", keywords: ["accent", "swedish"] },
  { char: "ç", name: "c cedilla", group: "Letters", keywords: ["accent", "french"] },
  { char: "é", name: "e acute", group: "Letters", keywords: ["accent", "french"] },
  { char: "è", name: "e grave", group: "Letters", keywords: ["accent", "french"] },
  { char: "ë", name: "e umlaut", group: "Letters", keywords: ["accent", "diaeresis"] },
  { char: "í", name: "i acute", group: "Letters", keywords: ["accent"] },
  { char: "ñ", name: "n tilde", group: "Letters", keywords: ["accent", "spanish"] },
  { char: "ó", name: "o acute", group: "Letters", keywords: ["accent"] },
  { char: "ö", name: "o umlaut", group: "Letters", keywords: ["accent", "german"] },
  { char: "ø", name: "o slash", group: "Letters", keywords: ["accent", "danish"] },
  { char: "ú", name: "u acute", group: "Letters", keywords: ["accent"] },
  { char: "ü", name: "u umlaut", group: "Letters", keywords: ["accent", "german"] },
  { char: "ß", name: "Sharp s", group: "Letters", keywords: ["german", "eszett"] },
  { char: "æ", name: "ae ligature", group: "Letters", keywords: ["ash"] },
  { char: "œ", name: "oe ligature", group: "Letters" },

  /* Symbols. */
  { char: "©", name: "Copyright", group: "Symbols", keywords: ["rights"] },
  { char: "®", name: "Registered", group: "Symbols", keywords: ["trademark"] },
  { char: "™", name: "Trademark", group: "Symbols", keywords: ["tm", "brand"] },
  { char: "✓", name: "Tick", group: "Symbols", keywords: ["check", "done", "yes"] },
  { char: "✗", name: "Cross", group: "Symbols", keywords: ["no", "wrong", "fail"] },
  { char: "★", name: "Filled star", group: "Symbols", keywords: ["rating", "favourite"] },
  { char: "☆", name: "Empty star", group: "Symbols", keywords: ["rating"] },
  { char: "☑", name: "Ticked box", group: "Symbols", keywords: ["checkbox", "done"] },
  { char: "☐", name: "Empty box", group: "Symbols", keywords: ["checkbox", "todo"] },
  { char: "♦", name: "Diamond", group: "Symbols" },
  { char: "№", name: "Numero", group: "Symbols", keywords: ["number"] },
  { char: "℮", name: "Estimated", group: "Symbols" },
];

/**
 * The characters matching a query, in catalogue order.
 *
 * An empty or blank query returns everything, because the panel opens showing
 * the whole set rather than nothing. Matching is case-insensitive and
 * substring-based over the name and the extra keywords, and a query that IS a
 * character matches that character — pasting a euro sign into the box finds it.
 */
export function searchSpecialChars(
  query: string,
  chars: readonly SpecialChar[] = SPECIAL_CHARS,
): SpecialChar[] {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return [...chars];
  return chars.filter(
    (c) =>
      c.char === q ||
      c.name.toLowerCase().includes(q) ||
      (c.keywords ?? []).some((k) => k.toLowerCase().includes(q)),
  );
}

/** The catalogue split into its groups, empty groups dropped. */
export function groupSpecialChars(
  chars: readonly SpecialChar[],
): { group: SpecialCharGroup; chars: SpecialChar[] }[] {
  return SPECIAL_CHAR_GROUPS.map((group) => ({
    group,
    chars: chars.filter((c) => c.group === group),
  })).filter((g) => g.chars.length > 0);
}
