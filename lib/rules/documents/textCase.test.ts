import assert from "node:assert/strict";
import { test } from "node:test";
import { CASE_MODES, applyCase } from "./textCase.ts";

test("upper and lower are total and boring", () => {
  assert.equal(applyCase("Hello, World 42!", "upper"), "HELLO, WORLD 42!");
  assert.equal(applyCase("Hello, World 42!", "lower"), "hello, world 42!");
  assert.equal(applyCase("", "upper"), "");
});

test("title case starts every word with a capital and lowers the rest", () => {
  /* The everyday use is repair — a heading typed with caps-lock on. */
  assert.equal(applyCase("QUARTERLY sales REPORT", "title"), "Quarterly Sales Report");
  assert.equal(applyCase("hello world", "title"), "Hello World");
});

test("punctuation-led words capitalise their first LETTER", () => {
  assert.equal(applyCase('(hello "world"', "title"), '(Hello "World"');
  /* A word with no letter at all is left exactly alone. */
  assert.equal(applyCase("42 + 17", "title"), "42 + 17");
});

test("whitespace is preserved character for character", () => {
  /* The transform must touch letters and nothing else — collapsing runs of
     spaces would move text under a comment mark. */
  assert.equal(applyCase("a  b\tc", "title"), "A  B\tC");
});

test("non-Latin letters are handled by the platform, not skipped", () => {
  assert.equal(applyCase("über café", "title"), "Über Café");
  assert.equal(applyCase("über", "upper"), "ÜBER");
});

test("the three modes are exactly the three the menu offers", () => {
  assert.deepEqual([...CASE_MODES], ["upper", "lower", "title"]);
});
