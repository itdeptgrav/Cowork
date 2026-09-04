import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The inbox list draws a row's read/attachment/star state WITHOUT a second read
 * per row, and the Starred sidebar actually filters.
 *
 * These are per-viewer conveniences, so they are computed on every read (never
 * stored), in BOTH backends, from the messages already in hand. Source
 * assertions, in the style of the other repository wiring tests here: what is
 * protected is that both backends decorate identically and both honour the
 * `starred` filter — a divergence would make the two disagree on the list.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const DOMAIN = strip("lib/domain/mail.ts");
const TYPES = strip("lib/repositories/types.ts");
const MOCK = strip("lib/repositories/mock/index.ts");
const LEGACY = strip("lib/repositories/legacy/index.ts");

test("the thread type carries the per-viewer list conveniences, all optional", () => {
  assert.match(DOMAIN, /unread\?: boolean;/);
  assert.match(DOMAIN, /hasAttachments\?: boolean;/);
  assert.match(DOMAIN, /starred\?: boolean;/);
});

test("the query accepts a cross-folder starred filter", () => {
  assert.match(TYPES, /starred\?: boolean;/);
});

for (const [name, src] of [
  ["mock", MOCK],
  ["legacy", LEGACY],
] as const) {
  test(`${name} honours the starred filter`, () => {
    assert.match(src, /q(?:uery)?\.starred/);
    assert.match(src, /starredBy\.includes\(me\)/);
  });

  test(`${name} decorates each row with unread, hasAttachments and starred`, () => {
    assert.match(src, /unread:/);
    assert.match(src, /hasAttachments:/);
    assert.match(src, /starred:/);
    /* Unread is an inbox signal — from someone else, not read by me — so a Sent
       row is never unread. Both backends express it the same way. */
    assert.match(
      src,
      /m\.from\.employeeId !== me && !m\.readBy\.includes\(me\)/,
    );
    assert.match(src, /m\.attachmentIds\.length > 0/);
  });
}

test("the blind-copy read discipline is untouched — both reads still redact", () => {
  /* My list change must not have removed the redaction on the message read. */
  assert.match(MOCK, /redactBcc\(m, me\)/);
  assert.match(LEGACY, /redactBcc\(m, me\)/);
});
