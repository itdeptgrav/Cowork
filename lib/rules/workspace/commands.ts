/**
 * Matching what somebody types against the workspace's commands.
 *
 * ## Why a ranking rather than a filter
 *
 * A palette that merely filters by substring puts "Rename this document" above
 * "New document" for the query `n`, because it walks the list in whatever order
 * the list happens to be in. The first row is the one Enter runs, so the order
 * is not decoration — it decides what happens when somebody types two letters
 * and commits. Ranking is therefore part of the behaviour, and it lives here,
 * where it can be pinned by tests, rather than inside a component's render.
 *
 * ## Predictable, not clever
 *
 * There is no fuzzy subsequence matching. A palette that answers `dc` with
 * "**D**upli**c**ate" is impressive until it answers a two-letter query with a
 * destructive command nobody was aiming at. Every rank below is one a person
 * could state: it starts with what I typed, one of its words does, its initials
 * do, or it contains it. Anything else is not a match, and showing nothing is
 * the honest answer to a query that matches nothing.
 *
 * Ties keep the order the caller gave, which is how a caller expresses that
 * "New document" matters more than "Delete" — an ordering the matcher itself
 * has no way to know.
 */

export interface CommandDescriptor {
  id: string;
  /** What the row reads. Matched against, so it must be the words people use. */
  label: string;
  /** The heading this command sits under. Groups render in first-seen order. */
  group: string;
  /** Right-aligned: a shortcut, or when a document was last touched. */
  hint?: string;
  /**
   * Other words that should find it — the vocabulary somebody might reach for
   * that the label does not happen to use ("spreadsheet" for a sheet, "pdf"
   * for print). Never a restatement of the label: it already matches itself.
   */
  keywords?: string[];
}

/**
 * Lower is better. Exported because the palette shows nothing about rank and a
 * test that asserted on array positions alone would not say what it was
 * checking.
 */
export const COMMAND_RANK = {
  exact: 0,
  prefix: 1,
  initials: 2,
  wordPrefix: 3,
  keywordPrefix: 4,
  contains: 5,
  keywordContains: 6,
} as const;

/** Shortest query allowed to match in the middle of a word. See `commandRank`. */
const MIN_CONTAINS = 3;

/** Lowercased, with runs of whitespace collapsed. Nothing else is stripped. */
export function normalizeQuery(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** `New document` → `nd`. Used for the two-keystroke reach at rank `initials`. */
function initialsOf(label: string): string {
  return label
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => word[0]!.toLowerCase())
    .join("");
}

/** Every word of the label, so `doc` finds "New **doc**ument". */
function wordsOf(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * How well a command answers a query, or `null` when it does not.
 *
 * The query is taken as one string rather than split into terms: these labels
 * are two or three words long, and a multi-term query against a three-word
 * label is a way of making `new d` fail to find "New document".
 */
export function commandRank(
  command: Pick<CommandDescriptor, "label" | "keywords">,
  query: string,
): number | null {
  const q = normalizeQuery(query);
  if (!q) return COMMAND_RANK.exact;

  const label = command.label.toLowerCase();
  if (label === q) return COMMAND_RANK.exact;
  if (label.startsWith(q)) return COMMAND_RANK.prefix;

  /* Only for queries short enough to be an abbreviation. Without the bound,
     a long query that happens to spell out initials outranks the label that
     actually contains it. */
  if (q.length >= 2 && q.length <= 4 && initialsOf(command.label).startsWith(q))
    return COMMAND_RANK.initials;

  if (wordsOf(command.label).some((word) => word.startsWith(q)))
    return COMMAND_RANK.wordPrefix;

  const keywords = (command.keywords ?? []).map((k) => k.toLowerCase());
  if (keywords.some((k) => k.startsWith(q))) return COMMAND_RANK.keywordPrefix;

  /* Mid-word matching needs three letters. Below that it is noise: `nd` sits
     inside "Mi**nd**map", and a palette that answers a two-letter query with a
     command from another surface is one people stop trusting Enter in. */
  if (q.length < MIN_CONTAINS) return null;
  if (label.includes(q)) return COMMAND_RANK.contains;
  if (keywords.some((k) => k.includes(q))) return COMMAND_RANK.keywordContains;

  return null;
}

/**
 * The commands that answer a query, best first.
 *
 * An empty query returns the list untouched — the palette's resting state is
 * the curated order, not an alphabetised one.
 */
export function matchCommands<T extends CommandDescriptor>(
  commands: readonly T[],
  query: string,
): T[] {
  if (!normalizeQuery(query)) return [...commands];
  return commands
    .map((command, index) => ({ command, index, rank: commandRank(command, query) }))
    .filter((row): row is { command: T; index: number; rank: number } => row.rank !== null)
    /* Index as the tie-break, so the caller's order survives. `Array.sort` is
       stable in every engine this runs in, but saying it here means the
       guarantee does not depend on remembering that. */
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((row) => row.command);
}

/**
 * The same commands, gathered under their headings.
 *
 * Groups appear in the order their first command does, which means a search
 * re-orders the headings to follow the best match rather than holding an empty
 * "Create" heading above the row somebody is actually aiming at.
 */
export function groupCommands<T extends CommandDescriptor>(
  commands: readonly T[],
): { group: string; items: T[] }[] {
  const out: { group: string; items: T[] }[] = [];
  for (const command of commands) {
    const existing = out.find((g) => g.group === command.group);
    if (existing) existing.items.push(command);
    else out.push({ group: command.group, items: [command] });
  }
  return out;
}

/**
 * Where the selection lands after an arrow key.
 *
 * Wraps at both ends, and answers 0 for an empty list so the caller never has
 * to hold a selection that points at nothing.
 */
export function moveSelection(
  current: number,
  delta: number,
  count: number,
): number {
  if (count <= 0) return 0;
  return (((current + delta) % count) + count) % count;
}
