import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Deleting a message must refresh the conversation-list preview.
 *
 * A soft delete clears the message text and shows the tombstone in the bubble,
 * but the LIST preview reads the parent conversation's stored `lastMessage` —
 * which the delete used to leave alone, so the list kept showing words that were
 * gone from the thread. Both backends must now recompute the preview from the
 * newest message on delete: the tombstone when the newest is the deleted one,
 * the still-current newest otherwise.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const MOCK = strip("lib/repositories/mock/index.ts");
const LEGACY = strip("lib/repositories/legacy/index.ts");

test("the mock recomputes the list preview from the newest message on delete", () => {
  /* Inside deleteMessage, after the soft delete, it finds the newest message
     and writes the tombstone (or that message's own preview). */
  assert.match(MOCK, /m\.isDeleted = true;[\s\S]*?const newest = msgs\[msgs\.length - 1\];/);
  assert.match(MOCK, /conv\.lastMessagePreview = newest\.isDeleted\s*\?\s*"This message was deleted\."/);
});

test("the legacy delete rewrites the parent's lastMessage.text from the newest", () => {
  assert.match(LEGACY, /orderBy\("createdAt", "desc"\),\s*fsLimit\(1\)/);
  assert.match(LEGACY, /readMessageDoc\(nd\.id, conversationId/);
  /* Merge so ordering (sentAt/updatedAt) is untouched — a delete must not bump
     the thread up the list. */
  assert.match(LEGACY, /lastMessage: \{ text: previewText, messageType: previewType \}[\s\S]*?\{ merge: true \}/);
});
