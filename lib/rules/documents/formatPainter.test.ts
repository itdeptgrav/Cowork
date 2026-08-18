import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  UNPAINTABLE_MARKS,
  isPaintable,
  paintableFormat,
} from "./formatPainter.ts";

const mark = (name: string, attrs: Record<string, unknown> = {}) => ({
  type: { name },
  attrs,
});

test("style is paintable; identity is not", () => {
  /* Bold is how text LOOKS. A link is what text IS — painting a URL onto
     unrelated words creates a link nobody meant. */
  for (const style of ["bold", "italic", "underline", "textStyle", "highlight"]) {
    assert.equal(isPaintable(style), true, `${style} should paint`);
  }
  for (const identity of UNPAINTABLE_MARKS) {
    assert.equal(isPaintable(identity), false, `${identity} must never paint`);
  }
});

test("a copy takes attributes along, and drops the identity marks", () => {
  const format = paintableFormat([
    mark("bold"),
    mark("textStyle", { color: "#c00", fontSize: "14pt" }),
    mark("link", { href: "https://example.com" }),
    mark("comment", { threadId: "t1" }),
  ]);
  assert.deepEqual(format.marks.map((m) => m.type), ["bold", "textStyle"]);
  assert.deepEqual(format.marks[1].attrs, { color: "#c00", fontSize: "14pt" });
});

test("copying plain text is a real, empty format", () => {
  /* Painting FROM unformatted text CLEARS the target's styling — that is what
     the roller means there, not a no-op. */
  assert.deepEqual(paintableFormat([]), { marks: [] });
});

test("a new visual mark paints without editing this file", () => {
  /* Excluded by name, so unknown marks default to paintable — style added
     later just works, while the identity three fail closed. */
  assert.equal(isPaintable("someFutureShadowMark"), true);
});

test("the toolbar's painter clears only paintable marks before applying", () => {
  /**
   * **Found already shipped, with the exact defect this rule names.** The
   * toolbar's roller cleared the target with `unsetAllMarks()` — a link
   * painted over stopped being a link, and a comment's anchor came off the
   * words its thread was about. It now clears one paintable type at a time,
   * and the identity marks stay put.
   */
  const src = readFileSync(
    "components/features/workspace/docs/DocsToolbar.tsx",
    "utf8",
  );
  assert.match(src, /if \(isPaintable\(type\)\) chain = chain\.unsetMark\(type\)/);
  /* Comments stripped: the code's own note NAMES `unsetAllMarks` to explain
     why it must not be used, which is the opposite of using it. */
  const painter = src
    .slice(src.indexOf("const applyPainter"), src.indexOf("const indent"))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(
    /unsetAllMarks/.test(painter),
    false,
    "the painter strips identity marks from the target again",
  );
});
