/**
 * Emoji reactions on a message — the rule, held apart from the two stores that
 * apply it.
 *
 * **One reaction per person per message.** Choosing an emoji replaces whatever
 * you had; choosing the one you already have takes it off. That is the rule
 * every messaging product shares, and it lives here once so the Firestore
 * repository and the in-memory prototype cannot drift on it.
 *
 * Two spellings of the same decision, because the stores write differently:
 * `toggleReaction` returns the next plain map (what the prototype stores and
 * what a test can assert on), and `reactionChanges` returns per-emoji add or
 * remove intents (what the Firestore write turns into `arrayUnion` /
 * `arrayRemove`, so two people reacting in the same instant cannot clobber
 * each other's entry).
 */

export type MessageReactions = Record<string, string[]>;

/** The next reactions map after `me` picks `emoji`. Empty entries are dropped
 *  so a map only ever names emojis somebody currently holds. */
export function toggleReaction(
  current: MessageReactions | undefined,
  emoji: string,
  me: string,
): MessageReactions {
  const map = current ?? {};
  const had = (map[emoji] ?? []).includes(me);
  const out: MessageReactions = {};
  for (const [e, ids] of Object.entries(map)) {
    const rest = ids.filter((id) => id !== me);
    if (rest.length) out[e] = rest;
  }
  if (!had) out[emoji] = [...(out[emoji] ?? []), me];
  return out;
}

/**
 * The write each store must make for `me` picking `emoji`: `add` me to an
 * emoji's list, or `remove` me from one. Only emojis that actually change are
 * named, so an untouched reaction is never written at all.
 */
export function reactionChanges(
  current: MessageReactions | undefined,
  emoji: string,
  me: string,
): Record<string, "add" | "remove"> {
  const map = current ?? {};
  const changes: Record<string, "add" | "remove"> = {};
  for (const [e, ids] of Object.entries(map)) {
    if (e !== emoji && ids.includes(me)) changes[e] = "remove";
  }
  const had = (map[emoji] ?? []).includes(me);
  changes[emoji] = had ? "remove" : "add";
  return changes;
}

/** The emoji `me` currently holds on a message, or null. */
export function myReaction(
  current: MessageReactions | undefined,
  me: string,
): string | null {
  for (const [e, ids] of Object.entries(current ?? {})) {
    if (ids.includes(me)) return e;
  }
  return null;
}

export interface ReactionChip {
  emoji: string;
  count: number;
  /** Whether the viewer is among them — the chip that toggles OFF on click. */
  mine: boolean;
}

/**
 * The chips a bubble draws: most-chosen first, ties broken by the palette's
 * own order so the row cannot reshuffle between two renders.
 */
export function reactionSummary(
  current: MessageReactions | undefined,
  me: string,
  palette: readonly string[],
): ReactionChip[] {
  const entries = Object.entries(current ?? {}).filter(
    ([, ids]) => ids.length > 0,
  );
  const rank = (e: string) => {
    const i = palette.indexOf(e);
    return i === -1 ? palette.length : i;
  };
  return entries
    .map(([emoji, ids]) => ({
      emoji,
      count: ids.length,
      mine: ids.includes(me),
    }))
    .sort((a, b) => b.count - a.count || rank(a.emoji) - rank(b.emoji));
}
