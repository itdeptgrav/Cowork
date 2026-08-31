import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The auto-growing composer, guarded at the wiring rather than the maths.
 *
 * The behaviour itself — grow to a ceiling, then scroll, shrinking back as lines
 * are deleted — is measured from `scrollHeight`, which only a real layout
 * produces; it was verified in a browser rather than here. What a source test
 * CAN protect is that the wiring stays in place: both composers hold a ref, feed
 * it to the hook keyed on their text, and pass it to a `Textarea` that forwards
 * it. Lose any one of those and the box silently stops growing.
 */
const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const HOOK = strip("lib/hooks/useAutoGrowTextarea.ts");
const PRIMITIVES = strip("components/ui/Primitives.tsx");
const MESSAGES = strip("components/features/messages/MessagesArea.tsx");
const CHAT = strip("components/features/tasks/ChatPanel.tsx");

test("the hook measures from auto, so the box can shrink as well as grow", () => {
  /* Without the reset to `auto`, `scrollHeight` never falls below the current
     height and the box gets stuck tall after lines are deleted. */
  assert.match(HOOK, /el\.style\.height = "auto"/);
  assert.match(HOOK, /Math\.min\(el\.scrollHeight, maxPx\)/);
});

test("the scrollbar appears only at the ceiling, never before", () => {
  assert.match(HOOK, /overflowY = el\.scrollHeight > maxPx \? "auto" : "hidden"/);
});

test("it runs before paint and re-measures on every value change", () => {
  /* A layout effect, so the box is never shown at the wrong height for a frame;
     keyed on `value`, so a restored draft and the clear after send resize it
     too — not only keystrokes an `onInput` would catch. */
  assert.match(HOOK, /useLayoutEffect/);
  assert.match(HOOK, /\[ref, value, maxPx\]/);
});

test("Textarea forwards its ref, so a caller can measure it", () => {
  assert.match(PRIMITIVES, /forwardRef<\s*HTMLTextAreaElement/);
  assert.match(PRIMITIVES, /ref=\{ref\}/);
});

test("both composers grow, with the same helper and the same ceiling", () => {
  for (const [name, src] of [
    ["Messages", MESSAGES],
    ["Task chat", CHAT],
  ] as const) {
    assert.match(src, /useAutoGrowTextarea\(composerRef, text, 128\)/, name);
    assert.match(src, /ref=\{composerRef\}/, `${name} does not pass the ref`);
    assert.match(src, /max-h-32/, `${name} lost its ceiling class`);
    /* `resize-none`, because a drag handle and an auto-growing box fight. */
    assert.match(src, /resize: "none"/, `${name} kept the resize handle`);
  }
});
