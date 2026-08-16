import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addComment,
  editComment,
  hasComment,
  removeComment,
  setResolved,
  threadAt,
  type CommentEntry,
  type CommentMap,
} from "@/lib/spreadsheet/comments";

const entry = (id: string, author: string, timestamp: number, body: string): CommentEntry => ({
  id,
  author,
  timestamp,
  body,
});

test("addComment starts a thread, then appends replies in order", () => {
  let comments: CommentMap | undefined;
  comments = addComment(comments, "A1", entry("1", "Ada", 1000, "First"));
  comments = addComment(comments, "A1", entry("2", "Bo", 2000, "A reply"));
  const thread = threadAt(comments, "A1")!;
  assert.equal(thread.ref, "A1");
  assert.equal(thread.entries.length, 2);
  assert.deepEqual(
    thread.entries.map((e) => [e.author, e.body, e.timestamp]),
    [["Ada", "First", 1000], ["Bo", "A reply", 2000]],
  );
  assert.equal(hasComment(comments, "A1"), true);
  assert.equal(hasComment(comments, "B2"), false);
});

test("comments on different cells are independent", () => {
  let comments = addComment(undefined, "A1", entry("1", "Ada", 1, "here"));
  comments = addComment(comments, "C3", entry("2", "Bo", 2, "there"));
  assert.equal(threadAt(comments, "A1")!.entries.length, 1);
  assert.equal(threadAt(comments, "C3")!.entries.length, 1);
});

test("editComment changes one entry's body only", () => {
  let comments = addComment(undefined, "A1", entry("1", "Ada", 1, "old"));
  comments = addComment(comments, "A1", entry("2", "Bo", 2, "keep"));
  comments = editComment(comments, "A1", "1", "new")!;
  const bodies = threadAt(comments, "A1")!.entries.map((e) => e.body);
  assert.deepEqual(bodies, ["new", "keep"]);
  // Editing a missing entry is a no-op (same reference).
  assert.equal(editComment(comments, "A1", "nope", "x"), comments);
});

test("removeComment drops an entry, and an empty thread drops itself", () => {
  let comments: CommentMap | undefined = addComment(undefined, "A1", entry("1", "Ada", 1, "one"));
  comments = addComment(comments, "A1", entry("2", "Bo", 2, "two"));
  comments = removeComment(comments, "A1", "1");
  assert.deepEqual(threadAt(comments, "A1")!.entries.map((e) => e.id), ["2"]);
  // Removing the last entry removes the thread — and the last thread clears the map.
  comments = removeComment(comments, "A1", "2");
  assert.equal(comments, undefined);
});

test("adding a reply reopens a resolved thread", () => {
  let comments = addComment(undefined, "A1", entry("1", "Ada", 1, "issue"));
  comments = setResolved(comments, "A1", true)!;
  assert.equal(threadAt(comments, "A1")!.resolved, true);
  comments = addComment(comments, "A1", entry("2", "Bo", 2, "actually…"));
  assert.equal(threadAt(comments, "A1")!.resolved, false);
});

test("setResolved toggles the flag and normalises false to absent", () => {
  let comments = addComment(undefined, "A1", entry("1", "Ada", 1, "x"));
  comments = setResolved(comments, "A1", true)!;
  assert.equal(threadAt(comments, "A1")!.resolved, true);
  comments = setResolved(comments, "A1", false)!;
  assert.equal(threadAt(comments, "A1")!.resolved, undefined);
});
