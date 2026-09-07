import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * A rework in the task chat is its own card — reason plus the score outcome —
 * not the 11px grey whisper it used to be. The parsing and the card render
 * their own logic; these pin the wiring that connects them.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const CHAT = code("components/features/tasks/ChatPanel.tsx");
const CARD = code("components/features/tasks/ReworkEventCard.tsx");

test("the chat detects a rework line and renders the rework card", () => {
  assert.match(CHAT, /const notice = parseReworkNotice\(m\.text\)/);
  assert.match(CHAT, /<ReworkEventCard/);
  /* Non-rework system lines still fall through to ChangeEventCard. */
  assert.match(CHAT, /<ChangeEventCard/);
});

test("the deduction outcome is read straight from the parsed line", () => {
  /* The engine states the outcome on the message itself, so the card reads it
     from `notice.deduction` — no fragile record match, and no hardcoded amount:
     the points are the admin-set value the engine wrote into the line. */
  assert.match(CHAT, /deductionWaived=\{\s*notice\.deduction \? notice\.deduction\.waived : null\s*\}/);
  assert.match(CHAT, /deductionPoints=\{notice\.deduction\?\.points \?\? 0\}/);
  /* The frontend no longer imports a fixed deduction constant for display. */
  assert.doesNotMatch(CHAT, /REWORK_DEDUCTION/);
});

test("the card shows points cut, or that the deduction was waived", () => {
  assert.match(CARD, /Deduction waived · no points cut/);
  assert.match(CARD, /deducted from this task/);
  assert.match(CARD, /−\{deductionPoints\}/);
  /* Unknown (no record matched) omits the score line rather than guessing. */
  assert.match(CARD, /deductionWaived !== null &&/);
});

test("a submission renders as an event card, not a personal bubble", () => {
  /* The engine posts it as the submitter, so it must be recognised and lifted
     out of the bubble path into an event card. */
  assert.match(CHAT, /const submissionNotice = deleted\s*\?\s*null\s*:\s*parseSubmissionNotice\(m\.text\)/);
  assert.match(CHAT, /: submissionNotice \? \(/);
  assert.match(CHAT, /<SubmissionEventCard/);
  /* Its proof attachments come along, wired to the same image viewer. */
  assert.match(CHAT, /attachments=\{\s*attachments\.length > 0/);
  const card = code("components/features/tasks/SubmissionEventCard.tsx");
  assert.match(card, /Submitted for review/);
});

test("both event cards take a side rather than sitting in the middle", () => {
  /* A handover and a return are two people answering each other, so they sit
     where their messages sit. Centred said "the room announced this" about
     something one person did. */
  const sub = code("components/features/tasks/SubmissionEventCard.tsx");
  for (const card of [CARD, sub]) {
    assert.match(card, /mine \? "justify-end" : "justify-start"/);
    assert.doesNotMatch(card, /justify-center/);
    /* The accent mirrors onto the outer edge, so a card on the right does not
       point its rule back into the thread. */
    assert.match(card, /mine \? "border-e-2" : "border-s-2"/);
    assert.match(card, /borderInlineEndColor/);
    assert.match(card, /borderInlineStartColor/);
  }
});

test("each card is sided from the person who actually did it", () => {
  /* A submission carries the submitter's id, so the ordinary sender test is
     right. A rework is posted as `system` and only NAMES its reviewer, so it
     goes through the resolver instead of a string comparison written here. */
  assert.match(CHAT, /<SubmissionEventCard[\s\S]*?mine=\{mine\}/);
  assert.match(
    CHAT,
    /mine=\{eventByViewer\(\{\s*actorName: notice\.byName \|\| m\.senderName,/,
  );
  assert.match(CHAT, /import \{ eventByViewer \} from "@\/lib\/rules\/messages\/eventSide"/);
});

test("the cards use their own surface, not the raised film", () => {
  /* `--surface-raised` lifted them above the conversation and made them the
     brightest thing in a thread they are only part of. */
  const sub = code("components/features/tasks/SubmissionEventCard.tsx");
  for (const card of [CARD, sub]) {
    assert.match(card, /bg-\[var\(--event-card\)\]/);
    assert.doesNotMatch(card, /bg-\[var\(--surface-raised\)\]/);
  }
});
