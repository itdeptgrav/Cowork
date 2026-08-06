import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldOfferContinuation } from "./continuationSuggest.ts";

const BASE = {
  precedingText: "This is a long enough sentence to justify a continuation.",
  hasSelection: false,
  cursorAtParagraphEnd: true,
  enabled: true,
};

test("offers a continuation when every condition holds", () => {
  assert.equal(shouldOfferContinuation(BASE), true);
});

test("never offers one when the feature is off", () => {
  assert.equal(shouldOfferContinuation({ ...BASE, enabled: false }), false);
});

test("never offers one while something is selected", () => {
  assert.equal(shouldOfferContinuation({ ...BASE, hasSelection: true }), false);
});

test("never offers one mid-sentence", () => {
  assert.equal(shouldOfferContinuation({ ...BASE, cursorAtParagraphEnd: false }), false);
});

test("refuses with too little preceding text, even at a block end", () => {
  assert.equal(
    shouldOfferContinuation({ ...BASE, precedingText: "Hi" }),
    false,
  );
});

test("whitespace-only preceding text does not count", () => {
  assert.equal(
    shouldOfferContinuation({ ...BASE, precedingText: "   \n\n   " }),
    false,
  );
});
