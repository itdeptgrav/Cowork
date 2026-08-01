import assert from "node:assert/strict";
import { test } from "node:test";
import { findMatches, matchIndexFrom, replacementEdits } from "./find.ts";

test("an empty query matches nothing rather than everything", () => {
  assert.deepEqual(findMatches("hello", ""), []);
});

test("matching ignores case unless asked not to", () => {
  assert.equal(findMatches("Cat cat CAT", "cat").length, 3);
  assert.equal(findMatches("Cat cat CAT", "cat", { matchCase: true }).length, 1);
});

test("matches never overlap", () => {
  /* `aa` in `aaaa` is two matches, not three. Three would make replace-all
     consume the same characters twice. */
  assert.deepEqual(findMatches("aaaa", "aa"), [
    { from: 0, to: 2 },
    { from: 2, to: 4 },
  ]);
});

test("whole word refuses a match inside a longer word", () => {
  assert.deepEqual(findMatches("cathedral", "cat", { wholeWord: true }), []);
  assert.deepEqual(findMatches("the cat sat", "cat", { wholeWord: true }), [
    { from: 4, to: 7 },
  ]);
});

test("whole word treats punctuation as a boundary, and digits as not one", () => {
  assert.equal(findMatches("(cat), cat.", "cat", { wholeWord: true }).length, 2);
  assert.equal(findMatches("cat9", "cat", { wholeWord: true }).length, 0);
});

test("a refused whole-word candidate does not hide the next one", () => {
  /* Advancing past the whole rejected candidate would skip the real match that
     begins one character later. */
  assert.deepEqual(findMatches("ccat cat", "cat", { wholeWord: true }), [
    { from: 5, to: 8 },
  ]);
});

test("next from the caret takes the first match at or after it, and wraps", () => {
  const matches = findMatches("a b a b a", "a");
  assert.equal(matchIndexFrom(matches, 0, 1), 0);
  assert.equal(matchIndexFrom(matches, 1, 1), 1);
  assert.equal(matchIndexFrom(matches, 99, 1), 0, "wraps to the top");
});

test("previous from the caret takes the last match that ends before it, and wraps", () => {
  const matches = findMatches("a b a b a", "a");
  assert.equal(matchIndexFrom(matches, 9, -1), 2);
  assert.equal(matchIndexFrom(matches, 5, -1), 1);
  assert.equal(matchIndexFrom(matches, 0, -1), 2, "wraps to the bottom");
});

test("with no matches there is nothing to move to", () => {
  assert.equal(matchIndexFrom([], 0, 1), null);
});

test("replacements are applied from the end, so earlier offsets stay true", () => {
  const matches = findMatches("a a a", "a");
  assert.deepEqual(
    replacementEdits(matches).map((m) => m.from),
    [4, 2, 0],
  );
});
