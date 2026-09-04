import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Global message search — the Messages search box searches message TEXT across
 * every conversation, not just chat names. Lockstep: a hit shape on the domain,
 * an optional repo method both backends implement (the legacy one a BOUNDED
 * fan-out, since Firestore has no text index), and the two-section UI that opens
 * a hit at its message. The matching logic itself is proved in
 * lib/rules/messages/globalSearch.test.ts.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const WORK = strip("lib/domain/work.ts");
const TYPES = strip("lib/repositories/types.ts");
const MOCK = strip("lib/repositories/mock/index.ts");
const LEGACY = strip("lib/repositories/legacy/index.ts");
const MSGS = strip("components/features/messages/MessagesArea.tsx");
const PAGE = strip("app/messages/[conversationId]/page.tsx");

test("the domain carries a denormalised search-hit shape", () => {
  assert.match(WORK, /export interface MessageSearchHit \{/);
  assert.match(WORK, /conversationId: string;/);
  assert.match(WORK, /messageId: string;/);
});

test("searchMessages is an optional repo method, implemented by both backends", () => {
  assert.match(TYPES, /searchMessages\?\(query: string, limit\?: number\): Promise<MessageSearchHit\[\]>/);
  assert.match(MOCK, /async searchMessages\(/);
  assert.match(LEGACY, /async searchMessages\(/);
  for (const src of [MOCK, LEGACY]) assert.match(src, /matchesQuery\(/);
});

test("the legacy search is a bounded fan-out, newest first", () => {
  assert.match(LEGACY, /const MAX_CONVERSATIONS = 40;/);
  assert.match(LEGACY, /const PER_CONVERSATION = 60;/);
  /* Most-recent conversations first, and results sorted newest-first. */
  assert.match(LEGACY, /sort\(\(a, b\) => \(b\.lastMessageAt \?\? ""\)\.localeCompare\(a\.lastMessageAt \?\? ""\)\)/);
  assert.match(LEGACY, /sort\(\(a, b\) => b\.createdAt\.localeCompare\(a\.createdAt\)\)/);
});

test("the search box is debounced and drives the message query", () => {
  assert.match(MSGS, /setTimeout\(\(\) => setDebouncedQuery\(search\.trim\(\)\), 220\)/);
  assert.match(MSGS, /r\.searchMessages\(debouncedQuery, 30\)/);
});

test("results render as a Messages section and open the message via ?m=", () => {
  assert.match(MSGS, /messageSearchSupported=\{typeof repo\.searchMessages === "function"\}/);
  assert.match(MSGS, />\s*Messages\s*</);
  assert.match(MSGS, /href=\{`\/messages\/\$\{h\.conversationId\}\?m=\$\{h\.messageId\}`\}/);
});

test("the ?m target is read on the server and scrolled to once loaded", () => {
  /* Deliberately a server-read prop, NOT useSearchParams — the messages route
     avoids that hook (and its Suspense boundary); see the page comment. */
  assert.doesNotMatch(MSGS, /useSearchParams/);
  assert.match(MSGS, /jumpToMessageId\?: string;/);
  assert.match(MSGS, /jumpTo=\{jumpToMessageId\}/);
  assert.match(MSGS, /void jumpToMessage\(jumpTo\)/);
  /* The dynamic page reads ?m and passes it down. */
  assert.match(PAGE, /searchParams: Promise<\{ m\?: string \}>/);
  assert.match(PAGE, /jumpToMessageId=\{m\}/);
});
