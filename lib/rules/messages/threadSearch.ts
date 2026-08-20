/**
 * Searching within one open conversation.
 *
 * Case-insensitive substring over the messages the thread has LOADED — the
 * live page plus however much history has been fetched. That honesty matters:
 * the search bar offers "load earlier messages" rather than pretending to have
 * read a thread it has not, because a search that silently misses the answer
 * teaches people the feature lies.
 *
 * The same pass answers the starred filter — starred-only with no query lists
 * the viewer's bookmarks — so search and starred cannot disagree about which
 * messages exist.
 */
import type { Message } from "../../domain/work.ts";

export interface ThreadSearchInput {
  query: string;
  /** Only messages the viewer has starred. */
  starredOnly?: boolean;
  viewerId: string | null;
}

/**
 * The ids of matching messages, in thread order.
 *
 * Deleted messages never match — their text is a tombstone, not words anybody
 * wrote. A blank query with the star filter off matches nothing rather than
 * everything: "search for nothing" is not a request for the whole thread.
 */
export function searchThread(
  messages: readonly Message[],
  input: ThreadSearchInput,
): string[] {
  const needle = input.query.trim().toLowerCase();
  const starredOnly = input.starredOnly === true;
  if (!needle && !starredOnly) return [];
  return messages
    .filter((m) => {
      if (m.isDeleted === true) return false;
      if (
        starredOnly &&
        !(input.viewerId && (m.starredBy ?? []).includes(input.viewerId))
      )
        return false;
      if (!needle) return true;
      return m.text.toLowerCase().includes(needle);
    })
    .map((m) => m.id);
}
