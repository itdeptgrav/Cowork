import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * A Gmail-style formatting toolbar that actually works — bold/italic/underline,
 * font, size, colour, alignment, lists, links, emoji — plus SAFE rendering of
 * the resulting rich body. The security-critical part is that a stored body is
 * never rendered raw: it is parsed back through the same TipTap schema (an
 * allowlist) and then a DOM pass neutralises dangerous link protocols.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const DOMAIN = strip("lib/domain/mail.ts");
const PURE = strip("lib/repositories/legacy/mail.ts");
const MOCK = strip("lib/repositories/mock/index.ts");
const LEGACY = strip("lib/repositories/legacy/index.ts");
const EXT = strip("components/features/mail/mailEditorExtensions.ts");
const EDITOR = strip("components/features/mail/RichTextEditor.tsx");
const RENDER = strip("components/features/mail/MailRichText.tsx");
const COMPOSE = strip("components/features/mail/MailCompose.tsx");
const THREAD = strip("components/features/mail/MailThreadView.tsx");

test("a message can carry a rich body, optional and defaulted on read", () => {
  assert.match(DOMAIN, /bodyHtml\?: string;/);
  assert.match(PURE, /bodyHtml:\s*\n?\s*typeof d\.bodyHtml === "string"/);
  /* Written as null, never undefined (Firestore rejects undefined). */
  assert.match(PURE, /bodyHtml: m\.bodyHtml \?\? null/);
});

test("send and save-draft carry bodyHtml, both backends set it", () => {
  for (const src of [MOCK, LEGACY]) {
    assert.match(src, /bodyHtml: input\.bodyHtml/);
  }
});

test("the composer and renderer share ONE schema — the sanitiser", () => {
  /* Both import the same extensions factory, so what is formatted is what
     renders, and a stored body is parsed back through the same allowlist. */
  assert.match(EDITOR, /mailEditorExtensions/);
  assert.match(RENDER, /mailEditorExtensions/);
  /* Link is constrained to safe protocols; no image/script node is enabled. */
  assert.match(EXT, /defaultProtocol: "https"/);
  assert.doesNotMatch(EXT, /Image|Iframe|Html/);
});

test("the toolbar wires every Gmail-style control to a real command", () => {
  assert.match(EDITOR, /toggleBold\(\)/);
  assert.match(EDITOR, /toggleItalic\(\)/);
  assert.match(EDITOR, /toggleUnderline\(\)/);
  assert.match(EDITOR, /setFontFamily\(/);
  assert.match(EDITOR, /setFontSize\(/);
  assert.match(EDITOR, /setColor\(/);
  assert.match(EDITOR, /setTextAlign\("center"\)/);
  assert.match(EDITOR, /toggleBulletList\(\)/);
  assert.match(EDITOR, /toggleOrderedList\(\)/);
  assert.match(EDITOR, /setLink\(\{ href/);
  assert.match(EDITOR, /insertContent\(e\)/); // emoji
  assert.match(EDITOR, /\.undo\(\)/);
});

test("rendering a stored body is double-sanitised, never raw", () => {
  /* Layer 1: schema round-trip drops scripts/handlers/unknown tags. */
  assert.match(RENDER, /generateHTML\(generateJSON\(html, exts\), exts\)/);
  /* Layer 2: a DOM pass strips dangerous hrefs and any residual handler. */
  assert.match(RENDER, /SAFE_HREF\.test\(href\)/);
  assert.match(RENDER, /\^\(https\?:\|mailto:/);
  assert.match(RENDER, /removeAttribute\(attr\.name\)/);
  /* dangerouslySetInnerHTML is used ONLY on the sanitised output. */
  assert.match(RENDER, /dangerouslySetInnerHTML=\{\{ __html: clean \}\}/);
});

test("compose stores rich HTML only when it is actually formatted", () => {
  assert.match(COMPOSE, /<RichTextEditor/);
  assert.match(COMPOSE, /isRichHtml\(bodyHtml\) \? bodyHtml : undefined/);
  /* `body` stays the plain text the grammar gate and search read. */
  assert.match(COMPOSE, /setBodyHtml\(html\);\s*setBody\(text\);/);
});

test("the thread renders a rich body through the safe renderer, plain otherwise", () => {
  assert.match(THREAD, /import \{ MailRichText \}/);
  assert.match(THREAD, /message\.bodyHtml \?/);
  assert.match(THREAD, /<MailRichText html=\{message\.bodyHtml\}/);
});
