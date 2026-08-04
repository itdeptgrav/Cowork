/**
 * A floor under a write that may never come back.
 *
 * ## Why this is needed at all
 *
 * **A Firestore write does not reject when the client is offline.** It is queued
 * locally and its promise stays pending until connectivity returns — which may
 * be a moment, or never for the life of the page. Almost everything that awaits
 * one is written on the assumption that it settles, and when it does not the
 * failure is silent rather than loud.
 *
 * The play/pause control had two of those, and both were reported as the same
 * complaint — "sometimes the button just does nothing":
 *
 *  · Its re-entrancy guard was released in a `finally`, which never ran. The
 *    button stayed alive to the touch and dropped every subsequent press.
 *  · Its optimistic flip expired by comparing the server's state against what
 *    it was when the press happened. A write that never lands never changes it,
 *    so the page went on showing "Paused" while the top-bar pill, which reads
 *    the server, kept counting up.
 *
 * ## What this deliberately does NOT do
 *
 * It does not cancel the write. There is no such thing for a queued Firestore
 * write, and pretending otherwise would be worse than the delay: the write is
 * still going to land, and the live session listener will show it when it does.
 * All this decides is how long the UI is willing to keep asserting something it
 * has not had confirmed.
 */

/**
 * How long a timer write may stay unsettled before the control stops believing
 * it.
 *
 * Long enough that a merely slow connection is not called a failure, short
 * enough that nobody is left pressing a dead button.
 */
export const TIMER_WRITE_TIMEOUT_MS = 12_000;

/**
 * Resolve `null` if `work` has not settled within `ms`. Never rejects on the
 * timeout — a stall is an outcome the caller handles, not an exception.
 *
 * A rejection from `work` itself passes straight through, because a refusal and
 * a stall need opposite handling: one puts the control back and shows the
 * engine's own reason, the other reverts to whatever the server holds.
 */
export async function settledWithin<T>(
  work: Promise<T>,
  ms: number = TIMER_WRITE_TIMEOUT_MS,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bell = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work, bell]);
  } finally {
    /* Or every press would hold a twelve-second timer alive long after the
       write returned. */
    clearTimeout(timer);
  }
}
