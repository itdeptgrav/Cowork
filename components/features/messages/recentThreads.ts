import type { Message } from "@/lib/domain";

/**
 * The last page each conversation was seen with, so switching back to one draws
 * it instead of a row of placeholders.
 *
 * ## The problem it solves, and the one it must not create
 *
 * `Thread` is keyed on the conversation id, so moving between chats remounts it
 * and its `listMessages` read starts from nothing. For the length of that round
 * trip the pane showed skeleton rows — on every switch, including switching
 * straight back to a thread read seconds earlier. The messages were already
 * known; nothing was using them.
 *
 * **This is not a cache.** A cache answers a question so the question need not
 * be asked. This never stops the question being asked: `useQuery` still fetches
 * on every mount, and its answer replaces whatever is held here the moment it
 * arrives. What is held is only the last thing that WAS on screen for that
 * conversation, and it is drawn only while there is nothing newer to draw. So
 * there is no window in which a message could be missing from this and present
 * on the server without the read that would reveal it already being in flight.
 *
 * That distinction is why it needs no invalidation and is not wired to
 * `notifyRepositoryChanged`: nothing here can go stale in a way a pending read
 * will not correct.
 *
 * ## In memory, and bounded
 *
 * A module-level `Map`, not `localStorage`: it exists to smooth a switch inside
 * one visit, and message bodies are somebody's correspondence — they should not
 * outlive the tab, and they should not be written to disk by a component whose
 * job is drawing them.
 *
 * The `Map` is bounded and evicts in insertion order (JavaScript's `Map`
 * iterates that way), which for this makes it a least-recently-USED policy:
 * every re-remember deletes the key first, so anything re-opened moves to the
 * back of the queue and the entry evicted is the thread nobody has returned to.
 */

/**
 * How many threads to hold.
 *
 * Twelve is a few more than the conversation list shows at once, so moving
 * around the visible list never evicts anything the reader is moving between,
 * and small enough that a day of chats cannot grow into the tens of megabytes
 * that holding every thread's attachments-and-all messages would.
 */
const LIMIT = 12;

const threads = new Map<string, readonly Message[]>();

/** What this conversation last had on screen, or null if it has not been open. */
export function recentThread(conversationId: string): Message[] | null {
  const held = threads.get(conversationId);
  return held ? [...held] : null;
}

/** Record what is on screen now, evicting the least recently opened thread. */
export function rememberThread(
  conversationId: string,
  messages: readonly Message[],
): void {
  /* Deleted first so re-remembering moves it to the back of the insertion
     order — without this, a thread opened every minute would still be evicted
     for having been FIRST opened long ago. */
  threads.delete(conversationId);
  threads.set(conversationId, [...messages]);
  while (threads.size > LIMIT) {
    const oldest = threads.keys().next();
    if (oldest.done) break;
    threads.delete(oldest.value);
  }
}

/**
 * Drop everything. Called when the signed-in person changes — one browser, two
 * people, and the second must not be handed the first's conversations even for
 * the moment before a read lands.
 */
export function forgetThreads(): void {
  threads.clear();
}

/** How many threads are held. For tests and for nothing else. */
export function heldThreadCount(): number {
  return threads.size;
}
