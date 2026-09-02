"use client";

/**
 * The only bridge between React and the repository.
 *
 * `useQuery` and `useAction` are deliberately small: they give every page the
 * loading, empty, error, retry, offline and permission-denied states the brief
 * requires (§15) without pulling in a data library the production build may not
 * want.
 *
 * Both avoid two React 19 anti-patterns on purpose:
 *  · no ref is written or read during render;
 *  · no `setState` is called synchronously inside an effect. Loading is derived
 *    by comparing the settled result's key against the current key, so a deps
 *    change reads as "loading" without a state write to announce it.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getRepository } from "@/lib/repositories";
import {
  getRepositoryVersion,
  notifyRepositoryChanged,
  purgeQueryCaches,
  subscribeToPurgeAll,
  subscribeToRepository,
  subscribeToStaleData,
} from "@/lib/repositories/events";
import type { ActionResult, CoworkRepository } from "@/lib/repositories";

/**
 * Module-level in-flight request deduplication.
 *
 * Without this, multiple components calling the same query simultaneously each
 * fire an independent Firestore round-trip. With it, the first call starts the
 * fetch and stores the Promise; subsequent calls for the same query+deps at the
 * same version attach to that Promise and get the same result — one read, many
 * subscribers. The entry is deleted when the Promise settles, so the next
 * version bump (any mutation) starts fresh.
 *
 * Key = fetcher source text + serialized deps + version. Function source text is
 * stable at runtime (same code → same string), so `r => r.getViewer()` and
 * `r => r.listEmployees()` are distinct even after minification renames `r`.
 */
const inflightCache = new Map<string, Promise<unknown>>();

/**
 * Short-TTL result cache for expensive queries that opt in via `staleTime`.
 *
 * Key = fetcher source + deps (WITHOUT version), so a result fetched at version
 * N is reused at version N+1 if it is still fresh. This prevents a timer
 * heartbeat or an unrelated task mutation from re-running a 3-second Firestore
 * aggregate just to redraw a weekly graph that has not changed.
 *
 * Only populated for queries that pass `staleTime > 0` (explicitly or via the
 * method-default table below).
 */
interface StaleRecord {
  data?: unknown;
  error?: string;
  unavailable?: boolean;
  resolvedAt: number;
}
const staleResultCache = new Map<string, StaleRecord>();

/**
 * One-shot preload cache for optimistic navigation.
 *
 * Mutations that already read back the full entity (e.g. `#write → #readTaskView`)
 * can pre-populate this cache so the detail page loads instantly rather than
 * firing a redundant round-trip. Key = methodName + JSON.stringify(deps).
 *
 * Checked FIRST in the effect, before staleResultCache and inflight dedup.
 * Served once then deleted — it is a hand-off from the mutation, not a cache.
 */
const preloadCache = new Map<string, StaleRecord>();

/**
 * Drop every cached answer for the named repository methods.
 *
 * Registered once at module load rather than per hook: the caches are module
 * singletons, so one subscriber clears them for every mounted query at once.
 * A `useQuery` that is mid-flight is untouched — it is already fetching, and
 * its result is written under the new version.
 */
subscribeToStaleData((methods) =>
  purgeQueryCaches(methods, staleResultCache, preloadCache),
);

/* Sync throws away every cached answer, not just the ones a mutation named. */
subscribeToPurgeAll(() => {
  staleResultCache.clear();
  preloadCache.clear();
});

/**
 * How many reads are in flight, and a way to hear when that changes.
 *
 * Exists so the Sync button can spin for as long as the work actually takes
 * rather than for a guessed interval. A spinner on a timer is a claim about
 * something it never measured: it stops while requests are still running and
 * tells somebody their data is current when it is not — which is the exact
 * question they pressed the button to settle.
 *
 * `inflightCache` already tracks this for deduplication; this only reports it.
 */
const inflightListeners = new Set<() => void>();

export function subscribeToInflight(listener: () => void): () => void {
  inflightListeners.add(listener);
  return () => inflightListeners.delete(listener);
}

export function getInflightCount(): number {
  return inflightCache.size;
}

/** Server render: no request has been made, so nothing is in flight. */
export function getServerInflightCount(): number {
  return 0;
}

function announceInflight(): void {
  for (const l of inflightListeners) l();
}

/**
 * How many reads have failed, ever, in this session.
 *
 * A monotonic counter rather than a flag, because the question Sync asks is
 * "did anything fail **since I pressed the button**" — and a boolean cannot
 * answer that without somebody remembering to clear it, which is a race against
 * the failures it is meant to catch. Comparing two readings of a number that
 * only goes up has no such window.
 */
