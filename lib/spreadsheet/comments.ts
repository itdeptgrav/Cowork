/**
 * Notes and comments — a threaded discussion attached to a cell.
 *
 * A comment is kept SEPARATE from the cell's value: the worksheet holds a sparse
 * `comments: Record<A1ref, CommentThread>` map, so a cell carries a conversation
 * without its value ever knowing. Each thread is an ordered list of entries; the
 * first is the original note and the rest are replies, which is the shape a
 * future collaboration layer needs — every entry already records its own author
 * and timestamp, so many people writing into one thread is a data change, not a
 * model change.
 *
 * The module is PURE: it never reads the clock or invents an id. The caller
 * supplies `id` and `timestamp` (the browser's `Date.now()`, a fixed value in a
 * test), so the same operation is deterministic wherever it runs.
 */

/** One authored entry in a thread — the original note, or a reply. */
export interface CommentEntry {
  id: string;
  /** Who wrote it. A display name or address; the model does not interpret it. */
  author: string;
  /** When it was written, epoch milliseconds. */
  timestamp: number;
  body: string;
}

/** A cell's thread: its reference, its entries in order, and whether it is
    resolved (kept so a resolved discussion can be hidden rather than deleted). */
export interface CommentThread {
  ref: string;
  entries: CommentEntry[];
  resolved?: boolean;
}

export type CommentMap = Record<string, CommentThread>;

/** The thread on a cell, or undefined. */
export function threadAt(comments: CommentMap | undefined, ref: string): CommentThread | undefined {
  return comments?.[ref];
}

/** Whether a cell carries any comment — for the corner indicator. */
export function hasComment(comments: CommentMap | undefined, ref: string): boolean {
  return !!comments?.[ref] && comments[ref].entries.length > 0;
}

/**
 * Add an entry to a cell's thread, returning a NEW map. The first entry on a
 * cell starts the thread; later entries are replies appended in order. Adding to
 * a thread also clears its resolved flag — a new reply reopens the discussion.
 */
export function addComment(
  comments: CommentMap | undefined,
  ref: string,
  entry: CommentEntry,
): CommentMap {
  const existing = comments?.[ref];
  const thread: CommentThread = existing
    ? { ...existing, entries: [...existing.entries, entry], resolved: false }
    : { ref, entries: [entry] };
  return { ...(comments ?? {}), [ref]: thread };
}

/** Edit one entry's body, returning a NEW map (unchanged when the entry or
    thread is absent). */
export function editComment(
  comments: CommentMap | undefined,
  ref: string,
  entryId: string,
  body: string,
): CommentMap | undefined {
  const thread = comments?.[ref];
  if (!thread) return comments;
  let changed = false;
  const entries = thread.entries.map((e) => {
    if (e.id !== entryId || e.body === body) return e;
    changed = true;
    return { ...e, body };
  });
  if (!changed) return comments;
  return { ...comments, [ref]: { ...thread, entries } };
}

/**
 * Remove one entry, returning a NEW map. Removing the last entry drops the whole
 * thread (and the map itself when it was the last thread), so "no comments" and
 * "empty thread" never diverge.
 */
export function removeComment(
  comments: CommentMap | undefined,
  ref: string,
  entryId: string,
): CommentMap | undefined {
  const thread = comments?.[ref];
  if (!thread) return comments;
  const entries = thread.entries.filter((e) => e.id !== entryId);
  if (entries.length === thread.entries.length) return comments;
  const next = { ...comments };
  if (entries.length === 0) delete next[ref];
  else next[ref] = { ...thread, entries };
  return Object.keys(next).length ? next : undefined;
}

/** Mark a thread resolved or reopened, returning a NEW map. */
export function setResolved(
  comments: CommentMap | undefined,
  ref: string,
  resolved: boolean,
): CommentMap | undefined {
  const thread = comments?.[ref];
  if (!thread || !!thread.resolved === resolved) return comments;
  return { ...comments, [ref]: { ...thread, resolved: resolved || undefined } };
}
