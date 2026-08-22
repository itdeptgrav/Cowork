"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getRepository, setRepository } from "@/lib/repositories";
import { unregisterFCMToken, useFCMToken } from "@/lib/hooks/useFCMToken";
import { LegacyRepository, toCoworkRepository } from "@/lib/repositories/legacy";
import { startTaskWatch } from "@/lib/repositories/legacy/taskWatch";
import {
  PROFILE_STORAGE_KEY,
  PROFILE_SWITCHER_ENABLED,
} from "@/lib/config/profileSwitcher";
import { LENS_STORAGE_KEY } from "@/components/layout/shell/LensContext";
import { archetypeForLegacyRole, LEGACY_LANDING } from "@/lib/auth/roleMap";
import { fetchIdentity } from "@/lib/legacy/auth";
import { applyRuleOverrides } from "@/lib/config/settings";
import type { User } from "firebase/auth";
import {
  currentUser,
  idToken,
  signOut as firebaseSignOut,
  watchAuth,
  watchIdToken,
} from "@/lib/legacy/firebase";
import { isConfigured } from "@/lib/legacy/config";
import { PUBLIC_ENV } from "@/lib/legacy/publicEnv";
import { clearFirebaseCookie, writeFirebaseCookie } from "@/lib/auth/firebaseCookie";
import {
  clearCachedIdentity,
  clearSignedInUid,
  forgetAccountScopedState,
  leaveSignInNotice,
  noteSignedInUid,
  readCachedIdentity,
  writeCachedIdentity,
} from "@/lib/auth/sessionCache";
import { notifyRepositoryChanged } from "@/lib/repositories/events";
import { settledWithin } from "@/lib/rules/tasks/writeTimeout";
import type { RoleArchetype } from "@/lib/domain";

/**
 * Who the browser is acting as, according to the server.
 *
 * This is the join the brief asked for: without it the workspace would keep
 * resolving identity from `actingId()` — a module variable the dev profile
 * switcher writes — and the sign-in page would be decoration over an app that
 * still answered as whoever the fixture named. Signing in has to change who the
 * repository *is*, or it has changed nothing.
 *
 * The sequence on mount is deliberate and its order is load-bearing:
 *
 *   1. Ask the server who we are. The cookie is httpOnly and carries no claims,
 *      so this round trip is the only way to find out.
 *   2. Provision the workspace identity if it does not exist yet.
 *   3. Point the repository at it.
 *   4. Only then let the tree render data.
 *
 * Rendering before step 3 would let a page mount and fetch as the seeded
 * default, then swap — which is a real leak, not a flicker: the first render's
 * queries would have run under somebody else's identity.
 */

export interface SessionState {
  /**
   * `stalled` is the fourth state, and it exists because the other three could
   * not describe what was actually happening.
   *
   * Resolving a session waits on three things that can each fail without ever
   * returning: the SDK restoring a persisted session, a token refresh against
   * Google, and `/cowork/me`. A transport failure on any of them is genuinely
   * NOT anonymity — treating it as such signs somebody out because their wifi
   * blinked — so the code left the status at `loading`, which renders "Signing
   * you in…" for as long as the tab is open.
   *
   * That is the reported fault, and it is why it happened in a normal browser
   * and not in incognito: incognito has no persisted session to fail on.
   * `stalled` says "we could not finish, and here is the way out" instead.
   */
  status: "loading" | "authenticated" | "anonymous" | "stalled";
  employeeId: string | null;
  displayName: string | null;
  email: string | null;
  archetype: RoleArchetype | null;
  /** Where this person's role says they belong. Computed server-side. */
  landing: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Why the resolution stalled, for the screen that offers a way out. */
  stallReason: string | null;
  /**
   * WHAT stalled, so the way out can match it.
   *
   * `network` means the workspace could not be reached — the saved session is
   * very probably fine, and signing out would destroy a good one. `session`
   * means the stored sign-in itself did not restore. The two need different
   * advice, and offering "Sign in again" for the first is actively harmful.
   */
  stallKind: "network" | "session" | null;
}

const Ctx = createContext<SessionState>({
  status: "loading",
  employeeId: null,
  displayName: null,
  email: null,
  archetype: null,
  landing: null,
  refresh: async () => {},
  signOut: async () => {},
  stallReason: null,
  stallKind: null,
});

export function useSession(): SessionState {
  return useContext(Ctx);
}

/**
 * The live task listeners' unsubscribe, held at module scope.
 *
 * Module scope rather than a ref because the repository it feeds is a module
 * singleton too — one session, one set of listeners, regardless of how many
 * providers happen to mount. A ref would make the watch per-provider, and a
 * second `SessionProvider` anywhere in the tree would double every push.
 *
 * A promise, not a function, because starting is async — `startTaskWatch`
 * imports the Firestore SDK. Storing the promise means a stop that lands
 * mid-start still waits for the listeners and detaches them, rather than
 * missing them and leaving them attached forever.
 */