let queryFailures = 0;

export function getQueryFailureCount(): number {
  return queryFailures;
}

/**
 * Record a failed read, and SAY WHICH ONE in the console.
 *
 * The toast a reader gets is deliberately plain — "some information could not
 * be refreshed" — because a method name means nothing to them and there is
 * nothing they could do with it. But somebody looking at the problem needs
 * exactly that name: without it "sync failed" is a report with no next step,
 * and the only way to find the cause is to guess at which of forty reads it
 * was.
 *
 * `console.warn`, not `error`: the app has already handled this. The screen
 * that owns the read shows its own message, and this line is for whoever opens
 * the console to ask why.
 */
function noteQueryFailure(methodName: string, cause: unknown): void {
  queryFailures += 1;
  const message = cause instanceof Error ? cause.message : String(cause);
  console.warn(
    `[cowork] read failed: ${methodName || "(unnamed query)"} — ${message}`,
  );
}

/**
 * Pre-populate the query cache for a specific repository method call.
 *
 * Call this immediately after a mutation that returns fresh entity data and
 * before navigating to the entity's detail page.
 *
 *   preloadQuery("getTask", [newTaskId], taskData);
 *   router.push(`/tasks/${newTaskId}`);
 *
 * The detail page's `useQuery(r => r.getTask(taskId), [taskId])` will serve
 * the preloaded data without a Firestore round-trip.
 */
export function preloadQuery(
  methodName: string,
  deps: unknown[],
  data: unknown,
): void {
  preloadCache.set(methodName + JSON.stringify(deps), {
    data,
    resolvedAt: Date.now(),
  });
}

/**
 * Drop the TTL cache for one repository method, everywhere it is cached.
 *
 * **Why a stale-time cache needs this at all.** `staleResultCache` is keyed on
 * the fetcher's source plus its deps and deliberately NOT on the repository
 * version — that is the point of `staleTime`, so an unrelated write does not
 * re-run an expensive read. The cost is that a write which genuinely
 * invalidates a cached list has no way to say so, and
 * `notifyRepositoryChanged()` sails straight past it.
 *
 * That is survivable while the reader stays on the page: their own hook holds
 * the last good answer, and `refetch()` is forced past the TTL. It is NOT
 * survivable across a navigation, because the next page mounts a NEW hook at
 * nonce 0 — nothing about it is "forced" — so the TTL answers it with a list
 * recorded before the write. The screen then reports the world as it stood up
 * to `staleTime` ago, and the reader is told the thing they just created does
 * not exist.
 *
 * So: call this in the mutation's success path, before navigating.
 *
 *   invalidateQuery("listConversations");
 *   router.push(`/messages/${id}`);
 *
 * Matched on `.method(` against the fetcher source — the same property-access
 * text `METHOD_STALE_DEFAULTS` is resolved from, and minifiers leave property
 * names alone. Every deps variant of the method goes, which is the intended
 * blast radius: a caller knows the method it invalidated, not the argument
 * lists every mounted component happened to call it with.
 */
export function invalidateQuery(methodName: string): void {
  const needle = `.${methodName}(`;
  for (const key of [...staleResultCache.keys()])
    if (key.includes(needle)) staleResultCache.delete(key);
  for (const key of [...preloadCache.keys()])
    if (key.startsWith(methodName + "[")) preloadCache.delete(key);
}

/**
 * Default stale times for repository methods whose data changes rarely
 * compared to how often mutations fire.
 *
 * These are derived from the fetcher's source text (which method it calls),
 * so every call site benefits without any per-call change. Methods not listed
 * here get `staleTime: 0` — always re-fetch on version bump — which is the
 * safe default for task lists, timers, notifications, etc. that DO change on
 * common mutations.
 *
 * Why method names survive minification: property accesses (`r.listEmployees`)
 * are never renamed by terser/swc — only local variable names are. The regex
 * anchors to `=>` so it only matches the repository call, not `.then()` chains.
 */
