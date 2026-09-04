import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * @-mentions end to end: an optional `mentionIds` field on both message types,
 * carried by both send paths in both backends, an autocomplete in both
 * composers, and a highlight on read. Source assertions, in the wiring-test
 * style: what is protected is that the plumbing is connected in BOTH chats.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const WORK = strip("lib/domain/work.ts");
const TASKS = strip("lib/domain/tasks.ts");
const TYPES = strip("lib/repositories/types.ts");
const MOCK = strip("lib/repositories/mock/index.ts");
const MSGWRITE = strip("lib/repositories/legacy/messaging.ts");
const CHAT = strip("components/features/tasks/ChatPanel.tsx");
const MSGS = strip("components/features/messages/MessagesArea.tsx");

test("both message types carry an optional mentionIds", () => {
  assert.match(WORK, /mentionIds\?: EmployeeId\[\];/);
  assert.match(TASKS, /mentionIds\?: EmployeeId\[\];/);
});

test("both send methods accept mentionIds, and the mock stores them", () => {
  /* `card?` now follows `mentionIds?` on both signatures — assert both trailing
     params are present before the return type. */
  assert.match(TYPES, /mentionIds\?: EmployeeId\[\],\s*card\?: MessageCard,\s*\): Promise<ActionResult<Message>>/);
  assert.match(TYPES, /mentionIds\?: EmployeeId\[\],\s*card\?: MessageCard,\s*\): Promise<ActionResult<TaskChatMessage>>/);
  /* Mock stores it, minus the sender, only when there are any. */
  assert.match(MOCK, /const mentions = \[\.\.\.new Set\(mentionIds \?\? \[\]\)\]\.filter\(\(id\) => id !== actingId\(\)\)/);
  assert.match(MOCK, /\.\.\.\(mentions\.length \? \{ mentionIds: mentions \} : \{\}\)/);
});

test("the legacy message write persists mentionIds only when present", () => {
  assert.match(MSGWRITE, /if \(input\.mentionIds && input\.mentionIds\.length\) \{/);
  assert.match(MSGWRITE, /body\.mentionIds = \[\.\.\.new Set\(input\.mentionIds\)\]/);
  /* And the reader defaults it. */
  assert.match(MSGWRITE, /mentions\.length \? \{ mentionIds: mentions \}/);
});

test("both composers run the autocomplete and send its ids", () => {
  for (const src of [CHAT, MSGS]) {
    assert.match(src, /const mentions = useMentions\(\{/);
    assert.match(src, /if \(mentions\.onKeyDown\(e\)\) return;/);
    assert.match(src, /mentions\.mentionIds\(\)/);
    assert.match(src, /mentions\.reset\(\)/);
    assert.match(src, /\{mentions\.menu\}/);
  }
});

test("both chats highlight the mention on read", () => {
  /* Task chat renders through MessageText; the message thread composes the
     highlight with its URL linkify. */
  assert.match(CHAT, /<MessageText[\s\S]*?mentionTokens=\{mentionTokensFor\(/);
  assert.match(MSGS, /mentionSegments\([\s\S]*?mentionTokensFor\(/);
});
