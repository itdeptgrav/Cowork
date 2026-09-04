import assert from "node:assert/strict";
import { test } from "node:test";
import { documentRoom, mindmapRoom, parseRoom, workbookRoom } from "./collabRoom.ts";

test("a document room is the bare id, so live sessions do not split", () => {
  /* **This is the assertion that protects existing editors.** If documents ever
     gain a prefix, a client on the old name and a client on the new one join two
     different rooms holding two divergent copies of one document — and nothing
     errors, because both halves work perfectly on their own. */
  assert.equal(documentRoom("doc-1"), "doc-1");
  assert.deepEqual(parseRoom("doc-1"), { kind: "document", id: "doc-1" });
});

test("a mindmap room carries its kind", () => {
  assert.equal(mindmapRoom("map-1"), "mindmap:map-1");
  assert.deepEqual(parseRoom("mindmap:map-1"), { kind: "mindmap", id: "map-1" });
});

test("round-trips both kinds", () => {
  assert.deepEqual(parseRoom(documentRoom("abc")), { kind: "document", id: "abc" });
  assert.deepEqual(parseRoom(mindmapRoom("abc")), { kind: "mindmap", id: "abc" });
});

test("a document and a mindmap sharing an id are different rooms", () => {
  /* Firestore ids are unique per collection, not across them, so this collision
     is ordinary rather than exotic — and authorising a mindmap against a
     document's member list is exactly the bug the prefix exists to stop. */
  assert.notEqual(documentRoom("same"), mindmapRoom("same"));
});

test("a room naming nothing is null, not a record with an empty id", () => {
  assert.equal(parseRoom(""), null);
  /* `mindmap:` would otherwise send the server to look up the empty id. */
  assert.equal(parseRoom("mindmap:"), null);
});

test("an id containing a colon still parses as a document", () => {
  /* Only the mindmap prefix is special. Anything else is a document id, however
     it is punctuated. */
  assert.deepEqual(parseRoom("a:b"), { kind: "document", id: "a:b" });
});

test("a workbook room carries its kind and never collides with the others", () => {
  assert.equal(workbookRoom("wb-1"), "workbook:wb-1");
  assert.deepEqual(parseRoom("workbook:wb-1"), { kind: "workbook", id: "wb-1" });
  assert.equal(parseRoom("workbook:"), null);
  assert.notEqual(workbookRoom("same"), mindmapRoom("same"));
  assert.notEqual(workbookRoom("same"), documentRoom("same"));
});