const METHOD_STALE_DEFAULTS: Record<string, number> = {
  getViewer: 120_000,        // viewer identity / permissions rarely change
  getCurrentEmployee: 120_000,
  listEmployees: 60_000,     // employee list changes only on HR action
  listRoles: 300_000,        // roles almost never change
  listDepartments: 300_000,
  listAssignableEmployees: 60_000,
  listMeetings: 20_000,      // meetings list doesn't change on task mutations
  listProjects: 20_000,
  listGoals: 30_000,
  listDocuments: 30_000,
  /* Safe ONLY because every write and live listener that touches a thread now
     names `listConversations` when it bumps — see `notifyRepositoryChanged`.
     Without that this TTL is a 30-second freeze on the message previews and the
     unread badges, which is precisely what it was. */
  listConversations: 30_000,
  listTimers: 10_000,
  getWorkloadFlow: 30_000,   // weekly graph — won't change in 30 s
};

export function useRepo(): CoworkRepository {
  return getRepository();
}

export type QueryState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: string }
  /**
   * The repository cannot answer this yet.
   *
   * Distinct from `error` on purpose. An error is something that went wrong and
   * a person may be able to retry; **unavailable** is a feature this build has
   * not connected to the backend, which no amount of retrying changes. During a
   * migration most screens have some of both, and showing a red failure for the
   * second teaches people to ignore the first.
   */
  | { status: "unavailable"; data: null; error: string };

export interface QueryResult<T> {
  state: QueryState<T>;
  data: T | null;
  isLoading: boolean;
  error: string | null;
  /**
   * True when this feature is not wired to the backend in this build.
   *
   * A component reads this to render a neutral "unavailable" affordance —
   * never a red error, never a fabricated value, and never a crash. The shell
   * in particular must survive every optional widget being unconnected: a
   * status pill that cannot load must not take navigation down with it.
   */
  isUnavailable: boolean;
  refetch: () => void;
}

interface Settled<T> {
  key: string;
  /**
   * The deps portion of `key`, WITHOUT the nonce/version suffix.
   *
   * This is what tells "revalidating the same query" (a mutation bumped the
   * version, or `refetch` bumped the nonce — deps unchanged) apart from "the
   * deps changed to a different query" (a scope switch, a new filter). The
   * first keeps its last answer on screen; the second must not, because that
   * answer belongs to a different question.
   */
  depsKey: string;
  data: T | null;
  error: string | null;
  unavailable?: boolean;
}

/**
 * Whether a failure means "not wired up" rather than "went wrong".
 *
 * Matched by name rather than by importing the error class, so this generic
 * hook does not depend on a specific repository implementation — a production
 * repository can raise the same name without this file knowing it exists.
 */
function isNotConnected(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { name?: unknown }).name === "NotConnectedError"
  );
}

