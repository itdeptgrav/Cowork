/**
 * Comment threads — the types, and the small amount of pure logic around
 * them (sorting, counting). Kept apart from the Yjs/Tiptap wiring so the
 * shape can be reasoned about and tested without a document, the same
 * separation `outline.ts`/`textStats.ts` already draw for this feature.
 *
 * A thread lives in the document's own Yjs room, in a `Y.Map<CommentThread>`
 * keyed by thread id — not a Firestore record of its own. Documents are
 * already collaborative; a comment is one more thing everyone in the room
 * sees change live, and it persists exactly as the prose does (the server
 * checkpoints `Y.encodeStateAsUpdate` on save, and the room is restored from
 * it on the next open). See `lib/documents/extensions/comment.ts` for how a
 * thread's id is anchored onto the text it is about.
 */

export interface CommentMessage {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  /** Epoch ms. */
  createdAt: number;
}

export interface CommentThread {
  id: string;
  /**
   * A snapshot of the text this thread was opened on.
   *
   * The mark in the document is the live anchor and wins whenever it still
   * exists — this is only what the panel shows if every character the mark
   * covered has since been deleted, so the thread does not read as pointing
   * at nothing.
   */
  anchorText: string;
  authorId: string;
  authorName: string;
  createdAt: number;
  resolved: boolean;
  /** Always at least one — the thread's opening comment is `messages[0]`. */
  messages: CommentMessage[];
}

/** Open threads first (newest first), resolved threads after (also newest first). */
export function sortThreads(threads: CommentThread[]): CommentThread[] {
  return [...threads].sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    return b.createdAt - a.createdAt;
  });
}

export function unresolvedCount(threads: CommentThread[]): number {
  return threads.reduce((n, t) => n + (t.resolved ? 0 : 1), 0);
}
