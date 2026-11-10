import { MESSAGE_PAGE_SIZE, type Message } from "@/lib/domain";
import { recentThread, rememberThread } from "./recentThreads";

/**
 * Start loading a conversation's newest page before it is opened (10 Nov 2026).
 *
 * ## Why
 *
 * Opening a chat for the first time showed placeholder rows for as long as
 * its first page took to arrive — the read only began once the click had
 * navigated and the thread had mounted. A pointer reaches a row a few hundred
 * milliseconds before the click lands, and that is time the read can use.
 *
 * ## Why this cannot show a stale thread
 *
 * What a prefetch fetches goes into `recentThreads`, the same store a thread
 * draws from while its own read is in flight — and that read still happens on
 * every open and replaces it the moment it lands (see `recentThreads`). A
 * prefetch only ever decides what is drawn for the length of that read; it
 * never stands in for it. That is why this is not `preloadQuery`, which serves
 * a result INSTEAD of fetching: a message arriving between the hover and the
 * click would then be missing until something else refreshed the thread.
 *
 * Deduplicated: one read per conversation at a time, and none at all for a
 * conversation already held.
 */

interface MessagesReader {
  listMessages(
    conversationId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<{ messages: Message[]; hasMore: boolean }>;
}

const inflight = new Map<string, Promise<Message[] | null>>();

export function prefetchThread(repo: MessagesReader, conversationId: string): void {
  if (!conversationId || recentThread(conversationId) || inflight.has(conversationId)) return;
  const read = repo
    .listMessages(conversationId, { limit: MESSAGE_PAGE_SIZE })
    .then((r) => {
      /* The thread may have opened and remembered a fresher page meanwhile;
         that one wins. */
      if (!recentThread(conversationId)) rememberThread(conversationId, r.messages);
      return r.messages;
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(conversationId);
    });
  inflight.set(conversationId, read);
}

/** The prefetch still in flight for this conversation, if one is. */
export function pendingThread(conversationId: string): Promise<Message[] | null> | null {
  return inflight.get(conversationId) ?? null;
}

/** For tests. */
export function inflightPrefetchCount(): number {
  return inflight.size;
}
