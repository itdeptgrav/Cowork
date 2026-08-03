import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAlign, parseFontSize, parseHexColor, parseInline } from "./richText.ts";

test("plain text is one unmarked span", () => {
  assert.deepEqual(parseInline("Dear Mayfair Hotels"), [{ text: "Dear Mayfair Hotels" }]);
});

test("bold, italic and underline are each recognised", () => {
  assert.deepEqual(parseInline("**b**"), [{ text: "b", bold: true }]);
  assert.deepEqual(parseInline("*i*"), [{ text: "i", italic: true }]);
  assert.deepEqual(parseInline("__u__"), [{ text: "u", underline: true }]);
});

test("bold wins over italic — `**x**` is not an italic empty string", () => {
  /* The alternation order is load-bearing: `**` starts with `*`, so trying
     italic first would read this as `*` + `*x*` + `*`. */
  assert.deepEqual(parseInline("**x**"), [{ text: "x", bold: true }]);
});

test("marks are found mid-sentence, with the surrounding text preserved", () => {
  assert.deepEqual(parseInline("Thank you, **Mayfair**, for the work."), [
    { text: "Thank you, " },
    { text: "Mayfair", bold: true },
    { text: ", for the work." },
  ]);
});

test("several marks in one line each keep their own span", () => {
  const spans = parseInline("**A** and *B* and __C__");
  assert.deepEqual(spans.map((s) => s.text), ["A", " and ", "B", " and ", "C"]);
  assert.equal(spans[0]!.bold, true);
  assert.equal(spans[2]!.italic, true);
  assert.equal(spans[4]!.underline, true);
});

test("an unpaired marker stays a literal character rather than breaking the parse", () => {
  /* The whole reason for markers over a structured array: a truncated reply
     degrades to a stray asterisk, not to a thrown error. */
  assert.deepEqual(parseInline("2 * 3 = 6"), [{ text: "2 * 3 = 6" }]);
  assert.deepEqual(parseInline("**unclosed"), [{ text: "**unclosed" }]);
});

test("a marker never spans a line break", () => {
  assert.deepEqual(parseInline("*a\nb*"), [{ text: "*a\nb*" }]);
});

test("empty spans are never produced", () => {
  assert.equal(parseInline("").length, 0);
  assert.ok(parseInline("**a**b").every((s) => s.text.length > 0));
});

test("alignment accepts the four real values and rejects anything else", () => {
  assert.equal(parseAlign("center"), "center");
  assert.equal(parseAlign("justify"), "justify");
  assert.equal(parseAlign("middle"), undefined);
  assert.equal(parseAlign(3), undefined);
});

test("colour accepts hex only — arbitrary CSS never reaches a style attribute", () => {
  assert.equal(parseHexColor("#1a2b3c"), "#1a2b3c");
  assert.equal(parseHexColor("#abc"), "#abc");
  assert.equal(parseHexColor("red"), undefined);
  assert.equal(parseHexColor("red; background: url(x)"), undefined);
  assert.equal(parseHexColor("rgb(1,2,3)"), undefined);
  assert.equal(parseHexColor(42), undefined);
});

test("font size is clamped to something legible, not accepted blindly", () => {
  assert.equal(parseFontSize(18), 18);
  assert.equal(parseFontSize(18.4), 18);
  assert.equal(parseFontSize(2), undefined);
  assert.equal(parseFontSize(400), undefined);
  assert.equal(parseFontSize("18"), undefined);
});
