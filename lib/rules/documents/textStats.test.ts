import assert from "node:assert/strict";
import { test } from "node:test";
import {
  characterCount,
  paragraphCount,
  readingMinutes,
  wordCount,
} from "./textStats.ts";

test("an empty document has no words, and neither does whitespace", () => {
  assert.equal(wordCount(""), 0);
  assert.equal(wordCount("   \n\n\t "), 0);
});

test("a hyphenated compound is one word", () => {
  assert.equal(wordCount("state-of-the-art design"), 2);
});

test("stray punctuation between spaces is not a word", () => {
  assert.equal(wordCount("one — two • three"), 3);
});

test("any run of whitespace is one boundary", () => {
  assert.equal(wordCount("one\n\n  two\tthree"), 3);
});

test("characters exclude spaces unless asked for", () => {
  assert.equal(characterCount("ab cd"), 4);
  assert.equal(characterCount("ab cd", { includeSpaces: true }), 5);
});

test("a character is a code point, not a UTF-16 unit", () => {
  /* An emoji built from a surrogate pair is one character to a reader, and a
     count that says two is the kind of figure people notice and distrust. */
  assert.equal(characterCount("🙂", { includeSpaces: true }), 1);
});

test("paragraphs are runs of text separated by blank lines", () => {
  assert.equal(paragraphCount("one\n\ntwo\n\n\nthree"), 3);
  assert.equal(paragraphCount("\n\n"), 0);
});

test("reading time is never zero for a document with words in it", () => {
  assert.equal(readingMinutes(0), 0);
  assert.equal(readingMinutes(3), 1);
  assert.equal(readingMinutes(400), 2);
});
