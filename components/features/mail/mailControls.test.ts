import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The mailbox controls that were built but never wired: opening a thread marks
 * it read, a message can be starred, a thread moved to Trash, and a reply can go
 * to everyone. All reuse the repository methods that already existed —
 * `setMailRead` / `setMailFlag` / `sendMail` — so what these guard is the
 * WIRING, which a render test over an empty prototype mailbox cannot show.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const AREA = strip("components/features/mail/MailArea.tsx");
const THREAD = strip("components/features/mail/MailThreadView.tsx");
const COMPOSE = strip("components/features/mail/MailCompose.tsx");

test("the Starred/Important views reach the query, and rows show their state", () => {
  assert.match(AREA, /flagView === "starred" \? \{ starred: true \}/);
  assert.match(AREA, /flagView === "important" \? \{ important: true \}/);
  /* deps include flagView so switching a cross-folder view refetches. */
  assert.match(AREA, /\[folder, transport, search, flagView\]/);
  assert.match(AREA, /thread\.unread === true/);
  assert.match(AREA, /thread\.starred &&/);
  assert.match(AREA, /thread\.important &&/);
  assert.match(AREA, /thread\.hasAttachments &&/);
});

test("Spam is a folder; Starred and Important are mutually-exclusive views", () => {
  assert.match(AREA, /id: "spam", label: "Spam"/);
  /* One piece of state means they can never both be on. */
  assert.match(AREA, /useState<null \| "starred" \| "important">\(null\)/);
});

test("a Drafts row opens the composer to be finished, not the read view", () => {
  assert.match(AREA, /folder !== "drafts"/);
  assert.match(AREA, /setEditingDraft\(draft\)/);
  assert.match(AREA, /<MailCompose[\s\S]*?editingDraft=\{editingDraft\}/);
});

test("the thread view flags Spam/Not-spam and Important, wired to setMailFlag", () => {
  assert.match(THREAD, /setMailFlag\(m\.id, "spam", on\)/);
  assert.match(THREAD, /setMailFlag\(m\.id, "important", on\)/);
  assert.match(THREAD, /inSpam \? "Not spam" : "Report spam"/);
});

test("compose can Save Draft — no recipient or grammar gate — and discards it on send", () => {
  assert.match(COMPOSE, /r\.saveMailDraft\(\{/);
  assert.match(COMPOSE, /canSaveDraft/);
  assert.match(COMPOSE, /Save draft/);
  /* A sent draft is removed so it does not linger in Drafts. */
  assert.match(COMPOSE, /sent\.ok && editingDraft.*r\.discardMailDraft\(editingDraft\.id\)/);
  /* A sent draft continues its own thread. */
  assert.match(COMPOSE, /editingDraft\s*\?\s*editingDraft\.threadId/);
});

test("the thread view is handed the folder and a change callback", () => {
  assert.match(AREA, /<MailThreadView[\s\S]*?folder=\{folder\}/);
  assert.match(AREA, /<MailThreadView[\s\S]*?onChanged=\{/);
});

test("opening a thread marks the messages addressed to me read, once each", () => {
  assert.match(THREAD, /m\.from\.employeeId !== me &&\s*!m\.readBy\.includes\(me\)/);
  assert.match(THREAD, /repo\.setMailRead\(m\.id, true\)/);
  /* A ref stops a failed write retrying in a loop. */
  assert.match(THREAD, /markedRef/);
});

test("star, trash/restore and mark-unread are wired to the existing methods", () => {
  assert.match(THREAD, /setMailFlag\(m\.id, "starred", on\)/);
  assert.match(THREAD, /setMailFlag\(m\.id, "trashed", on\)/);
  assert.match(THREAD, /setMailRead\(m\.id, false\)/);
  /* Trash flips to Restore when the thread was opened from Trash. */
  assert.match(THREAD, /const inTrash = folder === "trash"/);
});

test("the sender sees a status chip; Reply All appears only when it differs", () => {
  assert.match(THREAD, /mailSendStatus\(/);
  assert.match(THREAD, /countOthers\(last, me\) > 1/);
  assert.match(THREAD, /setReply\(\{ mode: "replyAll" \}\)/);
});

/* ── The spelling & grammar check ─────────────────────────────────────────── */

test("the spelling & grammar check does not hold Send shut", () => {
  /**
   * **OWNER DECISION, 23 September 2026.** It used to: the footer read "Run the
   * spelling & grammar check before sending" and Send stayed dead until Check
   * now had been pressed. Asked to make it optional — a message can be sent
   * without ever running it.
   *
   * Pinned from the REFUSAL rather than from the button, because that is where
   * it lived: one string, computed from a chain, and `disabled={!!refusal}`.
   * Anything added back to that chain turns the offer into a gate again.
   */
  assert.doesNotMatch(COMPOSE, /Run the spelling & grammar check before sending/);
  assert.doesNotMatch(COMPOSE, /grammarChecked \?.*refusal|!grammarChecked \?/);
  assert.match(COMPOSE, /disabled=\{!!refusal \|\| state\.isPending\}/);

  /* The chain that IS there: things Cowork genuinely cannot do. */
  assert.match(COMPOSE, /uploading \? "Wait for the attachment upload to finish\." : null/);
  assert.match(COMPOSE, /recipientRefusal\(\{ to: recipients, cc, bcc \}\)/);
  assert.match(COMPOSE, /sendRefusal\(\{/);
});

test("the check itself is untouched — it still runs, and still offers its fixes", () => {
  /* Made optional, not removed. The panel, the pass over subject and body, the
     suggestions and both ways of answering them all stay. */
  assert.match(COMPOSE, /Check spelling & grammar — optional/);
  assert.match(COMPOSE, /"Check now"/);
  assert.match(COMPOSE, /✓ Spelling & grammar checked/);
  assert.match(COMPOSE, /improveText\(\{ text: subject, mode: "grammar"/);
  assert.match(COMPOSE, /improveText\(\{ text: body, mode: "grammar"/);
  assert.match(COMPOSE, /Apply corrections/);
  /* It said "Send as written" when pressing it was what let you send. It no
     longer unblocks anything, so it no longer says it does. */
  assert.match(COMPOSE, /Keep my wording/);
  assert.doesNotMatch(COMPOSE, /Send as written/);
});

test("compose supports Reply All, on the same thread, never addressing you", () => {
  assert.match(COMPOSE, /"reply" \| "replyAll" \| "forward"/);
  assert.match(COMPOSE, /replySeed\(mode \?\? "forward", replyTo, viewerId\)/);
  /* Reply and Reply All both continue the original thread. */
  assert.match(
    COMPOSE,
    /mode === "reply" \|\| mode === "replyAll"[\s\S]*?replyTo\.threadId/,
  );
  assert.match(COMPOSE, /"Reply all"/);
});
