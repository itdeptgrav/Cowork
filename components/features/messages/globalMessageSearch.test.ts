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

/* ── People ───────────────────────────────────────────────────────────────── */

/**
 * **Asked for 21 September 2026:** the same box should find an EMPLOYEE, not
 * only the messages that mention one. Searching a colleague you had never
 * written to returned nothing — there is no conversation for the chat filter to
 * match and no message for the fan-out to find, so the one search somebody runs
 * before STARTING a conversation was the one search that failed.
 *
 * The ranking itself is proved in lib/rules/messages/globalSearch.test.ts. What
 * is pinned here is the wiring, which is where a feature like this dies
 * silently: a directory read that never happens, or one that happens on every
 * visit to a page most people never search from.
 */

test("the directory is matched by the shared rule, not by a second filter", () => {
  assert.match(MSGS, /matchPeople,/);
  assert.match(
    MSGS,
    /matchPeople\(peopleQ\.data \?\? \[\], search, \{ excludeId: viewerId \}\)/,
  );
});

test("the directory is read on the first search, and not on arrival", () => {
  /**
   * Most visits to this page never type anything. Reading every employee on
   * mount would make everybody pay for a feature only some of them use — and
   * reading it per keystroke would be worse. Once, lazily, then local.
   */
  assert.match(MSGS, /directoryWanted \? r\.listEmployees\(\) : Promise\.resolve/);
  assert.match(MSGS, /if \(value\.trim\(\)\) setDirectoryWanted\(true\);/);
  assert.match(MSGS, /\[directoryWanted\]/);
});

test("people render as their own section, between the chats and the messages", () => {
  /* Order is the claim: a name most often means the person, a phrase means the
     line, and a thread you already have with that name beats both. */
  const chats = MSGS.search(/>\s*Chats\s*</);
  const people = MSGS.search(/>\s*People\s*</);
  const messages = MSGS.search(/>\s*Messages\s*</);
  assert.ok(people > 0, "the People section is missing");
  assert.ok(chats > 0 && chats < people, "People must follow Chats");
  assert.ok(messages > people, "Messages must follow People");
});

test("a person you already message is a link; anyone else starts a thread", () => {
  /**
   * The distinction that keeps a search result from being a write. An existing
   * thread is a plain link — openable in a new tab, no pending state, cannot
   * fail. Only somebody with no thread yet goes through `createConversation`,
   * and that is the same create-then-open the New message dialog performs
   * rather than a second implementation of it.
   */
  assert.match(MSGS, /directChatByPerson\.get\(p\.id\)/);
  assert.match(MSGS, /existingChatId \? \(/);
  assert.match(MSGS, /const existing = directChatByPerson\.get\(personId\);/);
  assert.match(MSGS, /kind: "direct",\s*participantIds: \[personId\],/);
  assert.match(MSGS, /if \(r\.ok\) openCreated\(r\.data\.id\);/);

  /**
   * EVERY row goes out of reach while one is being created, not just the one
   * that was pressed. `useAction` hands an overlapping second call the FIRST
   * call's promise, so a click on another person during those milliseconds
   * would open the first person's conversation — you press Sakshi and land in
   * Nabin's thread.
   */
  assert.match(MSGS, /busy=\{startingPersonId !== null\}/);
  assert.match(MSGS, /disabled=\{busy\}/);
});

test("a person row shows who they are, and says when it is working", () => {
  /* Designation and department are what tell two people with the same first
     name apart — the profile, in the room a result row has for it. */
  assert.match(
    MSGS,
    /\[person\.designation, person\.departmentName\]\.filter\(Boolean\)\.join/,
  );
  assert.match(MSGS, /starting \? "Opening…" : subtitle/);
  assert.match(MSGS, /searchSegments\(person\.displayName, query\)/);
});

test("the cap on how many people show is stated rather than silent", () => {
  /* Two letters match half a company. Dropping the rest without a word is how
     somebody concludes a colleague is not in Cowork at all. */
  assert.match(MSGS, /const PEOPLE_SHOWN = 8;/);
  assert.match(MSGS, /people\.slice\(0, PEOPLE_SHOWN\)/);
  assert.match(MSGS, /people\.length > PEOPLE_SHOWN/);
});

test("the chat and message halves are untouched", () => {
  /* Added alongside, not instead of: both sections that already worked keep
     their own query, their own heading and their own empty state. */
  assert.match(MSGS, /r\.searchMessages\(debouncedQuery, 30\)/);
  assert.match(MSGS, /conversations\.length === 0 && searching/);
  assert.match(MSGS, /No chats match/);
});
