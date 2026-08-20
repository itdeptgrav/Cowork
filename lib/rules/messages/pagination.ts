import type { Message } from "@/lib/domain";

/**
 * Stitching a thread together from a live page and a stack of older ones.
 *
 * ## The problem this exists to solve
 *
 * Paging backwards through a conversation is easy until you remember that the
 * newest page is not static: `watchConversationMessages` re-reads it whenever
 * anybody sends, edits or deletes anything. So the thread is one LIVE page that
 * changes underneath you, plus a growing stack of history that does not.
 *
 * The previous design avoided the problem by never having two pages — it asked
 * for a bigger window each time, 50 then 100 then 150, re-reading everything
 * already on screen to add fifty more. Correct, and quadratic: scrolling back
 * through a long thread re-read it from the beginning on every step, and every
 * live update re-read however far somebody had scrolled.
 *
 * Writing the reconciliation down instead costs this module and buys a thread
 * where each older page is fetched exactly once.
 *
 * ## The rules
 *
 * · **Identity is the message id**, never position. A message can legitimately
 *   appear in two pages — the cursor is inclusive precisely so none is skipped
 *   — and it can move between them when a new message shifts a boundary.
 * · **The live page wins.** It is the one that was just re-read, so its copy of
 *   a message carries the edit, the tombstone and the newest `readBy`. An older
 *   page's copy is a snapshot from whenever it was fetched.
 * · **Order is by `createdAt`, then by id.** Two messages can share a timestamp
 *   — `serverTimestamp()` is not unique — and without the tiebreak the thread
 *   would reshuffle those two on every merge, which reads as messages jumping.
 */

/**
 * Every page into one ordered thread, oldest first, with no message twice.
 *
 * Later pages take precedence, so callers pass history first and the live page
 * last. Insertion order is preserved for the map, then the result is sorted —
 * a page fetched out of order cannot corrupt the sequence.
 */
export function mergeMessagePages(pages: readonly Message[][]): Message[] {
  const byId = new Map<string, Message>();
  for (const page of pages) {
    for (const m of page) byId.set(m.id, m);
  }
  return [...byId.values()].sort(compareMessages);
}

/** Oldest first. Ties broken by id so the order cannot flicker between reads. */
function compareMessages(a: Message, b: Message): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The cursor for the next page back: the oldest instant currently loaded.
 *
 * Null when there is nothing loaded, which a caller must read as "do not ask
 * for older yet" rather than as "start from now" — asking with no cursor would
 * return the newest page again and append it to itself.
 */
export function oldestLoadedAt(messages: readonly Message[]): string | null {
  let oldest: string | null = null;
  for (const m of messages) {
    if (!m.createdAt) continue;
    if (oldest === null || m.createdAt < oldest) oldest = m.createdAt;
  }
  return oldest;
}

/**
 * What a freshly-fetched older page actually adds.
 *
 * The inclusive cursor guarantees at least one message we already hold, so a
 * page is not "empty" simply because everything in it is known — and a page
 * whose contents are ALL known is how the top of the conversation announces
 * itself. Separating the two is the whole of "correctly handle when there are
 * no more older messages".
 */
export function newMessagesIn(
  page: readonly Message[],
  known: ReadonlySet<string>,
): Message[] {
  return page.filter((m) => !known.has(m.id));
}

/**
 * Whether scrolling up should ask for another page.
 *
 * **Never while one is in flight**, which is not a nicety: the scroll handler
 * runs on every frame of a scroll, so an unguarded check fires the same request
 * dozens of times before the first one lands.
 */
export function shouldLoadOlder(input: {
  /** Distance from the top of the scroll port, in pixels. */
  scrollTop: number;
  /** A request is already running. */
  loading: boolean;
  /** The thread has said there is nothing older. */
  exhausted: boolean;
  /** How close to the top counts as asking. */
  thresholdPx?: number;
}): boolean {
  if (input.loading || input.exhausted) return false;
  return input.scrollTop <= (input.thresholdPx ?? 80);
}
