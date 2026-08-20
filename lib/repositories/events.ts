/**
 * A single change signal for the whole repository.
 *
 * The prototype's store is a module singleton, so a mutation in one component
 * is invisible to every other component that already fetched. That is not a
 * cosmetic problem: start a timer in a task row and the shell's "what am I
 * working on" pill, the overview's session cell and the day's logged total are
 * all describing a world that no longer exists.
 *
 * Rather than thread refetch callbacks between unrelated trees, mutations bump
 * a version and queries re-run. A production repository would satisfy the same
 * contract from a socket or a poll — which is the point of putting the signal
 * on the seam rather than inside the mock.
 */

let version = 0;
const listeners = new Set<() => void>();
const staleListeners = new Set<(methods: readonly string[]) => void>();

export function subscribeToRepository(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRepositoryVersion(): number {
  return version;
}

/**
 * Subscribe to "this data is now known to be wrong", by repository method name.
 *
 * The version bump above says *something* changed; this says *what*. Only the
 * query cache in `useRepository` listens, and it is the reason the two signals
 * are separate — see `notifyRepositoryChanged`.
 */
export function subscribeToStaleData(
  listener: (methods: readonly string[]) => void,
): () => void {
  staleListeners.add(listener);
  return () => staleListeners.delete(listener);
}

/**
 * Called by `useAction` after any mutation resolves, and by any repository
 * write or live listener that knows something changed.
 *
 * **Naming the affected methods is not optional bookkeeping where a query has a
 * `staleTime`.** `useQuery` keeps a short-TTL cache for reads that are
 * expensive and rarely change, and that cache is keyed WITHOUT the version — by
 * design, so a timer heartbeat does not re-run a weekly graph. The consequence
 * is that a bare bump cannot dislodge a cached answer, and for a read whose
 * whole job is to be current that is a stale screen rather than a saved query.
 *
 * That is exactly what the conversation list did. `listConversations` carries a
 * 30-second TTL and feeds both the message previews and the unread badges, so a
 * message sent or received inside that window changed nothing on screen: the
 * left-hand list went on showing the previous message as the latest one, and a
 * newly-arrived message raised no badge until the TTL happened to lapse.
 *
 * So: a caller that knows *which* data changed says so, and the cached entries
 * for those methods are dropped before the bump lands. Callers that do not know
 * — `useAction`, which sees only that some mutation resolved — pass nothing and
 * behave exactly as before.
 */
export function notifyRepositoryChanged(...staleMethods: string[]): void {
  /* Before the bump, never after: the listeners the bump wakes will re-read
     immediately, and a cache purged behind them would be purged too late. */
  invalidateQueries(...staleMethods);
  version += 1;
  for (const l of listeners) l();
}

/**
 * Drop cached reads for these methods **without** bumping the version.
 *
 * For a repository whose mutations are already followed by a bump from
 * `useAction` — the mock's are, since it does not announce its own writes.
 * Calling `notifyRepositoryChanged` there would bump twice for one mutation and
 * make every query on the page run two round trips instead of one.
 *
 * A purge alone is safe: it only removes an answer, so the worst it can cause
 * is one read that would otherwise have been served from the cache. It is the
 * bump that decides when anybody looks again.
 */
export function invalidateQueries(...methods: string[]): void {
  if (!methods.length) return;
  for (const l of staleListeners) l(methods);
}

const purgeAllListeners = new Set<() => void>();

/** Subscribe to "throw away every cached read". Only the query cache listens. */
export function subscribeToPurgeAll(listener: () => void): () => void {
  purgeAllListeners.add(listener);
  return () => purgeAllListeners.delete(listener);
}

/**
 * Re-read everything, now — what the Sync button does.
 *
 * **Deliberately heavier than a version bump.** A bump alone re-runs the live
 * queries but leaves the TTL cache standing, so the reads with a `staleTime`
 * would answer from their own copy and the one thing somebody pressing Sync is
 * asking for — *are you sure this is current?* — would be the thing they did
 * not get. Every cached answer goes first.
 *
 * It exists because until now the honest answer to "is this stale?" was
 * "reload the page". A full reload re-runs the whole sign-in ladder, re-mounts
 * every provider, and loses scroll position and any open panel — an expensive
 * way to ask a question this answers in one round trip.
 */
export function refreshEverything(): void {
  for (const l of purgeAllListeners) l();
  version += 1;
  for (const l of listeners) l();
}

/**
 * Does a cached query key belong to this repository method?
 *
 * `useQuery` keys its TTL cache by the fetcher's SOURCE TEXT plus its deps, so
 * "which cached entries belong to `listConversations`" is answered by looking
 * for the call inside that text: `(r) => r.listConversations()`. Property names
 * survive minification — only the parameter is renamed — which is the same
 * guarantee `METHOD_STALE_DEFAULTS` already depends on.
 *
 * Anchored on the dot and the opening bracket so `listMessages` cannot clear
 * `listMessagesForTask`, and so a name appearing in a comment or a string is
 * not mistaken for a call.
 *
 * It lives here rather than beside the cache it serves for two reasons: it is
 * the matching half of the signal declared above, and `useRepository` cannot be
 * loaded under `node --test` — so a matcher defined there could not be tested,
 * and its failure mode is silent in both directions. A name that matches
 * nothing leaves the cache exactly as stale as before; one that matches too
 * much throws away reads that were fine.
 */
export function cacheKeyTargets(key: string, method: string): boolean {
  return key.includes(`.${method}(`);
}

/**
 * Remove every entry these methods own, from both of `useQuery`'s caches.
 *
 * The caches are passed in rather than reached for, because they live in
 * `useRepository` — a `"use client"` module that pulls in the repository
 * barrel, which `node --test` cannot resolve. Written the other way round this
 * would be the one link in the chain with no test, and it is the link that
 * actually does the work.
 *
 * The two caches are keyed differently and are matched differently because of
 * it. The TTL cache is keyed by the fetcher's SOURCE, so a method is found by
 * looking for its call. The preload cache is keyed by the method NAME followed
 * by its stringified deps, so the prefix is exact — `listMessages[` can never
 * match `listMessagesForTask[`.
 */
export function purgeQueryCaches(
  methods: readonly string[],
  ttlCache: Map<string, unknown>,
  preloadCache: Map<string, unknown>,
): void {
  for (const method of methods) {
    for (const key of ttlCache.keys()) {
      if (cacheKeyTargets(key, method)) ttlCache.delete(key);
    }
    for (const key of preloadCache.keys()) {
      if (key === method || key.startsWith(`${method}[`)) preloadCache.delete(key);
    }
  }
}
