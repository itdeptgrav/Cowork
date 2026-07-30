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
  subscribeToRepository,
} from "@/lib/repositories/events";
import type { ActionResult, CoworkRepository } from "@/lib/repositories";

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
  const key = JSON.stringify(deps) + `#${nonce}#${version}`;
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    let cancelled = false;

    /* The fetcher is captured in this closure rather than held in a ref, so a
       deps change is the only thing that re-runs it.

       Wrapped in `Promise.resolve().then(...)` so a fetcher that throws
       SYNCHRONOUSLY becomes a rejection like any other. It matters: an
       unmigrated repository method throws the moment it is called, before a
       promise exists — so the `.catch` below would never attach and the throw
       would escape the effect into React's error overlay, taking the whole
       shell down because one status pill is not connected yet. */
    Promise.resolve()
      .then(() => fetcher(getRepository()))
      .then((data) => {
        if (!cancelled) setSettled({ key, data, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setSettled({
            key,
            data: null,
            error: e instanceof Error ? e.message : "Something went wrong.",
            unavailable: isNotConnected(e),
          });
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
  } else if (settled && settled.error === null) {
    // Revalidating: keep the last good answer on screen.
    state = { status: "ready", data: settled.data as T, error: null };
  } else {
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
