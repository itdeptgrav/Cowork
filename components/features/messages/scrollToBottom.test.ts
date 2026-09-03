import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * A "jump to latest" button in the message thread.
 *
 * Reading back through a long conversation, the only way to the newest message
 * was to scroll all the way down by hand. Every chat app offers a floating
 * down-arrow for exactly this; the thread now does too — it appears once the
 * reader is well up the history and, on click, smooth-scrolls to the bottom and
 * re-arms auto-follow.
 *
 * Source assertions, in the style of the other wiring tests here: a render test
 * over a prototype thread has no scroll height to be "up the history" of, so
 * what is protected is the wiring — the threshold, the scroll, the re-pin, and
 * the button that calls it.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const SRC = strip("components/features/messages/MessagesArea.tsx");

test("the button's visibility is state, so it can be rendered", () => {
  assert.match(SRC, /const \[showJump, setShowJump\] = useState\(false\)/);
});

test("it appears only when the reader is well up the history", () => {
  /* A larger threshold than the 48px auto-follow pin, so the button does not
     flash in the moment you nudge off the bottom. */
  assert.match(
    SRC,
    /const distFromBottom = el\.scrollHeight - el\.scrollTop - el\.clientHeight;/,
  );
  assert.match(SRC, /setShowJump\(distFromBottom > 240\)/);
  /* The pin keeps its own, tighter threshold. */
  assert.match(SRC, /pinnedRef\.current = distFromBottom < 48;/);
});

test("clicking it smooth-scrolls to the newest message", () => {
  assert.match(SRC, /function scrollToBottom\(\)/);
  assert.match(
    SRC,
    /el\.scrollTo\(\{ top: el\.scrollHeight, behavior: "smooth" \}\)/,
  );
});

test("the jump re-arms auto-follow, so a message mid-animation is not left behind", () => {
  const fn = SRC.slice(
    SRC.indexOf("function scrollToBottom()"),
    SRC.indexOf("function scrollToBottom()") + 260,
  );
  assert.match(fn, /pinnedRef\.current = true;/);
});

test("the button is a down-arrow that calls the jump, and is labelled", () => {
  assert.match(SRC, /\{showJump && \(/);
  assert.match(SRC, /onClick=\{scrollToBottom\}/);
  assert.match(SRC, /aria-label="Scroll to latest messages"/);
  assert.match(SRC, /<Icon\.chevronDown/);
});

test("it floats above the composer, anchored to its top edge", () => {
  /* `bottom-full` on an element inside the `relative` composer puts it just
     above the box — so it clears a reply preview or attachment chips instead of
     overlapping them, and never covers the send button. */
  assert.match(
    SRC,
    /className="relative border-t border-hairline/,
    "the composer must be the positioning context",
  );
  assert.match(SRC, /absolute right-3 bottom-full/);
});
