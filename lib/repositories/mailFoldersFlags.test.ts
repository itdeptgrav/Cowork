import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Spam and Important folders, and an explicit Save Draft — all additive on the
 * existing per-person-flag model.
 *
 * The load-bearing invariant is LOCKSTEP: `MailFolder` and the per-person flag
 * fields are consumed in the domain type, both `inFolder` implementations, the
 * read defaulter and the write body. If one moves without the others the two
 * backends silently disagree on what "in Spam" means, or a legacy doc crashes a
 * read. Source assertions guard that both sides moved together.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const DOMAIN = strip("lib/domain/mail.ts");
const TYPES = strip("lib/repositories/types.ts");
const PURE = strip("lib/repositories/legacy/mail.ts");
const MOCK = strip("lib/repositories/mock/index.ts");
const LEGACY = strip("lib/repositories/legacy/index.ts");
const FLAGS = strip("lib/rules/mail/flags.ts");

test("the domain grows Spam as a folder and two per-person flag arrays", () => {
  assert.match(DOMAIN, /"inbox" \| "sent" \| "drafts" \| "trash" \| "spam"/);
  assert.match(DOMAIN, /spamBy: EmployeeId\[\];/);
  assert.match(DOMAIN, /importantBy: EmployeeId\[\];/);
});

test("both inFolder implementations bucket Spam identically, and it is exclusive", () => {
  for (const src of [PURE, MOCK]) {
    assert.match(src, /const spammed = m\.spamBy\.includes\(me\)/);
    assert.match(src, /if \(folder === "spam"\) return spammed/);
    /* Exclusive like Trash: a spammed message is pulled from every other view. */
    assert.match(src, /if \(spammed\) return false/);
  }
});

test("a stored doc predating the new fields still reads — they default to []", () => {
  assert.match(PURE, /spamBy: ids\(d\.spamBy\)/);
  assert.match(PURE, /importantBy: ids\(d\.importantBy\)/);
  /* And they are written, so Firestore (which rejects undefined) is safe. */
  assert.match(PURE, /spamBy: m\.spamBy/);
  assert.match(PURE, /importantBy: m\.importantBy/);
});

test("the flag→field map is shared, so a flag maps to one field for both backends", () => {
  assert.match(FLAGS, /starred: "starredBy"/);
  assert.match(FLAGS, /spam: "spamBy"/);
  assert.match(FLAGS, /important: "importantBy"/);
  assert.match(MOCK, /MAIL_FLAG_FIELD\[flag\]/);
  assert.match(LEGACY, /MAIL_FLAG_FIELD\[flag\]/);
  assert.match(TYPES, /"starred" \| "trashed" \| "spam" \| "important"/);
});

test("explicit Save Draft / discard exist on the interface and BOTH backends", () => {
  for (const src of [TYPES, MOCK, LEGACY]) {
    assert.match(src, /saveMailDraft\(/);
    assert.match(src, /discardMailDraft\(/);
  }
  /* A draft is an unsent message; discard is a hard delete fenced to your own. */
  assert.match(MOCK, /sentAt: null/);
  assert.match(MOCK, /Only your own unsent draft can be discarded/);
  assert.match(LEGACY, /Only your own unsent draft can be discarded/);
});

test("both backends filter and decorate the Important view in lockstep", () => {
  for (const src of [MOCK, LEGACY]) {
    assert.match(src, /q(?:uery)?\.important/);
    assert.match(src, /importantBy\.includes\(me\)/);
    assert.match(src, /important: /);
  }
});
