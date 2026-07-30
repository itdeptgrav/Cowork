import { notifyRepositoryChanged } from "../events.ts";

/**
 * Live task updates, from the same listeners the old app runs.
 *
 * ## Why this shape
 *
 * Old Cowork keeps `cowork_tasks` open with `onSnapshot` and re-renders when
 * Firestore pushes. New Cowork reads with `getDocs` inside `listTasks`, so a
 * status change made anywhere else — the old app, a colleague's approval, the
 * engine's own write — did not appear until something else happened to
 * invalidate the query. Two people looking at one task saw different states,
 * which for an approval queue is worse than a stale number: you approve
 * something twice, or you wait on something already cleared.
 *
 * The fix does **not** rebuild the query layer. `lib/repositories/events.ts`
 * already defines the seam — mutations bump a version and every `useQuery`
 * re-runs — and says in as many words that a production repository would
 * satisfy the same contract "from a socket or a poll". A Firestore listener is
 * that. So this attaches the listeners and fires the existing signal; every
 * screen reading tasks becomes live at once, and no component, hook or query
 * changes.
 *
 * The alternative — turning `listTasks` into a subscription — would have meant
 * a second data path alongside `useQuery`, and every task surface rewritten to
 * consume it. Same result, far more moving parts, and the promise-based
 * repository contract broken for one caller.
 *
 * ## The queries
 *
 * Identical to `app/coworking/tasks/page.js:3860-3868`, `4031-4037` and
 * `3915-3927` — and to `#taskDocuments`, deliberately: this watches exactly
 * what that reads, so a push can never signal a change to a document the
 * subsequent read would not return.
 *
 * | Role | Listeners |
 * |---|---|
 * | employee | `assigneeIds array-contains me` |
 * | tl | `assignedBy == me`, `assigneeIds array-contains me` |
 * | ceo | those two, plus `approverId == me` |
 */

export interface TaskWatchInput {
  employeeId: string;
  /** The legacy role string — `ceo`, `tl`, or anything else for employee. */
  role: string;
}

/**
 * Start watching. Returns an unsubscribe that detaches every listener.
 *
 * Errors are reported, not swallowed and not thrown. A listener that fails —
 * most likely a missing composite index, the same fault that once hid tasks
 * entirely — must not take down the session that installed it, but it must
 * also not fail silently: without the console line, the only symptom is a
 * screen that has quietly stopped updating, which is indistinguishable from
 * nothing having changed.
 */
export async function startTaskWatch(
  input: TaskWatchInput,
): Promise<() => void> {
  const { collection, limit, onSnapshot, orderBy, query, where } =
    await import("firebase/firestore");
  const { legacyDb } = await import("../../legacy/firebase.ts");

  const ref = collection(legacyDb(), "cowork_tasks");
  const role = String(input.role ?? "employee");
  const me = String(input.employeeId);

  const queries = [];
  if (role === "ceo" || role === "tl") {
    queries.push(query(ref, where("assignedBy", "==", me), orderBy("updatedAt", "desc"), limit(100)));
    queries.push(query(ref, where("assigneeIds", "array-contains", me), orderBy("updatedAt", "desc"), limit(100)));
  } else {
    queries.push(query(ref, where("assigneeIds", "array-contains", me), orderBy("updatedAt", "desc"), limit(100)));
  }
  if (role === "ceo") {
    queries.push(query(ref, where("approverId", "==", me), orderBy("updatedAt", "desc"), limit(100)));
  }

  const unsubscribes = queries.map((q, index) => {
    /* Firestore delivers the current contents immediately on attach. That
       first delivery is not a change — invalidating on it would re-run every
       task query once per listener for data the caller has just read. */
    let primed = false;

    return onSnapshot(
      q,
      (snap) => {
        if (!primed) {
          primed = true;
          return;
        }
        /* An empty change set still arrives for metadata-only events, such as
           a write leaving the local cache for the server. Nothing the reader
           can see has changed, so nothing is invalidated. */
        if (snap.docChanges().length === 0) return;
        notifyRepositoryChanged();
      },
      (error) => {
        console.error(`[taskWatch] listener ${index} stopped:`, error.message);
      },
    );
  });

  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
