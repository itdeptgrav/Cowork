import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Selecting text in a chat highlights it blue, like every other text box.
 *
 * The app paints selections with `--color-ink` on `--body-bg` — a quiet,
 * monochrome highlight that suits headings and chrome but, on a message someone
 * is trying to copy, reads as a UI state rather than "this text is selected".
 * Chat and message surfaces opt into the familiar blue selection instead,
 * scoped so the rest of the app keeps its quieter one.
 *
 * Source assertions, in the style of the other wiring tests here: what is
 * protected is that the rule EXISTS, is BLUE, is SCOPED, and that both chat
 * surfaces opt in — none of which a render test over a prototype thread shows.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const CSS = readFileSync("app/globals.css", "utf8");

test("chat surfaces paint the selection blue with white text", () => {
  assert.match(
    CSS,
    /\.chat-select ::selection[\s\S]*?background:\s*#1a73e8;[\s\S]*?color:\s*#fff;/,
  );
});

test("text directly in the scoped element is covered too, not only descendants", () => {
  /* `.chat-select ::selection` needs the space-combinator descendant; the
     bare `.chat-select::selection` catches a text node that is a direct child,
     so a message never falls back to the monochrome selection. */
  assert.match(CSS, /\.chat-select ::selection,\s*\.chat-select::selection/);
});

test("the blue is SCOPED — the app keeps its ink selection everywhere else", () => {
  /* The global rule is untouched: still the monochrome ink-on-background
     selection. The additive rule must not have become a global override. */
  assert.match(CSS, /(^|\n)\s*::selection\s*\{\s*background:\s*var\(--color-ink\)/);
  /* No bare `::selection` block carries the blue — it only appears under the
     `.chat-select` scope. */
  assert.doesNotMatch(CSS, /(^|\n)\s*::selection\s*\{[^}]*#1a73e8/);
});

test("task chat opts in", () => {
  const src = strip("components/features/tasks/ChatPanel.tsx");
  assert.match(src, /className="chat-select relative"/);
});

test("the message thread (and its composer) opts in", () => {
  /* The class sits on the conversation pane, which wraps the message list AND
     the composer, so both the messages you read and the box you type in select
     blue. The navigation list beside it keeps the app's quiet selection. */
  const src = strip("components/features/messages/MessagesArea.tsx");
  assert.match(src, /`chat-select min-h-0 deck:col-span-8 /);
});
