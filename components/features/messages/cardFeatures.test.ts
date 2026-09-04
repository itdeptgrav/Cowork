import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Shared message cards — location, contact and poll — across both chats.
 *
 * The load-bearing invariant is LOCKSTEP, the same one the mail feature guards:
 * one optional `card` field is consumed by the domain type, both send methods,
 * both repositories' read AND write paths, and both composers and renderers. If
 * one side moves without the others the backends disagree about what a card is,
 * or a card-only message is refused as empty, or a stored poll never renders.
 * Source assertions hold that all sides moved together. The voting LOGIC itself
 * is proved behaviourally in lib/rules/messages/card.test.ts.
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
const TASKREAD = strip("lib/repositories/legacy/taskChat.ts");
const TASKWRITE = strip("lib/legacy/taskWrites.ts");
const LEGACY = strip("lib/repositories/legacy/index.ts");
const CHAT = strip("components/features/tasks/ChatPanel.tsx");
const MSGS = strip("components/features/messages/MessagesArea.tsx");
const COMPOSER = strip("components/features/messages/CardComposer.tsx");
const VIEW = strip("components/features/messages/MessageCardView.tsx");

test("the domain grows one discriminated card union on both message types", () => {
  assert.match(WORK, /export type MessageCard =/);
  assert.match(WORK, /kind: "location"/);
  assert.match(WORK, /kind: "contact"/);
  assert.match(WORK, /kind: "poll"/);
  assert.match(WORK, /card\?: MessageCard;/);
  assert.match(TASKS, /card\?: MessageCard;/);
});

test("both send methods take an optional card and both are card-only friendly", () => {
  assert.match(TYPES, /card\?: MessageCard,\s*\): Promise<ActionResult<Message>>/);
  assert.match(TYPES, /card\?: MessageCard,\s*\): Promise<ActionResult<TaskChatMessage>>/);
  /* The empty-message guard must let a card stand in for text on both paths. */
  assert.match(MOCK, /if \(!text\.trim\(\) && media\.length === 0 && !card\)/);
  assert.match(MOCK, /if \(!text\.trim\(\) && !attachments\.length && !card\)/);
  assert.match(LEGACY, /if \(!body && media\.length === 0 && !card\)/);
});

test("the mock stores a card and only when there is one", () => {
  assert.match(MOCK, /\.\.\.\(card \? \{ card \} : \{\}\)/);
});

test("the legacy write persists a normalised card; the readers default it", () => {
  assert.match(MSGWRITE, /if \(input\.card\) \{\s*body\.card = messageCardForWrite\(input\.card\);/);
  assert.match(MSGWRITE, /const card = readMessageCard\(d\.card\)/);
  assert.match(TASKREAD, /readMessageCard\(m\.card\)/);
  assert.match(TASKWRITE, /card: messageCardForWrite\(input\.card\)/);
});

test("poll voting is a repository method on both chats, in both backends", () => {
  assert.match(TYPES, /voteTaskChatPoll\?\(/);
  assert.match(TYPES, /voteMessagePoll\?\(/);
  for (const src of [MOCK, LEGACY]) {
    assert.match(src, /voteTaskChatPoll\(/);
    assert.match(src, /voteMessagePoll\(/);
    assert.match(src, /togglePollVote\(/);
  }
});

test("both composers mount the share sheet and send its card", () => {
  for (const src of [CHAT, MSGS]) {
    assert.match(src, /<CardComposer/);
    assert.match(src, /onCard=\{\(card\) => void sendCard\(card\)\}/);
    assert.match(src, /async function sendCard\(card: MessageCard\)/);
  }
});

test("both chats render a card and wire a poll vote through", () => {
  for (const src of [CHAT, MSGS]) assert.match(src, /<MessageCardView/);
  /* Task chat calls its vote directly; the message list threads it as a prop. */
  assert.match(CHAT, /repo\.voteTaskChatPoll/);
  assert.match(MSGS, /canVote=\{typeof repo\.voteMessagePoll === "function"\}/);
});

test("the share sheet offers Poll, Location and Contact; the view renders all three", () => {
  assert.match(COMPOSER, /label: "Poll"/);
  assert.match(COMPOSER, /label: "Location"/);
  assert.match(COMPOSER, /label: "Contact"/);
  assert.match(COMPOSER, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(VIEW, /card\.kind === "location"/);
  assert.match(VIEW, /card\.kind === "contact"/);
  /* poll is the fall-through branch */
  assert.match(VIEW, /pollVoterCount\(card\.options\)/);
});
