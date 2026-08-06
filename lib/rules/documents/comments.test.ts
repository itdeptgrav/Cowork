import assert from "node:assert/strict";
import { test } from "node:test";
import { sortThreads, unresolvedCount, type CommentThread } from "./comments.ts";

function thread(id: string, createdAt: number, resolved = false): CommentThread {
  return {
    id,
    anchorText: "quoted text",
    authorId: "e1",
    authorName: "Author",
    createdAt,
    resolved,
    messages: [{ id: "m1", authorId: "e1", authorName: "Author", text: "hi", createdAt }],
  };
}

test("open threads sort before resolved ones", () => {
  const sorted = sortThreads([thread("a", 1, true), thread("b", 2, false)]);
  assert.deepEqual(sorted.map((t) => t.id), ["b", "a"]);
});

test("within a group, newest sorts first", () => {
  const sorted = sortThreads([thread("a", 1), thread("b", 3), thread("c", 2)]);
  assert.deepEqual(sorted.map((t) => t.id), ["b", "c", "a"]);
});

test("unresolvedCount counts only the open threads", () => {
  const threads = [thread("a", 1, true), thread("b", 2, false), thread("c", 3, false)];
  assert.equal(unresolvedCount(threads), 2);
});

test("an empty list is empty, not an error", () => {
  assert.deepEqual(sortThreads([]), []);
  assert.equal(unresolvedCount([]), 0);
});
