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
import { PROFILE_STORAGE_KEY } from "@/lib/config/profileSwitcher";
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
import { notifyRepositoryChanged } from "@/lib/repositories/events";
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
 * Three, with backoff, covers the overwhelmingly common cause — a request that
 * lost a race with a sleeping laptop's network coming back — without leaving
 * somebody watching a spinner through a genuine outage.
 */
const MAX_LOAD_ATTEMPTS = 3;
const RETRY_BASE_MS = 1_200;


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
const RESOLVE_WATCHDOG_MS = 30_000;

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
    try {
      const data = await readIdentityPayload();

      if (!data.authenticated || !data.employeeId) {
        attempts.current = 0;
        setState({
          status: "anonymous",
          employeeId: null,
          displayName: null,
          email: null,
          archetype: null,
          landing: null,
          stallReason: null,
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
      await repo.ensureSessionEmployee({
        employeeId: data.employeeId,
        displayName: data.displayName ?? "Administrator",
        email: data.email ?? "",
        archetype: data.archetype ?? "employee",
        organisationName: data.organisationName ?? "",
        organisationId: data.organisationId ?? "",
      });
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
      await stopTaskWatch();
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
        applyRuleOverrides(await repo.getRuleOverrides());
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
        const dir = await fetch("/api/auth/directory", { cache: "no-store" });
        if (dir.ok) {
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
      setState((prev) => ({
        ...prev,
        status: "stalled",
        stallReason:
          error instanceof Error
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
      setState((prev) =>
        prev.status === "loading"
          ? {
              ...prev,
              status: "stalled",
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
        ? { ...prev, status: "loading", stallReason: null }
        : prev,
    );
    await load();
  }, [load]);

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
    try {
      window.localStorage.removeItem(PROFILE_STORAGE_KEY);
      window.localStorage.removeItem(LENS_STORAGE_KEY);
    } catch {
      /* Storage disabled or full. Signing out must still complete. */
    }
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
  if (!isConfigured(PUBLIC_ENV)) return { authenticated: false };

  /* A rejected token read is not an error to surface: it means no usable
     session, which the caller handles as unauthenticated. */
  const token = await idToken().catch(() => null);
  if (!token) {
    clearFirebaseCookie();
    return { authenticated: false };
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
      return { authenticated: false };
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
