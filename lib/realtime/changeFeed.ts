/**
 * The client half of realtime, once Firestore is gone.
 *
 * ## What replaces what
 *
 * A Firestore `onSnapshot` was a live cursor: the browser held a subscription
 * and Google pushed documents into it. There is no equivalent to hold against
 * MongoDB — the browser must never reach the database directly, because
 * Firestore's rules were the only thing making direct access safe and they do
 * not exist here.
 *
 * So the shape becomes: the server watches the oplog, works out who is allowed
 * to see each change, and emits a small notice. This module turns that notice
 * into the invalidation Cowork already runs on — `notifyRepositoryChanged`,
 * which every `useQuery` is already listening to. Nothing above this line
 * changes, which is the whole point.
 *
 * ## Why the notice carries no data
 *
 * `{collection, id, operation}` and nothing else. The alternative — shipping
 * the changed document and patching it into the cache — puts a second copy of
 * the truth in the browser, free to drift from the one the server would give
 * on the next read. It also means an error in the server's audience rule leaks
 * *that something changed* rather than *what changed*.
 *
 * The cost is one read after a change, which is exactly what a mutation already
 * costs today.
 *
 * ## Why changes are coalesced
 *
 * One press can move many documents. Renumbering a queue writes a row per task;
 * a submission touches the task, its submission and a notification. Each of
 * those is its own oplog entry and would be its own version bump — and a bump
 * makes every mounted query refetch. Twenty bumps in a burst is twenty refetch
 * storms for one user action.
 *
 * They are gathered for a frame and applied once, with the union of what they
 * invalidated. `COALESCE_MS` is deliberately short: long enough to catch a
 * burst that belongs to one action, far too short to be felt as lag.
 */

import {
  notifyRepositoryChanged,
  refreshEverything,
} from "@/lib/repositories/events";

/** How long changes are gathered before one invalidation is applied. */
export const COALESCE_MS = 60;

export interface ChangeNotice {
  collection: string;
  id: string | null;
  operation: "insert" | "update" | "replace" | "delete" | string;
  at?: string;
}

/**
 * Which repository reads a collection can invalidate.
 *
 * Named methods rather than a blanket bump, because `notifyRepositoryChanged`
 * drops the cached answers for exactly the methods it is given — see
 * `events.ts`. Too few and a TTL keeps serving a stale list; too many and every
 * change costs reads nobody needed.
 *
 * A collection absent from this map still bumps the version (so a live query
 * re-runs) but purges no TTL cache, which is the safe side of the trade: the
 * screen is correct, at the cost of one cached answer surviving its window.
 */
export const INVALIDATES: Record<string, readonly string[]> = {
  cowork_tasks: [
    "getTask",
    "listTasks",
    "listActionable",
    "listProjectTasks",
    "listTaskEvents",
    "listSubmissions",
    "listReworkRequests",
    "listRequirementProgress",
    "getApprovalPlan",
  ],
  cowork_notifications: ["listNotifications"],
  cowork_direct_messages: ["listMessages", "listConversations"],
  cowork_groups: ["listGroups", "getGroup", "listConversations"],
  cowork_duty_status: ["getDutyMode", "listDutyDay", "listDutyHistory"],
  cowork_task_timers: [
    "getTimer",
    "getActiveTimer",
    "listTimers",
    "listWorkCommits",
    "listDayCommits",
  ],
};

/** The union of what a batch of notices invalidates. */
export function methodsFor(notices: readonly ChangeNotice[]): string[] {
  const out = new Set<string>();
  for (const n of notices)
    for (const m of INVALIDATES[n.collection] ?? []) out.add(m);
  return [...out];
}

/**
 * The minimal socket surface this needs.
 *
 * Declared rather than imported so the feed can be driven by a fake in a test —
 * `socket.io-client` cannot be constructed under `node --test`, and a bridge
 * that cannot be tested is one whose failure is silent in both directions.
 */
export interface ChangeSocket {
  on(event: string, handler: (payload: never) => void): unknown;
  off(event: string, handler: (payload: never) => void): unknown;
}

/**
 * Attach the feed to a socket. Returns the detach function.
 *
 * Both handlers are removed on detach, including the pending timer — a feed
 * that fired after its socket was replaced would invalidate on behalf of a
 * session that had ended.
 */
export function startChangeFeed(
  socket: ChangeSocket,
  options: {
    coalesceMs?: number;
    /** Injected for tests; defaults to the real invalidation. */
    onApply?: (methods: string[]) => void;
    onResync?: () => void;
  } = {},
): () => void {
  const coalesceMs = options.coalesceMs ?? COALESCE_MS;
  const apply =
    options.onApply ?? ((methods: string[]) => notifyRepositoryChanged(...methods));
  const resync = options.onResync ?? (() => refreshEverything());

  let batch: ChangeNotice[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const notices = batch;
    batch = [];
    if (notices.length === 0) return;
    apply(methodsFor(notices));
  };

  const onChange = (notice: ChangeNotice) => {
    if (!notice || typeof notice.collection !== "string") return;
    batch.push(notice);
    if (timer === null) timer = setTimeout(flush, coalesceMs);
  };

  /**
   * The server could not resume where it stopped, so some changes were never
   * delivered and cannot be. Everything on screen is suspect; the only honest
   * answer is to read it all again.
   *
   * Any pending batch is dropped first — it is a strict subset of what the full
   * refresh is about to do, and applying it after would be a second storm for
   * nothing.
   */
  const onResync = () => {
    batch = [];
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    resync();
  };

  socket.on("realtime:change", onChange as (p: never) => void);
  socket.on("realtime:resync", onResync as (p: never) => void);

  return () => {
    socket.off("realtime:change", onChange as (p: never) => void);
    socket.off("realtime:resync", onResync as (p: never) => void);
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    batch = [];
  };
}