let taskWatchStop: Promise<() => void> | null = null;

async function stopTaskWatch(): Promise<void> {
  const pending = taskWatchStop;
  taskWatchStop = null;
  if (!pending) return;
  try {
    (await pending)();
  } catch {
    /* The start failed, so there is nothing attached to detach. */
  }
}

interface Payload {
  authenticated: boolean;
  /**
   * WHY there is no session, when there is none.
   *
   * `no-session` is nobody signed in — the ordinary case, and nothing to say
   * about it. `refused` is the engine answering that this Firebase user is not
   * an employee of this Cowork, and it needs a sentence: the person typed a
   * correct password, watched the app think about it, and arrived back at the
   * sign-in form. Without this that round trip is silent, and it looks exactly
   * like the form ignoring them.
   */
  reason?: "no-session" | "refused";
  employeeId?: string;
  displayName?: string;
  email?: string;
  archetype?: RoleArchetype;
  landing?: string;
  organisationId?: string;
  organisationName?: string;
}

/**
 * How many times a failed resolution is retried before the app says so.
 *
 * Was three, which with this backoff gave up after about four seconds — far too
 * eager for the overwhelmingly common cause, a request that lost a race with a
 * sleeping laptop's network coming back. Five spans roughly eighteen seconds,
 * and a network stall now also heals itself when the connection returns, so
 * running out of attempts is no longer a dead end.
 */
const MAX_LOAD_ATTEMPTS = 5;
const RETRY_BASE_MS = 1_200;

/**
 * The workspace could not be REACHED — as opposed to refusing us.
 *
 * `/cowork/me` answering 401 or 403 is an answer: this person is not an employee
 * here, and the session resolves to anonymous. A transport failure is not an
 * answer at all, and the two were previously indistinguishable by the time they
 * reached `load` — both arrived as a bare `Error`, so a signed-in person whose
 * connection blinked was told their saved sign-in was stale and offered a button
 * that signs them out.
 *
 * That is the "Sign in again straight after signing in" report: three quick
 * failures inside about four seconds and the session went terminal, even though
 * nothing was wrong with it.
 */
class WorkspaceUnreachable extends Error {
  readonly kind = "network" as const;
}


/**
 * How long the whole resolution may take before it is called stalled.
 *
 * The retry ladder above only runs when something REJECTS. The worse failure is
 * one that never settles at all: `onAuthStateChanged` not firing because the
 * SDK is wedged restoring a corrupt persisted session, which is precisely the
 * case that distinguishes a normal browser from incognito. Nothing throws
 * there, so nothing retries, and the status stays `loading` forever.
 *
 * This watchdog is the only thing that catches that, which is why it is a wall
 * clock started at mount rather than a timeout on any particular await.
 */
/**
 * How long any ONE enrichment step may take before the sign-in stops waiting.
 *
 * Comfortably longer than a healthy Firestore round trip, and chosen so that
 * ALL FOUR steps timing out in sequence still finishes inside the resolution
 * watchdog — 4 x 6s = 24s against 30s. At 8s each the worst case was 32s, so a
 * completely unreachable Firestore would have tripped the watchdog and shown a
 * failure screen to somebody whose sign-in was about to succeed.
 */
const SESSION_STEP_TIMEOUT_MS = 6_000;

const RESOLVE_WATCHDOG_MS = 30_000;

/**
 * How long to wait for `onAuthStateChanged` before asking Firebase directly.
 *
 * `watchAuth` is the SOLE trigger for resolution, and that is a single point of
 * failure: if the callback never arrives, `load` is never called, nothing
 * rejects, nothing retries, and the app sits on "Signing you in…". Every other
 * step is bounded — `idToken` times out at 10s, `legacyFetch` at 20s, and a
 * `/cowork/me` refusal resolves to anonymous — so a listener that does not fire
 * is the only way to stay `loading`.
 *
 * The kick below only acts when `currentUser()` is already non-null, which means
 * the SDK has finished restoring. That is exactly the condition the
 * wait-for-Firebase rule exists to establish, so asking then cannot reintroduce
 * the bounce it was written to prevent — it just stops us waiting for a
 * notification about something that has already happened.
 */
const AUTH_LISTENER_GRACE_MS = 2_500;

