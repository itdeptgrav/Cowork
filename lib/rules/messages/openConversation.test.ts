import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { conversationIdFromPath, switchesInPlace } from "./openConversation.ts";

/* Chats switch in place, so the address bar — not the route's props — names
   the open conversation (10 Nov 2026). */

test("the path names the open conversation, whatever the page was loaded as", () => {
  assert.equal(conversationIdFromPath("/messages/GR0000_GR0063", undefined), "GR0000_GR0063");
  assert.equal(conversationIdFromPath("/messages/B", "A"), "B");
  assert.equal(conversationIdFromPath("/messages/dm%20x", undefined), "dm x");
});

test("back on the list, nothing is open", () => {
  assert.equal(conversationIdFromPath("/messages", "A"), undefined);
  assert.equal(conversationIdFromPath("/messages/", "A"), undefined);
});

test("before the path resolves, the route's own id stands", () => {
  assert.equal(conversationIdFromPath(null, "A"), "A");
});

const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

test("a plain click switches in place; a modified one still opens a new tab", () => {
  assert.equal(switchesInPlace(click), true);
  assert.equal(switchesInPlace({ ...click, ctrlKey: true }), false);
  assert.equal(switchesInPlace({ ...click, metaKey: true }), false);
  assert.equal(switchesInPlace({ ...click, shiftKey: true }), false);
  assert.equal(switchesInPlace({ ...click, button: 1 }), false);
});

test("the rows switch with pushState and the page reads the path", () => {
  const src = readFileSync("components/features/messages/MessagesArea.tsx", "utf8");
  assert.match(src, /window\.history\.pushState\(null, "", `\/messages\/\$\{c\.id\}`\);/);
  assert.match(src, /const conversationId = conversationIdFromPath\(pathname, routedConversationId\);/);
});
