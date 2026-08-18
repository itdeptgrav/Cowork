/**
 * The paste path in the editor, checked against its source.
 *
 * The rules in `clipboardImages.ts` are tested on their own; what this file
 * holds is the WIRING — the handful of decisions that live in the component
 * and that a later edit could quietly undo without any rule test noticing.
 * Each one below is a bug that reached a user once.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const EDITOR = readFileSync(
  "components/features/workspace/DocumentEditor.tsx",
  "utf8",
);

/**
 * The file with its comments removed — a rule named in prose is not a rule.
 *
 * A block comment is only recognised at a line start or after whitespace. The
 * naive form eats the file from `input.accept = "image/*"` onwards, because
 * the `/*` inside that string literal looks like a comment opener, and every
 * check downstream of it then passes by inspecting nothing at all.
 */
const code = EDITOR.replace(/(^|\s)\/\*[\s\S]*?\*\//g, "$1 ").replace(
  /(^|\s)\/\/[^\n]*/g,
  "$1 ",
);

test("the paste handler asks the shared rule, not its own guess", () => {
  /* Reading `clipboardData.files.length` directly is the shortcut that breaks
     screenshots — those arrive only in `items`. The rule reads both. */
  assert.match(code, /pasteIsImage\(\s*event\.clipboardData\s*\)/);
  assert.match(code, /imageFilesFrom\(\s*event\.clipboardData\s*\)/);
});

test("plain paste still wins over an image paste", () => {
  /* Ctrl+Shift+V is an explicit instruction; an image on the clipboard must
     not overrule it. The plain branch has to come FIRST in the handler. */
  const handler = code.slice(code.indexOf("handlePaste"));
  const plainAt = handler.indexOf("plainPasteRef.current");
  const imageAt = handler.indexOf("pasteIsImage");
  assert.ok(plainAt > -1 && imageAt > -1, "both branches present");
  assert.ok(plainAt < imageAt, "plain-paste branch runs before the image one");
});

test("a paste that is not an image falls through untouched", () => {
  /* `return false` hands the paste back to ProseMirror. Returning `true` for
     everything is how an editor stops pasting text at all. */
  assert.match(code, /if\s*\(!pasteIsImage\([^)]*\)\)\s*return false;/);
  assert.match(code, /if\s*\(!images\.length\)\s*return false;/);
});

test("the image is uploaded, never inlined as base64", () => {
  /**
   * The document is a shared CRDT whose HTML is saved, printed and mailed. A
   * pasted screenshot inlined as `data:` would put megabytes into the room for
   * every collaborator, and a failed upload would leave it there for good.
   */
  assert.match(code, /repo\.uploadDriveFile\(file\)/);
  assert.doesNotMatch(code, /readAsDataURL/);
  assert.doesNotMatch(code, /data:image\//);
});

test("the inserted src is the CDN address the rest of the editor uses", () => {
  /* Drive's own URL cannot be drawn in an <img>. This is the same expression
     the insert-image dialog uses, so pasted and inserted pictures are alike. */
  assert.match(code, /driveImageSrc\(r\.data\.fileId\)/);
});

test("the insert position is clamped to the live document", () => {
  /* A collaborator can shorten the document while the upload is in flight; an
     unclamped position throws instead of landing at the end. */
  assert.match(code, /Math\.min\(at,\s*view\.state\.doc\.content\.size\)/);
});

test("a failed upload reports, and inserts nothing", () => {
  assert.match(code, /if\s*\(!r\.ok\)\s*\{\s*setError\(r\.message\);/);
});

test("the busy flag is always cleared", () => {
  /* Without `finally`, one failed upload leaves \"Adding image…\" on screen
     for the rest of the session. */
  assert.match(code, /finally\s*\{\s*setPasting\(false\);/);
});

test("the paste never silently does nothing", () => {
  /* Either the picture appears or the banner explains why. */
  assert.match(code, /setPasting\(true\)/);
  assert.match(code, /\{pasting &&/);
});
