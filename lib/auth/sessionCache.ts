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

/* ── One account at a time ─────────────────────────────────────────────────── */

/** The uid this browser last resolved a session for. */
const LAST_UID_KEY = "cowork:auth:lastUid";

/**
 * Everything in `localStorage` that belongs to a PERSON rather than to this
 * machine.
 *
 * The distinction is the whole of it. A theme and a device mode are choices
 * about this screen and should survive whoever is at it; a remembered identity,
 * an acting profile, a lens, "I was the one sharing my screen" and "these
 * assignments have been announced to me" are all about one employee, and
 * carrying them into somebody else's session shows that person another
 * person's workspace.
 *
 * Listed here, once, because the two callers had drifted: signing out cleared
 * three of them and switching account cleared none.
 */
const ACCOUNT_SCOPED_KEYS = [
  KEY,
  /* `lib/status/connectionId.ts` — whether THIS browser put itself online. */
  "cowork:presence:claimedOnlineHere",
  /* `NewAssignmentGate` — which assignments have already been announced. */
  "cowork.assignments.announced.v1",
  /* `useCoworkNotifications` — the task a notification was about. */
  "selectedTaskId",
] as const;

/**
 * Forget the person, keep the machine.
 *
 * Called on sign-out, and on any resolution where the signed-in uid is not the
 * one this browser last resolved for — see `noteSignedInUid`.
 */
export function forgetAccountScopedState(extraKeys: readonly string[] = []): void {
  try {
    for (const key of [...ACCOUNT_SCOPED_KEYS, ...extraKeys])
      window.localStorage.removeItem(key);
  } catch {
    /* Storage disabled. Nothing here is required for correctness of the new
       session — it is the OLD one's residue — so failing to clear it must not
       fail a sign-in. */
  }
}

/**
 * Record who is signed in, and say whether that is somebody new.
 *
 * **Only one account is open at a time, and the previous one leaves nothing
 * behind.** Firebase holds a single user per browser profile, so signing in as
 * somebody else replaces the session — but `localStorage` is not replaced with
 * it. Without this, the second person inherits the first's acting profile,
 * lens, announced assignments and presence claim, and the app shows them a
 * workspace that is partly somebody else's.
 *
 * It answers on the FIRST resolution too: no stored uid and a signed-in user is
 * a switch as far as this is concerned, which is the safe direction — a browser
 * that has never recorded one may still be carrying residue from before this
 * existed.
 */
export function noteSignedInUid(uid: string | null): boolean {
  if (!uid) return false;
  try {
    const previous = window.localStorage.getItem(LAST_UID_KEY);
    window.localStorage.setItem(LAST_UID_KEY, uid);
    return previous !== uid;
  } catch {
    return false;
  }
}

/** Sign-out: the next person must not be treated as a continuation of this one. */
export function clearSignedInUid(): void {
  try {
    window.localStorage.removeItem(LAST_UID_KEY);
  } catch {
    /* Nothing to do. */
  }
}

/* ── Why you were sent back to the sign-in page ────────────────────────────── */

const NOTICE_KEY = "cowork:auth:notice";

/**
 * A sentence for the sign-in page, left by the session that could not resolve.
 *
 * **The silent bounce is the thing this fixes.** Sign in with correct
 * credentials for an account the engine does not recognise as an employee, and
 * the app authenticates, resolves, finds no employee, and returns you to the
 * form — with nothing said. From the outside that is indistinguishable from a
 * form that ignored the button, and it is what "it just keeps going back to
 * sign in" means.
 *
 * `sessionStorage`, not `localStorage`: it belongs to this tab and this attempt,
 * and a reason that outlived either would be shown to somebody it is not about.
 * Read once and removed, so a later visit to the page is not haunted by it.
 */
export function leaveSignInNotice(text: string): void {
  try {
    window.sessionStorage.setItem(NOTICE_KEY, text);
  } catch {
    /* Storage disabled — the person still reaches the form, just without the
       explanation. */
  }
}

/**
 * Read the sentence WITHOUT consuming it.
 *
 * Split from the removal on purpose. The form reads this while it renders, and
 * a render must be repeatable — React renders components twice in development
 * to prove they are, so a read that also deleted would leave the second pass
 * with nothing and the explanation would flash and disappear. Clearing is an
 * effect, which runs once.
 */
export function readSignInNotice(): string | null {
  try {
    return window.sessionStorage.getItem(NOTICE_KEY);
  } catch {
    return null;
  }
}

/** Forget it, so a later visit to the form is not haunted by it. */
export function clearSignInNotice(): void {
  try {
    window.sessionStorage.removeItem(NOTICE_KEY);
  } catch {
    /* Storage disabled. Nothing was stored either. */
  }
}
