import assert from "node:assert/strict";
import { test } from "node:test";
import { isEmptyHtml, previewOfHtml } from "./preview.ts";

test("tags are stripped rather than rendered", () => {
  /* The list is text. Passing a document's own markup through would let a
     heading in somebody's notes restyle the sidebar. */
  assert.equal(previewOfHtml("<h1>Plan</h1><p>for Q3</p>"), "Plan for Q3");
});

test("block boundaries become a space, so paragraphs do not fuse", () => {
  assert.equal(previewOfHtml("<p>one</p><p>two</p>"), "one two");
});

test("script and style content is dropped, not just their tags", () => {
  /* Stripping only the tags would leave the stylesheet text in the preview. */
  assert.equal(previewOfHtml("<style>p{color:red}</style><p>Hi</p>"), "Hi");
  assert.equal(previewOfHtml("<script>alert(1)</script><p>Hi</p>"), "Hi");
});

test("entities are decoded", () => {
  assert.equal(previewOfHtml("<p>Tom &amp; Jerry&nbsp;&#39;s</p>"), "Tom & Jerry 's");
});

test("a long document is cut on a word and marked", () => {
  const long = `<p>${"alpha ".repeat(60)}</p>`;
  const out = previewOfHtml(long);
  assert.ok(out.length <= 141, `cut to ${out.length}`);
  assert.ok(out.endsWith("…"));
  assert.ok(!out.includes("alph…"), "cut mid-word");
});

test("an empty or markup-only document reads as empty", () => {
  assert.equal(previewOfHtml(""), "");
  assert.equal(previewOfHtml("<p></p>"), "");
  assert.equal(isEmptyHtml("<p><br></p>"), true);
  assert.equal(isEmptyHtml("<p>x</p>"), false);
});
