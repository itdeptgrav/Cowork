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

export function subscribeToRepository(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRepositoryVersion(): number {
  return version;
}

/** Called by `useAction` after any mutation resolves. */
export function notifyRepositoryChanged(): void {
  version += 1;
  for (const l of listeners) l();
}
