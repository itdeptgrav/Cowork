/**
 * Comments audit — thread lifecycle edge cases, immutability, and what happens
 * to a thread when structural operations move or delete its host cell.
 *
 * Assertions state CORRECT behaviour; failures are tagged `// BUG(...)`.
 * The structural-op behaviour asserts the DOCUMENTED gap (structure.ts says
 * comments are deliberately not reference-tracked), so a change is noticed.
 */

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
import { createWorksheet, setCellValue, getCellValue } from "@/lib/spreadsheet/model";
import { insertRows, deleteRows } from "@/lib/spreadsheet/structure";

const entry = (id: string, body: string, timestamp = 1): CommentEntry => ({
  id,
  author: "Ada",
  timestamp,
  body,
});

test("AUDIT: operations on missing threads/entries are identity no-ops", () => {
  const comments = addComment(undefined, "A1", entry("1", "x"));
  assert.equal(editComment(comments, "Z9", "1", "new"), comments, "editing a missing thread");
  assert.equal(removeComment(comments, "Z9", "1"), comments, "removing from a missing thread");
  assert.equal(removeComment(comments, "A1", "ghost"), comments, "removing a missing entry");
  assert.equal(setResolved(comments, "Z9", true), comments, "resolving a missing thread");
  assert.equal(editComment(undefined, "A1", "1", "x"), undefined);
  assert.equal(removeComment(undefined, "A1", "1"), undefined);
});

test("AUDIT: the input map is never mutated — every operation returns a new map", () => {
  const original = addComment(undefined, "A1", entry("1", "first"));
  const snapshot = JSON.stringify(original);
  addComment(original, "A1", entry("2", "second"));
  editComment(original, "A1", "1", "changed");
  removeComment(original, "A1", "1");
  setResolved(original, "A1", true);
  assert.equal(JSON.stringify(original), snapshot, "the original map is untouched");
});

test("AUDIT: editing to the SAME body is a no-op that keeps the reference", () => {
  const comments = addComment(undefined, "A1", entry("1", "same"));
  assert.equal(editComment(comments, "A1", "1", "same"), comments);
});

test("AUDIT: resolve → reply → resolved is cleared; resolve twice is a no-op reference", () => {
  let comments = addComment(undefined, "A1", entry("1", "issue"));
  comments = setResolved(comments, "A1", true)!;
  const again = setResolved(comments, "A1", true);
  assert.equal(again, comments, "resolving a resolved thread changes nothing");
  comments = addComment(comments, "A1", entry("2", "reopening reply"));
  assert.equal(threadAt(comments, "A1")!.resolved, false, "a reply reopens the discussion");
  assert.equal(hasComment(comments, "A1"), true);
});

test("AUDIT: removing entries one by one ends with the whole map gone, not an empty husk", () => {
  let comments: CommentMap | undefined = addComment(undefined, "A1", entry("1", "a"));
  comments = addComment(comments, "A1", entry("2", "b"));
  comments = addComment(comments, "B2", entry("3", "c"));
  comments = removeComment(comments, "A1", "1");
  comments = removeComment(comments, "A1", "2");
  assert.equal(threadAt(comments, "A1"), undefined, "the emptied thread is dropped");
  assert.equal(threadAt(comments, "B2")!.entries.length, 1, "the other thread survives");
  comments = removeComment(comments, "B2", "3");
  assert.equal(comments, undefined, "the last thread takes the map with it");
});

test("AUDIT: threads on many cells stay independent through mixed edits", () => {
  let comments = addComment(undefined, "A1", entry("1", "one"));
  comments = addComment(comments, "C3", entry("2", "two"));
  comments = setResolved(comments, "A1", true)!;
  comments = editComment(comments, "C3", "2", "two edited")!;
  assert.equal(threadAt(comments, "A1")!.resolved, true);
  assert.equal(threadAt(comments, "A1")!.entries[0].body, "one");
  assert.equal(threadAt(comments, "C3")!.resolved, undefined);
  assert.equal(threadAt(comments, "C3")!.entries[0].body, "two edited");
});

test("AUDIT: structural ops move CELLS but not comments — the documented gap, held", () => {
  // structure.ts documents that merges/validations/comments/links are NOT
  // reference-tracked through insert/delete. This asserts today's actual
  // behaviour so any (welcome) fix will show up as a deliberate test update.
  let ws = createWorksheet("s", "Sheet1", 10, 5);
  ws = setCellValue(ws, 2, 0, "annotated"); // A3
  ws = { ...ws, comments: addComment(undefined, "A3", entry("1", "note on A3")) };

  const inserted = insertRows(ws, 0, 1);
  assert.equal(getCellValue(inserted, 3, 0), "annotated", "the value moved to A4");
  assert.equal(threadAt(inserted.comments, "A3")?.entries[0].body, "note on A3");
  assert.equal(
    threadAt(inserted.comments, "A4"),
    undefined,
    "the comment did NOT follow its cell (documented divergence, structure.ts)",
  );

  const deleted = deleteRows(ws, 2, 1);
  assert.equal(getCellValue(deleted, 2, 0), "", "the host cell's value is gone");
  assert.equal(
    threadAt(deleted.comments, "A3")?.entries[0].body,
    "note on A3",
    "the thread now sits on whatever moved into A3 (same documented divergence)",
  );
});