export function useQuery<T>(
  fetcher: (repo: CoworkRepository) => Promise<T>,
  deps: unknown[] = [],
  { staleTime = 0 }: { staleTime?: number } = {},
): QueryResult<T> {
  const [nonce, setNonce] = useState(0);
  // Any mutation anywhere bumps this, so a timer started in a table row is
  // visible in the shell pill and the day's total without either of them
  // knowing the other exists.
  const version = useSyncExternalStore(
    subscribeToRepository,
    getRepositoryVersion,
    () => 0,
  );
  const depsKey = JSON.stringify(deps);
  const key = depsKey + `#${nonce}#${version}`;

  // Derive the repository method name from the fetcher's source so we can look
  // up a default staleTime without needing every call site to pass one.
  // Property names survive minification; only the parameter variable is renamed.
  const methodName =
    fetcher.toString().match(/=>\s*[\w$]+\.([\w]+)\s*\(/)?.[1] ?? "";
  const effectiveStaleTime = staleTime || METHOD_STALE_DEFAULTS[methodName] || 0;
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  /**
   * The nonce this hook last actually fetched at.
   *
   * `refetch()` bumps `nonce`, and this is how the effect below tells that
   * bump apart from a version bump or a deps change — which is what decides
   * whether the TTL cache may answer.
   *
   * Written in the effect, never in render: a render can be discarded or
   * replayed, and a ref written during one is a side effect on a pass that may
   * never commit.
   */
  const fetchedNonce = useRef(0);

  useEffect(() => {
    let cancelled = false;
    /* **An explicit `refetch()` is never answered from the TTL cache.**
       `staleTime` exists so an unrelated mutation — a timer tick, a task write —
       does not re-run an expensive read that cannot have changed. It was also
       swallowing the one call that means "I know something changed, go and
       look": `refetch` bumps the nonce, which changes `key` and re-runs this
       effect, but the TTL entry is keyed WITHOUT the nonce, so the effect served
       the same stale answer straight back.

       On the documents list — `staleTime` 30s — that meant creating a document
       and returning to the list showed "No documents yet" for half a minute,
       over a document that existed. The reader has just watched themselves make
       the thing the screen says does not exist, and reloading is the only way to
       be believed. */
    const forced = fetchedNonce.current !== nonce;
    fetchedNonce.current = nonce;

    /* Two-level caching strategy:
       1. `staleTime` TTL cache — for expensive queries (e.g. workload graphs)
          that should not re-run on every unrelated mutation. Key is fetcher +
          deps without version, so a fresh result survives version bumps until
          its TTL expires. Call sites opt in with `{ staleTime: 30_000 }`.
       2. Inflight dedup — for all queries. Concurrent components calling the
          same query at the same version share one Promise → one network read.

       Wrapped in `Promise.resolve().then(...)` so a fetcher that throws
       SYNCHRONOUSLY becomes a rejection like any other. It matters: an
       unmigrated repository method throws the moment it is called, before a
       promise exists — so the `.catch` below would never attach and the throw
       would escape the effect into React's error overlay, taking the whole
       shell down because one status pill is not connected yet. */
    const fetcherKey = fetcher.toString() + JSON.stringify(deps);
    const dedupKey = fetcherKey + `#${version}`;

    // Preload check: a mutation may have hand-off fresh data here so the next
    // render of this query doesn't need a round-trip. Served once then deleted.
    if (methodName) {
      const preloaded = preloadCache.get(methodName + JSON.stringify(deps));
      if (preloaded && Date.now() - preloaded.resolvedAt < 30_000) {
        preloadCache.delete(methodName + JSON.stringify(deps));
        if (!cancelled) setSettled({ key, depsKey, data: preloaded.data as T, error: null });
        return () => {
          cancelled = true;
        };
      }
    }

    // TTL check: if a recent resolved result exists for this fetcher+deps,
    // serve it immediately and skip the network round-trip. Skipped entirely
    // when `refetch()` asked for this pass — see `forced` above.
    if (effectiveStaleTime > 0 && !forced) {
      const stale = staleResultCache.get(fetcherKey);
      if (stale && Date.now() - stale.resolvedAt < effectiveStaleTime) {
        if (stale.error === undefined) {
          setSettled({ key, depsKey, data: stale.data as T, error: null });
        } else {
          setSettled({
            key,
            depsKey,
            data: null,
            error: stale.error,
            unavailable: stale.unavailable,
          });
        }
        return () => {
          cancelled = true;
        };
      }
    }

    // Inflight dedup: if another component already started this fetch, join it.
    if (!inflightCache.has(dedupKey)) {
      const p = Promise.resolve().then(() => fetcher(getRepository()));
      inflightCache.set(dedupKey, p);
      /* Announced on both edges so a watcher sees the count rise and fall.
         Without the rise, a Sync pressed before any request had started would
         read zero in flight and stop spinning immediately. */
      announceInflight();
      // .catch() suppresses the unhandled-rejection the browser fires when `p`
      // rejects and `p.finally(...)` produces a new rejected Promise with no
      // handler. Subscribers still see the rejection through their own chains.
      p.finally(() => {
        inflightCache.delete(dedupKey);
        announceInflight();
      }).catch(() => {});
    }

    (inflightCache.get(dedupKey) as Promise<T>)
      .then((data) => {
        if (!cancelled) {
          setSettled({ key, depsKey, data, error: null });
          if (effectiveStaleTime > 0) {
            staleResultCache.set(fetcherKey, { data, resolvedAt: Date.now() });
          }
        }
      })
      .catch((e: unknown) => {
        const unavailable = isNotConnected(e);
        /**
         * Counted whether or not this component still cares.
         *
         * Outside the `cancelled` guard on purpose: a read that failed, failed.
         * The guard means "do not write state into an unmounted component",
         * which is a different question from "did anything go wrong" — and Sync
         * asks the second one. A navigation mid-refresh would otherwise hide the
         * failure it was about to report.
         *
         * `unavailable` is excluded. That is a method the backend does not
         * implement, which the UI already renders as "unavailable" wherever it
         * appears — reporting a sync failure for it would flag a permanent,
         * known gap as a transient fault every single time.
         */
        if (!unavailable) noteQueryFailure(methodName, e);
        if (!cancelled) {
          const error = e instanceof Error ? e.message : "Something went wrong.";
          setSettled({ key, depsKey, data: null, error, unavailable });
          if (effectiveStaleTime > 0) {
            staleResultCache.set(fetcherKey, { error, unavailable, resolvedAt: Date.now() });
          }
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Derived, not stored. A result belonging to a previous key is stale — but
  // stale is not the same as absent. Only the FIRST fetch renders a skeleton;
  // a refetch keeps showing the last good answer while the new one lands, so a
  // single click does not blank every panel on the page. That distinction is
  // load-bearing now that any mutation invalidates every query.
  const fresh = settled && settled.key === key ? settled : null;

  let state: QueryState<T>;
  if (fresh) {
    state =
      fresh.error !== null
        ? fresh.unavailable
          ? { status: "unavailable", data: null, error: fresh.error }
          : { status: "error", data: null, error: fresh.error }
        : { status: "ready", data: fresh.data as T, error: null };
  } else if (
    settled &&
    settled.error === null &&
    settled.depsKey === depsKey
  ) {
    // Revalidating the SAME query — a mutation bumped the version, or `refetch`
    // bumped the nonce, but the deps are unchanged. Keep the last good answer
    // on screen so a single click does not blank every panel on the page.
    state = { status: "ready", data: settled.data as T, error: null };
  } else {
    // Either nothing has settled yet, or the DEPS changed — this is a different
    // query now (a task scope switched from "mine" to "team", a filter moved).
    // The previous answer belongs to a different question: keeping it showed a
    // "mine" result of zero tasks as an empty "team", so the list rendered "No
    // tasks here" over 33 tasks that were still loading. Report loading and let
    // the caller show its skeleton.
    state = { status: "loading", data: null, error: null };
  }

  return {
    state,
    data: state.status === "ready" ? state.data : null,
    isLoading: state.status === "loading",
    /* An unavailable feature reports NO error. A component that renders
       `error` would otherwise show a failure message for something that simply
       is not built yet — which is the confusion this status exists to end. */
    error: state.status === "error" ? state.error : null,
    isUnavailable: state.status === "unavailable",
    refetch: useCallback(() => setNonce((n) => n + 1), []),
  };
}

export interface ActionState {
  isPending: boolean;
  error: string | null;
  errorField: string | null;
  errorCode: string | null;
}

const IDLE: ActionState = {
  isPending: false,
  error: null,
  errorField: null,
  errorCode: null,
};

/**
 * Runs a repository mutation, surfacing the typed failure rather than throwing.
 * A permission-denied or validation result is a state to render, not an
 * exception to catch.
 */
export function useAction<TArgs extends unknown[], TData>(
  run: (repo: CoworkRepository, ...args: TArgs) => Promise<ActionResult<TData>>,
): [(...args: TArgs) => Promise<ActionResult<TData>>, ActionState, () => void] {
  const [state, setState] = useState<ActionState>(IDLE);

  /* The callback is read through a ref, not captured.
   *
   * `execute` has to be stable — it is passed to event handlers and depended on
   * by effects — but almost every caller writes it as an inline closure over
   * component state: `useAction(r => r.createTask({ title, assigneeIds }))`.
   * Capturing that closure once meant every mutation submitted the values those
   * fields held on FIRST render. Creating a task sent `title: ""` no matter what
   * had been typed, and the form reported "A title is required" against a title
   * plainly on screen — the user was reading the truth about a request they
   * could not see.
   *
   * The ref is written in an effect rather than during render: a render can be
   * thrown away or replayed, and a ref written during one is a side effect on a
   * pass that may never commit. Writing after commit is safe for this because
   * `execute` only ever runs from an event or an effect, both of which come
   * after the commit that set it. */
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  const execute = useCallback(
    async (...args: TArgs) => {
      setState({ ...IDLE, isPending: true });
      try {
        const result = await runRef.current(getRepository(), ...args);
        // Every mutation invalidates every query. The prototype's store is a
        // singleton, so nothing else would notice the write.
        if (result.ok) notifyRepositoryChanged();
        setState(
          result.ok
            ? IDLE
            : {
                isPending: false,
                error: result.message,
                errorField: result.field ?? null,
                errorCode: result.code,
              },
        );
        return result;
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Something went wrong.";
        setState({
          isPending: false,
          error: message,
          errorField: null,
          errorCode: "conflict",
        });
        return { ok: false as const, code: "conflict" as const, message };
      }
    },
    /* Genuinely stable: the only thing that varies between renders is reached
       through `runRef`, so there is nothing here to depend on. */
    [],
  );

  const reset = useCallback(() => setState(IDLE), []);

  return [execute, state, reset];
}
