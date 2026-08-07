/**
 * The last resolved identity, kept so a reload does not re-earn it.
 *
 * ## What this fixes
 *
 * Nothing about the sign-in expires. Firebase keeps the session in IndexedDB
 * and `onIdTokenChanged` re-mirrors the token into the cookie on every silent
 * renewal, so a signed-in person stays signed in. What was never kept was the
 * ANSWER: who this Firebase user is inside the workspace.
 *
 * So every reload re-ran the whole ladder before the app could render — wait for
 * `onAuthStateChanged`, call `/cowork/me`, then several enrichment steps, each
 * a network round trip with its own timeout budget. The person sat on "Signing
 * you in…" watching work they were already signed in for being re-derived.
 *
 * ## Why this is safe
 *
 * **Keyed by the Firebase uid, and only read once Firebase has said who is
 * signed in.** It is never used to GUESS an identity — the uid comes from the
 * SDK's own restored session, not from this cache and not from the cookie. A
 * different person signing in on the same browser has a different uid and reads
 * nothing.
 *
 * **Presentational only, and always revalidated.** The ladder still runs on
 * every load and overwrites this the moment it answers, so a role change, a
 * transfer or a deactivation corrects itself within one round trip. Nothing is
 * authorised from here: every read still carries a live token that the engine
 * verifies, and every write is refused or allowed server-side regardless of
 * what this says.
 *
 * **It ages out.** A browser left closed for a week should not open on a
 * year-old idea of who somebody is, however briefly.
 */

/** Bumped when the shape changes, so an old entry is ignored rather than read. */
const VERSION = 1;
const KEY = "cowork:session:identity";

/**
 * How long a remembered identity may be used for the first paint.
 *
 * Twelve hours: long enough to cover a working day of reloads, short enough
 * that somebody returning after a weekend waits the one round trip rather than
 * seeing yesterday's answer first.
 */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface CachedIdentity {
  employeeId: string;
  displayName: string | null;
  email: string | null;
  archetype: string | null;
  landing: string | null;
}

interface Entry extends CachedIdentity {
  v: number;
  uid: string;
  at: number;
}

/**
 * The remembered identity for this Firebase user, or null.
 *
 * `uid` is required rather than optional on purpose: a caller without one has
 * not yet been told who is signed in, and this must not answer that question.
 */
export function readCachedIdentity(
  uid: string | null,
  nowMs: number = Date.now(),
): CachedIdentity | null {
  if (!uid) return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<Entry>;
    if (entry.v !== VERSION) return null;
    if (entry.uid !== uid) return null;
    if (typeof entry.at !== "number" || nowMs - entry.at > MAX_AGE_MS) return null;
    if (typeof entry.employeeId !== "string" || !entry.employeeId) return null;
    return {
      employeeId: entry.employeeId,
      displayName: entry.displayName ?? null,
      email: entry.email ?? null,
      archetype: entry.archetype ?? null,
      landing: entry.landing ?? null,
    };
  } catch {
    /* Private browsing, storage disabled, or a corrupt entry. Worst case the
       reload is as slow as it was before this existed. */
    return null;
  }
}

export function writeCachedIdentity(
  uid: string | null,
  identity: CachedIdentity,
  nowMs: number = Date.now(),
): void {
  if (!uid || !identity.employeeId) return;
  try {
    const entry: Entry = { ...identity, v: VERSION, uid, at: nowMs };
    window.localStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    /* Storage full or disabled — the cache is an optimisation, never a
       requirement, so failing to write it must not fail the sign-in. */
  }
}

/**
 * Forget it.
 *
 * Called on sign-out and whenever the ladder resolves to anonymous — a stale
 * entry surviving a sign-out would show the next person the shell of the last
 * one for a moment, which is the one way this could be worse than the wait it
 * replaces.
 */
export function clearCachedIdentity(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* Nothing to do. */
  }
}
