/**
 * The two bubble bars, checked against their source.
 *
 * A `BubbleMenu` positions itself from a ProseMirror plugin and does NOT
 * re-render its React children when the selection moves. A bar that reads
 * `editor.getAttributes(...)` during render therefore shows whatever was true
 * at the last React render — and since both bars only appear once the caret is
 * already on the thing they describe, that is the state from BEFORE it got
 * there.
 *
 * It cost a live bug: a perfectly good `https://` link came up labelled
 * "Unsafe link — not opened", because the href read as empty. Nothing in the
 * rule tests could catch it; only mounting the component did. This file keeps
 * it from coming back.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const files = {
  link: "components/features/workspace/docs/DocsLinkBubble.tsx",
  image: "components/features/workspace/docs/DocsImageToolbar.tsx",
} as const;

/**
 * Source with comments stripped — a rule named in prose is not a rule.
 *
 * A block comment is only recognised at a line start or after whitespace. The
 * naive form eats the file from `input.accept = "image/*"` onwards, because
 * the `/*` inside that string literal looks like a comment opener; the checks
 * downstream of it then pass by inspecting nothing at all.
 */
const codeOf = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/(^|\s)\/\*[\s\S]*?\*\//g, "$1 ")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1 ");

for (const [name, path] of Object.entries(files)) {
  test(`the ${name} bar reads editor state reactively`, () => {
    const code = codeOf(path);
    assert.match(
      code,
      /useEditorState\(\{/,
      "must read through useEditorState, or it renders stale state",
    );
  });

  test(`the ${name} bar never reads attributes straight off the editor in render`, () => {
    /**
     * `editor.getAttributes(...)` and `editor.isActive(...)` are only correct
     * inside the `useEditorState` selector, which re-runs on every
     * transaction. Outside it they are a snapshot of the last render.
     */
    const code = codeOf(path);
    const selectorStart = code.indexOf("selector:");
    const selectorEnd = code.indexOf("});", selectorStart);
    assert.ok(selectorStart > -1 && selectorEnd > selectorStart, "selector found");

    /* Everything except the selector body and the `shouldShow` callback, which
       ProseMirror calls itself on every transaction and which is therefore
       always current. */
    const outside =
      code.slice(0, selectorStart) + code.slice(selectorEnd);
    const withoutShouldShow = outside.replace(
      /shouldShow=\{[\s\S]*?\n\s*\}/,
      " ",
    );
    /* Event handlers run on click, long after render, so reading there is
       fine — they are stripped before the check. */
    const renderOnly = withoutShouldShow
      .replace(/onClick=\{[\s\S]*?\n\s{6,}\}\}/g, " ")
      .replace(/const \w+ = \(\) => \{[\s\S]*?\n  \};/g, " ");

    assert.doesNotMatch(
      renderOnly,
      /editor\.getAttributes\(/,
      "reads attributes during render — will show the previous selection",
    );
  });
}

test("the link bar decides safety with the shared rule", () => {
  /* Not with its own `startsWith("http")`, which lets through
     `httpx:` and reports `mailto:` as unsafe. */
  const code = codeOf(files.link);
  assert.match(code, /isSafeHref\(/);
  assert.match(code, /normaliseHref\(/);
  assert.match(code, /linkLabel\(/);
});

test("the link bar opens with noopener", () => {
  /**
   * Without it the opened page gets a handle on the tab it came from and can
   * navigate it — on a signed-in workspace that is how a convincing fake login
   * gets in front of somebody who only clicked a link in a colleague's
   * document.
   */
  const code = codeOf(files.link);
  assert.match(code, /window\.open\(\s*href,\s*"_blank",\s*LINK_WINDOW_FEATURES\s*\)/);
});

test("an unsafe href is never opened, whatever the button says", () => {
  const code = codeOf(files.link);
  assert.match(code, /const open = \(\) => \{\s*if \(!safe\) return;/);
});

test("removing a link keeps the text", () => {
  /* `unsetLink`, not `deleteSelection` — the words are the writer's, only the
     address is being dropped. */
  const code = codeOf(files.link);
  assert.match(code, /extendMarkRange\("link"\)\s*\.unsetLink\(\)/);
  assert.doesNotMatch(code, /unsetLink[\s\S]{0,80}deleteSelection/);
});

test("replacing an image changes only which picture it is", () => {
  /**
   * The size, alignment and crop live on the node. A swap that reset them
   * would throw away a layout somebody spent time on — so `src` changes, the
   * stale natural size is cleared, and nothing else is touched.
   */
  const editor = codeOf("components/features/workspace/DocumentEditor.tsx");
  const at = editor.indexOf("const replaceImage");
  assert.ok(at > -1, "replaceImage exists");
  /* Bounded at the function's own closing brace — a fixed-size window spills
     into the next function and tests that one by accident. */
  const end = editor.indexOf("\n  };", at);
  assert.ok(end > at, "replaceImage closes");
  const body = editor.slice(at, end);
  assert.match(body, /updateAttributes\("image", \{\s*src,/);
  assert.match(body, /naturalWidth: null/);
  assert.doesNotMatch(body, /align:/);
  assert.doesNotMatch(body, /crop:/);
  assert.doesNotMatch(body, /widthPct:/);
});
