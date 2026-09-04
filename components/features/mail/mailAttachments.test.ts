import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Mail attachments — uploaded to Drive (resumable, uncapped) and carried INLINE
 * on the message, exactly as chat does, so preview and download reuse the chat
 * renderer and no separate `cowork_mail_attachments` write (whose rules are
 * unknown) is needed. Source assertions, in the wiring-test style here.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const DOMAIN = strip("lib/domain/mail.ts");
const PURE = strip("lib/repositories/legacy/mail.ts");
const TYPES = strip("lib/repositories/types.ts");
const MOCK = strip("lib/repositories/mock/index.ts");
const LEGACY = strip("lib/repositories/legacy/index.ts");
const COMPOSE = strip("components/features/mail/MailCompose.tsx");
const THREAD = strip("components/features/mail/MailThreadView.tsx");

test("a message carries inline attachments, optional and defaulted on read", () => {
  assert.match(DOMAIN, /attachments\?: MessageAttachment\[\];/);
  assert.match(PURE, /attachments: Array\.isArray\(d\.attachments\)/);
  /* Written with no undefined — Firestore rejects it. */
  assert.match(PURE, /url: a\.url \?\? ""/);
  assert.match(PURE, /fileId: a\.fileId \?\? null/);
});

test("send and save-draft accept inline attachments, both backends set them", () => {
  assert.match(TYPES, /attachments\?: MessageAttachment\[\];/);
  for (const src of [MOCK, LEGACY]) {
    assert.match(src, /attachments: input\.attachments \?\? \[\]/);
  }
});

test("compose uploads to Drive first, then stages — huge-safe, count-capped", () => {
  assert.match(COMPOSE, /repo\.uploadMessageAttachment!\(file/);
  assert.match(COMPOSE, /MAX_MAIL_ATTACHMENTS/);
  /* No app-level SIZE cap — the requirement — only a count guard. */
  assert.match(COMPOSE, /no size limit/i);
  /* A failed upload never leaves a half-sent message: send waits for uploads. */
  assert.match(COMPOSE, /uploading \? "Wait for the attachment upload/);
});

test("compose sends and saves the staged attachments", () => {
  assert.match(COMPOSE, /attachments: pending/);
  /* Prefilled when finishing a draft. */
  assert.match(COMPOSE, /editingDraft\?\.attachments \?\? \[\]/);
});

test("the thread previews/downloads attachments through the chat renderer", () => {
  assert.match(THREAD, /import \{ MessageAttachments \}/);
  assert.match(THREAD, /<MessageAttachments\s+items=\{message\.attachments \?\? \[\]\}/);
});

test("a row's paperclip now also detects inline attachments", () => {
  for (const src of [MOCK, LEGACY]) {
    assert.match(src, /\(m\.attachments\?\.length \?\? 0\) > 0/);
  }
});
