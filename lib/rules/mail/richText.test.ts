import assert from "node:assert/strict";
import { test } from "node:test";
import { textToHtml, isRichHtml } from "./richText.ts";

test("textToHtml escapes first, so quoted markup is text, not tags", () => {
  assert.equal(textToHtml("<script>alert(1)</script>"), "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  assert.equal(textToHtml("a & b"), "<p>a &amp; b</p>");
});

test("textToHtml splits blank-line paragraphs and single newlines into <br>", () => {
  assert.equal(textToHtml("hello"), "<p>hello</p>");
  assert.equal(textToHtml("a\nb"), "<p>a<br>b</p>");
  assert.equal(textToHtml("a\n\nb"), "<p>a</p><p>b</p>");
  assert.equal(textToHtml(""), "");
});

test("isRichHtml is false for plain text, even multi-line", () => {
  assert.equal(isRichHtml(""), false);
  assert.equal(isRichHtml("<p>just plain</p>"), false);
  assert.equal(isRichHtml("<p>a<br>b</p>"), false, "a line break alone is not formatting");
});

test("isRichHtml is true for a formatting mark, a list, or multiple blocks", () => {
  assert.equal(isRichHtml("<p><strong>bold</strong></p>"), true);
  assert.equal(isRichHtml("<p><em>i</em></p>"), true);
  assert.equal(isRichHtml("<p><u>u</u></p>"), true);
  assert.equal(isRichHtml('<p><span style="color:#f00">x</span></p>'), true, "colour/font are spans");
  assert.equal(isRichHtml("<ul><li>x</li></ul>"), true);
  assert.equal(isRichHtml('<p><a href="https://x">l</a></p>'), true);
  assert.equal(isRichHtml("<p>a</p><p>b</p>"), true, "more than one paragraph is structure");
});
