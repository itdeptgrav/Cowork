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
     out of the bubble path into a centred event. */
  assert.match(CHAT, /const submissionNotice = deleted\s*\?\s*null\s*:\s*parseSubmissionNotice\(m\.text\)/);
  assert.match(CHAT, /: submissionNotice \? \(/);
  assert.match(CHAT, /<SubmissionEventCard/);
  /* Its proof attachments come along, wired to the same image viewer. */
  assert.match(CHAT, /attachments=\{\s*attachments\.length > 0/);
  const card = code("components/features/tasks/SubmissionEventCard.tsx");
  assert.match(card, /Submitted for review/);
});
