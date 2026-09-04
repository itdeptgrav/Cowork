import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesQuery, snippetAround, searchSegments } from "./globalSearch.ts";

test("matchesQuery is a case-insensitive substring, blank matches nothing", () => {
  assert.equal(matchesQuery("Let's ship the Invoice today", "invoice"), true);
  assert.equal(matchesQuery("Let's ship the Invoice today", "INVOICE"), true);
  assert.equal(matchesQuery("nothing here", "invoice"), false);
  assert.equal(matchesQuery("anything", "   "), false);
});

test("snippetAround centres on the match and elides what it cut", () => {
  const long = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaXXtargetYYbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const s = snippetAround(long, "target", 10);
  assert.match(s, /^…/);
  assert.match(s, /…$/);
  assert.match(s, /target/);
  // a short message is returned whole (no ellipses)
  assert.equal(snippetAround("hi target", "target", 10), "hi target");
});

test("searchSegments marks each occurrence for highlighting, preserving case", () => {
  const segs = searchSegments("Invoice invoice", "invoice");
  assert.deepEqual(segs, [
    { text: "Invoice", match: true },
    { text: " ", match: false },
    { text: "invoice", match: true },
  ]);
  // blank query → one plain run
  assert.deepEqual(searchSegments("plain", ""), [{ text: "plain", match: false }]);
  // no match → one plain run
  assert.deepEqual(searchSegments("plain", "zzz"), [{ text: "plain", match: false }]);
});