export function SessionProvider({
  children,
  /**
   * The sign-in and sign-up routes render their own shell and must not wait on
   * a session they are in the business of creating.
   */
  anonymous = false,
}: {
  children: ReactNode;
  anonymous?: boolean;
}) {
  const [state, setState] = useState<Omit<SessionState, "refresh" | "signOut">>(
    {
      status: anonymous ? "anonymous" : "loading",
      employeeId: null,
      displayName: null,
      email: null,
      archetype: null,
      landing: null,
      stallReason: null,
      stallKind: null,
    },
  );

  /* Attempts made at resolving THIS session, and the timer holding the next
     one. Refs rather than state: neither should cause a render, and both must
     survive the re-renders that `setState` above triggers. */
  const attempts = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Whether resolution ever BEGAN. The watchdog and the retry ladder catch
     different failures and must not catch each other's — see both. */
  const started = useRef(false);

  const load = useCallback(async () => {
    if (anonymous) return;
    started.current = true;
    /**
     * The prototype session — development only, and off unless asked for.
     *
     * The mock store is the world the whole test suite runs against, and it was
     * reachable from Node and from nowhere else: every route redirects to
     * `/signin`, and signing in installs the legacy repository over it. With
     * `NEXT_PUBLIC_MOCK_SESSION=1` the workspace opens as the seed's current
     * employee against the mock store, so a chain can be clicked through.
     *
     * It authorises nothing: the mock repository applies its own permission
     * checks against whichever identity this resolves to.
     */
    if (
      process.env.NODE_ENV !== "production" &&
      process.env.NEXT_PUBLIC_MOCK_SESSION === "1"
    ) {
      /* Restore who the prototype bar last chose BEFORE the first read —
         `setActingEmployee` is what every query and permission resolves
         against, so applying it after would show one person's name over
         another person's data. */
      if (PROFILE_SWITCHER_ENABLED) {
        const chosen = window.localStorage.getItem(PROFILE_STORAGE_KEY);
        if (chosen) getRepository().setActingEmployee?.(chosen);
      }
      const employee = await getRepository().getCurrentEmployee();
      setState({
        status: "authenticated",
        employeeId: employee?.id ?? null,
        displayName: employee
          ? `${employee.firstName} ${employee.lastName}`
          : "Prototype",
        email: employee?.email ?? null,
        archetype: null,
        landing: "/home",
        stallReason: null,
        stallKind: null,
      });
      return;
    }
    try {
      /**
       * **A different person is signed in, so the last one's residue goes.**
       *
       * Firebase holds one user per browser profile, so signing in as somebody
       * else replaces the session — but `localStorage` survives it, and a hard
       * navigation only clears React state and module singletons. The second
       * person inherited the first's acting profile, lens, announced
       * assignments and "this browser was the one sharing" claim, which reads
       * as the app showing them somebody else's workspace.
       *
       * Before the cache is read, so a switch can never be answered from what
       * the previous account left behind.
       */
      if (noteSignedInUid(currentUser()?.uid ?? null)) {
        forgetAccountScopedState([PROFILE_STORAGE_KEY, LENS_STORAGE_KEY]);
      }
      /**
       * **Paint from what we already knew, then go and check.**
       *
       * Nothing about the sign-in expires — Firebase holds the session and
       * `onIdTokenChanged` keeps the mirrored cookie live. What was never kept
       * is the ANSWER: which workspace employee this Firebase user is. So every
       * reload sat on "Signing you in…" through `/cowork/me` and the enrichment
       * behind it, re-earning an identity it had a moment ago.
       *
       * The uid comes from the SDK's own restored session, never from this
       * cache and never from the cookie — this is not used to GUESS who is
       * signed in, only to skip re-deriving it for somebody Firebase has
       * already named. The ladder below still runs in full and overwrites all
       * of this, so a role change or a transfer corrects itself within one
       * round trip, and nothing is authorised from here: every read still
       * carries a live token the engine verifies.
       */
      const remembered = readCachedIdentity(currentUser()?.uid ?? null);
      if (remembered) {
        setRepository(
          toCoworkRepository(
            new LegacyRepository({
              getToken: () => idToken().catch(() => null),
              employeeId: remembered.employeeId,
              legacyRole: legacyRoleOf(
                (remembered.archetype as RoleArchetype | null) ?? undefined,
              ),
              archetype: remembered.archetype as RoleArchetype | null,
              hasManager: false,
            }),
          ),
        );
        setState({
          status: "authenticated",
          employeeId: remembered.employeeId,
          displayName: remembered.displayName,
          email: remembered.email,
          archetype: remembered.archetype as RoleArchetype | null,
          landing: remembered.landing,
          stallReason: null,
          stallKind: null,
        });
      }

      const data = await readIdentityPayload();

      if (!data.authenticated || !data.employeeId) {
        attempts.current = 0;
        /* The remembered identity goes with it. A stale entry surviving a
           sign-out would show the next person the shell of the last one. */
        clearCachedIdentity();
        /**
         * **And the cookie, or this becomes an infinite redirect.**
         *
         * `readIdentityPayload` writes the Firebase cookie BEFORE asking
         * `/cowork/me`, so that middleware's copy stays fresh through the SDK's
         * silent refreshes. When the engine then refuses the token — a real
         * answer, meaning this person is not an employee of this Cowork — the
         * cookie is left behind, valid and signed.
         *
         * The shell reads `anonymous` and navigates to `/signin`. `proxy.ts`
         * sees the still-valid cookie and sends it straight back to `/home`.
         * The screen alternates between "Signing you in…" and "Redirecting to
         * sign in…" for ever, and the sign-in form — the one thing that could
         * fix it — is the one page the person can never reach.
         *
         * The credential that no longer buys anything is dropped here, so the
         * redirect lands where it was aimed.
         */
        clearFirebaseCookie();
        /**
         * And a sentence to arrive with.
         *
         * `refused` means the password was RIGHT and the workspace still said
         * no — the account is not an employee of this Cowork. Landing back on
         * the form with nothing said is indistinguishable from a button that
         * did nothing, which is what "it just keeps sending me back to sign in"
         * describes. `no-session` leaves nothing: there is nothing to explain
         * about a browser that was simply not signed in.
         */
        if (data.reason === "refused")
          leaveSignInNotice(
            "That account signed in, but it is not registered as an employee of this workspace. Ask an administrator to add it, or sign in with your work account.",
          );
        setState({
          status: "anonymous",
          employeeId: null,
          displayName: null,
          email: null,
          archetype: null,
          landing: null,
          stallReason: null,
          stallKind: null,
        });
        return;
      }

      /* **Install the legacy-backed repository before anything reads.**
         From here the workspace answers from the Cowork engine rather than the
         mock store. Done at this point, and not earlier, because the repository
         needs the acting identity and a way to get a live token — neither of
         which exists until `/cowork/me` has answered.

         The token is fetched per call rather than captured: the Firebase SDK
         refreshes on its own schedule, and a token held here would go stale
         while the page stayed open. */
      setRepository(
        toCoworkRepository(
          new LegacyRepository({
            getToken: () => idToken().catch(() => null),
            employeeId: data.employeeId,
            legacyRole: legacyRoleOf(data.archetype),
            /* The archetype ITSELF, for authorisation.
               `legacyRole` above is derived FROM it by a lossy mapping, so the
               repository inferring "administrator" back out of `"ceo"` was a
               round trip that could only lose information. Authorisation reads
               the original. */
            archetype: data.archetype,
            /* Legacy exposes managers only through a per-employee call, so this
               is not known here. `false` withholds the self-reorder control
               rather than offering one the engine would refuse. */
            hasManager: false,
          }),
        ),
      );

      /* Provision before pointing the repository at the id, so the very first
         query finds a real employee rather than falling through to the seeded
         default. */
      const repo = getRepository();
      /**
       * **Bounded, because a Firestore read does not reject when it cannot
       * reach the server — it stays pending.**
       *
       * Everything from here to the `setState` below is ENRICHMENT: who you are
       * is already known and the repository is already installed. But each step
       * was awaited without a bound, so one unreachable Firestore call left the
       * whole sign-in unfinished and the app on "Signing you in…" forever —
       * nothing rejected, so the retry ladder never ran and the watchdog
       * reported `listenerFired: true, firebaseHasUser: true`, which is exactly
       * the state that describes.
       *
       * A timeout here costs a provisioning write that will happen on the next
       * load anyway. Not timing out costs the workspace.
       */
      await settledWithin(
        repo.ensureSessionEmployee({
          employeeId: data.employeeId,
          displayName: data.displayName ?? "Administrator",
          email: data.email ?? "",
          archetype: data.archetype ?? "employee",
          organisationName: data.organisationName ?? "",
          organisationId: data.organisationId ?? "",
        }),
        SESSION_STEP_TIMEOUT_MS,
      ).catch(() => null);
      /* Employee AND organisation together. Setting the employee alone would
         leave the repository answering for whichever tenant it last saw, which
         is precisely the cross-tenant read this phase exists to prevent. */
      repo.setActingContext?.({
        employeeId: data.employeeId,
        organisationId: data.organisationId ?? "",
      });

      /* **Go live.**
       *
       * From here `cowork_tasks` is watched with the same listeners the old app
       * runs, and every push invalidates the repository so open task queries
       * re-run. Without this the new UI read once and then held a snapshot:
       * a task approved in old Cowork, or by a colleague, or by the engine
       * itself, sat unchanged on screen until something unrelated happened to
       * refetch.
       *
       * Started here, after the acting context, because the listeners are
       * scoped by employee id and role — attaching earlier would watch the
       * previous session's queries. Any previous watch is stopped first, so a
       * re-auth (token refresh, profile switch) replaces rather than
       * accumulates listeners; leaked ones would each fire an invalidation and
       * turn one change into several refetches. */
      /* Bounded for the same reason: this awaits a PREVIOUS `startTaskWatch`
         promise, and one that never resolved would hold the sign-in open
         indefinitely. A timeout may leak that watch; an unusable workspace is
         the worse trade. */
      await settledWithin(stopTaskWatch(), SESSION_STEP_TIMEOUT_MS).catch(
        () => null,
      );
      taskWatchStop = startTaskWatch({
        employeeId: data.employeeId,
        role: String(legacyRoleOf(data.archetype) ?? "employee"),
      }).catch((error: unknown) => {
        console.error("[taskWatch] could not start:", error);
        return () => {};
      });

      /* **Published rule values, before anything scores.**
       *
       * The engine reads rule values through a module-level map in
       * `lib/config/settings.ts`, and nothing used to populate it from storage —
       * so an administrator published a value, the card showed it, and a refresh
       * silently restored the seeded placeholder. Two people could see different
       * numbers for the same rule depending on who had reloaded most recently.
       *
       * Loaded here, at the same point the repository goes live and before the
       * first query runs, because a score computed between mount and this read
       * would use the placeholder. Failure is swallowed deliberately: the seeded
       * defaults are a working configuration, and refusing to load the workspace
       * because one settings document was unreachable would be a worse trade. */
      try {
        const overrides = await settledWithin(
          repo.getRuleOverrides(),
          SESSION_STEP_TIMEOUT_MS,
        );
        if (overrides) applyRuleOverrides(overrides);
      } catch {
        /* No document yet, or unreachable. The seeded placeholders apply, which
           is what `readRuleOverrides` returns for an absent document anyway. */
      }

      /* Then everyone ELSE in the organisation.
       *
       * The workspace store is per-browser, so it only ever knew the seed plus
       * whoever had signed in on this machine. A colleague created in another
       * browser existed server-side and was absent here — which is why an
       * administrator could open People and not find somebody who could sign in
       * perfectly well. The identity store is the only shared record of who
       * exists, so it is what the workspace reconciles against.
       *
       * Failure is deliberately swallowed. This widens the directory; it is
       * never what authorises anything, and a workspace that refused to load
       * because one supplementary fetch failed would be a worse trade than a
       * People list that is briefly short. */
      try {
        /* The whole widening bounded ONCE rather than each await inside it.
           Three round trips — the fetch, reading its body, and a Firestore
           write — are one logical step from the session's point of view, and
           bounding them separately would let a fully unreachable backend spend
           three timeouts here and trip the resolution watchdog. */
        const widened = await settledWithin(
          (async () => {
            const dir = await fetch("/api/auth/directory", { cache: "no-store" });
            if (!dir.ok) return false;
            const body = (await dir.json()) as {
              ok?: boolean;
              organisationName?: string;
              members?: {
                employeeId: string;
                displayName: string;
                email: string;
                archetype: RoleArchetype;
                isFounder?: boolean;
              }[];
            };
            if (body.ok && body.members?.length) {
              await repo.ensureDirectoryEmployees(
                body.members,
                body.organisationName ?? data.organisationName ?? "",
                data.organisationId ?? "",
              );
            }
            return true;
          })(),
          SESSION_STEP_TIMEOUT_MS,
        );
        if (widened === null) {
          console.warn("[session] directory widening timed out; continuing.");
        }
      } catch {
        /* Offline, or the route is unreachable. Nothing to repair here. */
      }

      /* A success ends the retry sequence, so a later failure gets its own full
         allowance rather than inheriting a spent one. */
      attempts.current = 0;
      setState({
        status: "authenticated",
        employeeId: data.employeeId,
        displayName: data.displayName ?? null,
        email: data.email ?? null,
        archetype: data.archetype ?? null,
        landing: data.landing ?? "/home",
        stallReason: null,
        stallKind: null,
      });
      /* Remembered only once the ladder has ANSWERED, so what is kept is a
         verified identity rather than a guess — and so a resolution that ended
         in a stall or a refusal leaves the previous entry to age out on its own
         rather than replacing it with something worse. */
      writeCachedIdentity(currentUser()?.uid ?? null, {
        employeeId: data.employeeId,
        displayName: data.displayName ?? null,
        email: data.email ?? null,
        archetype: data.archetype ?? null,
        landing: data.landing ?? "/home",
      });
      notifyRepositoryChanged();
    } catch (error) {
      /**
       * A failed session read is NOT anonymity — treating it as such would sign
       * somebody out because their wifi blinked. But it is not `loading`
       * either, and leaving it there is what stranded people on "Signing you
       * in…" with nothing behind it and no way back.
       *
       * So: retry, because most of these are transient, and then say so. The
       * distinction the original comment drew is preserved — this never
       * silently becomes "anonymous" — it simply stops pretending to still be
       * in progress once it is not.
       */
      attempts.current += 1;
      if (attempts.current < MAX_LOAD_ATTEMPTS) {
        const backoffMs = RETRY_BASE_MS * 2 ** (attempts.current - 1);
        retryTimer.current = setTimeout(() => void load(), backoffMs);
        return;
      }
      const unreachable = error instanceof WorkspaceUnreachable;
      setState((prev) => ({
        ...prev,
        status: "stalled",
        stallKind: unreachable ? "network" : "session",
        stallReason: unreachable
          ? "The workspace could not be reached. Your sign-in is almost certainly fine — this is the connection."
          : error instanceof Error
            ? error.message
            : "The workspace could not confirm who you are.",
      }));
    }
  }, [anonymous]);

  /* Deferred a microtask before starting, the same way `ProfileSwitcher`
     restores its saved profile. `load` awaits a fetch before it ever sets
     state, so nothing here is synchronous in practice — but the effect body
     calling into something that *can* setState is the shape the analyser
     rejects, and it is right that the shape should be explicit rather than
     depending on a reader noticing the `await` two functions away. */
  useEffect(() => {
    /* **Firebase decides when to ask, not us.**
     *
     * The SDK restores a persisted session asynchronously, so `currentUser` is
     * null for the first moments after mount — including on every reload. An
     * eager `load()` therefore resolved "anonymous" for somebody who was signed
     * in, and `WorkspaceShell` acted on it and navigated to `/signin` before the
     * SDK had finished. That is the bounce: signed in, sent to sign in.
     *
     * `onAuthStateChanged` fires exactly once after restoration settles — with
     * the user, or with null — and again on every later change. It is the only
     * honest "now you may ask" signal, so it is the sole trigger.
     *
     * The sign-in page is the exception: mounted `anonymous`, it resolves
     * nothing, because it exists to create the session rather than read one. */
    if (anonymous || !isConfigured(PUBLIC_ENV)) return;
    /* The user object is deliberately ignored: `load()` re-reads the identity
       from the SDK itself, so acting on the callback's snapshot would be a
       second source of truth for the same question. */
    return watchAuth(() => {
      void load();
    });
  }, [anonymous, load]);

  /**
   * **A second way in, because `watchAuth` is a single point of failure.**
   *
   * Everything else in this resolution is bounded: `idToken` times out at 10s,
   * `legacyFetch` at 20s, and a `/cowork/me` refusal resolves to anonymous. So
   * the ONLY way to sit on "Signing you in…" is for `onAuthStateChanged` never
   * to fire — `load` is then never called, nothing rejects, and nothing retries.
   *
   * That is the reported fault: already signed in, open another tab, and the new
   * one waits forever for a notification about a restoration that had already
   * happened before the listener attached.
   *
   * The guard is what makes this safe. It acts only when `currentUser()` is
   * already non-null, which means the SDK HAS finished restoring — precisely the
   * condition the wait-for-Firebase rule exists to establish. So this cannot
   * reintroduce the "signed in, sent to sign in" bounce that rule prevents; a
   * null `currentUser` is still left entirely to the listener.
   */
  useEffect(() => {
    if (anonymous || !isConfigured(PUBLIC_ENV)) return;
    const kick = setTimeout(() => {
      if (started.current) return; // the listener did its job
      if (!currentUser()) return; // genuinely not signed in — not ours to answer
      console.warn(
        "[session] onAuthStateChanged did not fire within",
        AUTH_LISTENER_GRACE_MS,
        "ms but Firebase has a user — resolving directly.",
      );
      void load();
    }, AUTH_LISTENER_GRACE_MS);
    /* The handle is named `kick` rather than the obvious thing, and that is
       deliberate: two tests in `authPersistence.test.ts` locate the resolution
       watchdog by searching the source for its timer declaration, and this
       effect sits earlier in the file. Sharing the name pointed them at this
       block instead, where they read the early return above as the watchdog
       standing down — the one thing they exist to forbid. */
    return () => clearTimeout(kick);
  }, [anonymous, load]);

  /**
   * Keep the Edge's cookie copy alive across the SDK's silent token refreshes.
   *
   * `load` runs on `onAuthStateChanged`, which does NOT fire when Firebase renews
   * the one-hour token on its own — so on that path alone the mirrored cookie
   * ages out mid-session and the middleware bounces a signed-in person to the
   * sign-in page (the reported `/messages` bounce). `onIdTokenChanged` fires on
   * every refresh; re-writing the cookie there keeps the token the Edge sees as
   * live as the one the client holds.
   *
   * The visibility handler closes the other gap: a tab left untouched past the
   * refresh window is given a fresh cookie the instant it is looked at again, so
   * the first navigation after a long idle does not race an expired copy to the
   * gate. Both are cheap — `getIdToken()` is a local read unless the token has
   * actually expired.
   */
  useEffect(() => {
    if (anonymous || !isConfigured(PUBLIC_ENV)) return;
    const refresh = (user: User | null) => {
      if (!user) {
        clearFirebaseCookie();
        return;
      }
      void user
        .getIdToken()
        .then(writeFirebaseCookie)
        .catch(() => {
          /* A failed refresh is not a sign-out: `load` owns that decision. */
        });
    };
    const unwatch = watchIdToken(refresh);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh(currentUser());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unwatch();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [anonymous]);

  /**
   * The watchdog, and the reason it is a wall clock rather than a timeout on
   * any particular await.
   *
   * The retry ladder in `load` only runs when something REJECTS. The failure
   * that stranded people rejects nothing: `onAuthStateChanged` never fires,
   * because the SDK is wedged restoring a persisted session, so `load` is never
   * called and there is nothing to catch. The status simply stays `loading`
   * until the tab is closed.
   *
   * That is exactly the difference between a normal browser and incognito —
   * incognito has no persisted session to wedge on — and it is why this is
   * measured from mount rather than from any request.
   */
  useEffect(() => {
    if (anonymous) return;
    const timer = setTimeout(() => {
      /* **Fires regardless of whether resolution began, and that is the fix.**
         The previous version skipped when `load` had started, on the reasoning
         that the retry ladder owned the outcome. That left the actual fault
         uncaught: the ladder only runs when something REJECTS, so a `load` that
         hangs mid-await — on a fetch with no timeout, on an SDK call that never
         settles — was caught by neither. Nothing rejected, so nothing retried;
         `started` was true, so nothing watched. That is a permanent spinner,
         which is precisely the reported symptom.

         So this is now an unconditional backstop on the WHOLE resolution. It is
         set long enough to sit past a healthy retry ladder, and if a late
         attempt does succeed it simply replaces this state with an
         authenticated one. Showing a way out after this long is right even when
         something is still technically in flight: thirty seconds of "Signing
         you in…" is already a failure to the person watching it. */
      /* Diagnostic, because this is the state nobody could explain from the
         outside — the screen said the same thing whether Firebase never
         answered, the token never refreshed or the engine never replied. */
      console.warn("[session] resolution watchdog fired", {
        listenerFired: started.current,
        firebaseHasUser: !!currentUser(),
        afterMs: RESOLVE_WATCHDOG_MS,
      });
      setState((prev) =>
        prev.status === "loading"
          ? {
              ...prev,
              status: "stalled",
              stallKind: "session",
              stallReason:
                "Your saved sign-in did not finish restoring. This usually means the stored session is stale.",
            }
          : prev,
      );
    }, RESOLVE_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [anonymous]);

  /* A pending retry must not outlive the provider — it would setState on an
     unmounted tree and, worse, keep resolving a session nobody is waiting for. */
  useEffect(() => {
    return () => {
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    };
  }, []);

  /**
   * A deliberate re-ask, with a fresh allowance.
   *
   * Separate from `load` because the retry ladder must not reset itself:
   * `load` calls itself on failure, so clearing the counter there would turn a
   * bounded ladder into an unbounded loop. Somebody pressing "Try again" is a
   * different event from the code retrying, and deserves the full allowance.
   */
  const retry = useCallback(async () => {
    if (retryTimer.current !== null) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    attempts.current = 0;
    setState((prev) =>
      prev.status === "stalled"
        ? { ...prev, status: "loading", stallReason: null, stallKind: null }
        : prev,
    );
    await load();
  }, [load]);

  /**
   * A network stall heals itself when the connection comes back.
   *
   * Without this, running out of attempts was terminal: the person sat on
   * "Signing you in did not finish" until they pressed a button, even after
   * their wifi returned seconds later. Worse, the button most likely to be
   * pressed was "Sign in again", which throws away a session that was never
   * broken.
   *
   * Only for `network` stalls. A genuinely stale stored session will fail again
   * the same way, and retrying it on every tab focus would be a loop that never
   * reaches the screen offering the real way out.
   */
  useEffect(() => {
    if (anonymous) return;
    if (state.status !== "stalled" || state.stallKind !== "network") return;

    const again = () => {
      /* Asking while still offline just spends an attempt and re-stalls. */
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      void retry();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") again();
    };

    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [anonymous, state.status, state.stallKind, retry]);

  const signOut = useCallback(async () => {
    /* Firebase holds the identity now, so this is what actually ends the
       session. The local cookie is cleared too — it is vestigial until the
       `/api/auth/*` routes are removed, and leaving a signed cookie behind
       after a sign-out is the kind of thing nobody finds until it matters. */
    /* Detach the task listeners BEFORE dropping the credential. A listener
       outliving its session keeps a permission-denied query retrying against
       Firestore, and it would still be holding the previous person's employee
       id at a shared desk. */
    await stopTaskWatch();
    /* **Before the credential goes.** The token is filed under the person
       signing out and the Firestore write that removes it is authorised by the
       session being ended — after `firebaseSignOut` it is simply refused, and
       the entry stays. A token identifies a BROWSER, so one left behind keeps
       delivering this person's notifications to whoever signs in next at the
       same desk. */
    await unregisterFCMToken(state.employeeId);
    await firebaseSignOut().catch(() => {});
    clearFirebaseCookie();

    /* Drop the per-browser identity carriers.
     *
     * The hard navigation below clears React state and every module singleton,
     * but `localStorage` survives it — so a saved acting-profile id and a saved
     * lens outlived the person who chose them. The next account to sign in on
     * this machine inherited both, which on a shared desk reads as the app
     * showing somebody else's identity. */
    /* One list, shared with the account-switch path — see
       `forgetAccountScopedState`. These two had drifted: signing out cleared
       three keys and switching account cleared none, so the residue that
       mattered depended on how the last person left. */
    forgetAccountScopedState([PROFILE_STORAGE_KEY, LENS_STORAGE_KEY]);
    /* And the record of WHO was here, or the next sign-in would look like a
       continuation of this one and skip the wipe above. */
    clearSignedInUid();
    await fetch("/api/auth/signout", { method: "POST" }).catch(() => {});
    /* A hard navigation, not a router push: it drops every module singleton
       holding the old identity — the repository's acting id, the mock store,
       every cached query — which a client-side transition would leave in
       memory for the next person at this desk. */
    window.location.href = "/signin";
  }, []);

  /* **Push registration, once the identity is known.**
     Deliberately here rather than in the shell: this is the one place that
     knows who the session belongs to, and a token has to be filed against an
     employee to be reachable. It is a no-op until `employeeId` resolves, and a
     no-op forever if the browser has no Push API or the person has refused —
     none of which affects the in-app bell, which reads Firestore directly. */
  useFCMToken(state.employeeId);

  return (
    <Ctx.Provider value={{ ...state, refresh: retry, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

/**
 * The legacy system's single organisation.
 *
 * Legacy has **no tenant concept** — `organizationId` exists only inside the
 * accounting product, and Cowork, HR and SOP are single-tenant. So every account
 * from this engine belongs to one synthetic organisation, named here rather than
 * left blank: the repository scopes reads by it, and an empty string would let
 * two differently-scoped records look alike.
 */
export const LEGACY_ORGANISATION_ID = "org-legacy-cowork";
export const LEGACY_ORGANISATION_NAME = "Cowork";

/**
 * Who the browser is, according to Firebase and the legacy engine.
 *
 * The only thing this migration changed. Everything downstream — provisioning,
 * the acting context, the directory reconciliation, the published
 * `SessionState` — is untouched, which is why no page, component or token
 * needed editing.
 *
 * Two steps, and both are necessary. Firebase says *who signed in*; `/cowork/me`
 * says *who that is at work* — the employee id and the role. A Firebase account
 * with no `cowork_employees` record is authenticated and has no authority, and
 * the engine answers that with a 403, which reads here as not-signed-in rather
 * than as an error.
 */
async function readIdentityPayload(): Promise<Payload> {
  if (!isConfigured(PUBLIC_ENV)) return { authenticated: false, reason: "no-session" };

  /* A rejected token read is not an error to surface: it means no usable
     session, which the caller handles as unauthenticated. */
  const token = await idToken().catch(() => null);
  if (!token) {
    clearFirebaseCookie();
    return { authenticated: false, reason: "no-session" };
  }
  /* Mirror it where middleware can see it. Written on every resolution, not
     only at sign-in, so the SDK's silent refreshes keep the Edge's copy live —
     otherwise the cookie would age out mid-session and bounce a signed-in
     person to the sign-in page. */
  writeFirebaseCookie(token);

  const result = await fetchIdentity(token);
  if (!result.ok) {
    /* A refusal is a real answer: this person is not an employee of this
       Cowork. A transport failure is not, and must not sign anybody out — so
       it throws, and `load`'s catch leaves the session in `loading`. */
    if (result.error.kind === "auth" || result.error.kind === "permission") {
      return { authenticated: false, reason: "refused" };
    }
    /* Tagged, so `load` can tell "we could not reach it" from "the saved
       sign-in is stale" — they need opposite advice. */
    if (result.error.kind === "network") {
      throw new WorkspaceUnreachable(result.error.message);
    }
    throw new Error(result.error.message);
  }

  const identity = result.data;
  return {
    authenticated: true,
    employeeId: String(identity.employeeId),
    displayName: identity.name,
    /* `GET /cowork/me` does not carry an email — it is on the directory record,
       not the session. Omitted rather than guessed; the shell renders the name. */
    email: undefined,
    archetype: archetypeForLegacyRole(identity.role),
    landing: LEGACY_LANDING,
    organisationId: LEGACY_ORGANISATION_ID,
    organisationName: LEGACY_ORGANISATION_NAME,
  };
}

/**
 * The engine's role, back from the archetype.
 *
 * `readIdentityPayload` maps role → archetype so the rest of the product sees
 * one vocabulary; the repository needs the engine's own word for its
 * administrative level. Inverting here keeps the `Payload` contract unchanged,
 * which is what let every consumer of this provider stay untouched.
 */
function legacyRoleOf(archetype: RoleArchetype | undefined): string {
  if (archetype === "system_admin") return "ceo";
  if (archetype === "manager") return "tl";
  return "employee";
}
