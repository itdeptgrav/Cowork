"use client";

import type { Editor } from "@tiptap/react";
import type * as Y from "yjs";
import type { CommentThread } from "@/lib/rules/documents/comments";

/**
 * Open a new thread and anchor it — the one place a `CommentThread` is
 * created, so `DocsComments.tsx`'s own "Comment on selection" and the AI
 * assistant's `add_comment` tool (see `DocsAssistant.tsx`) do exactly the
 * same write rather than two versions that could drift.
 */
export function addCommentThread(input: {
  editor: Editor;
  doc: Y.Doc;
  me: { id: string; displayName: string };
  range: { from: number; to: number };
  anchorText: string;
  text: string;
}): string {
  const yThreads = input.doc.getMap<CommentThread>("comments");
  const id = crypto.randomUUID();
  const now = Date.now();
  const thread: CommentThread = {
    id,
    anchorText: input.anchorText,
    authorId: input.me.id,
    authorName: input.me.displayName,
    createdAt: now,
    resolved: false,
    messages: [
      {
        id: crypto.randomUUID(),
        authorId: input.me.id,
        authorName: input.me.displayName,
        text: input.text,
        createdAt: now,
      },
    ],
  };
  yThreads.set(id, thread);
  input.editor.chain().setTextSelection(input.range).setComment(id).run();
  return id;
}
