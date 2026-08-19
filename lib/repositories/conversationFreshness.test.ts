import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The conversation list has to be current, and a TTL cache had made it not be.
 *
 * `listConversations` carries a 30-second `staleTime` in `useRepository`,
 * because it is genuinely expensive — two collection queries plus one unread
 * count per thread — and it must not re-run on every timer heartbeat. But that
 * cache is keyed WITHOUT the repository version, so a bare
 * `notifyRepositoryChanged()` could not dislodge it, and for half a minute at a
 * time the list simply stopped being true:
 *
 *  · a message you had just sent did not become the preview — the row went on
 *    showing the one before it as the latest;
 *  · a message that arrived raised no unread badge.
 *
 * Both are drawn from the same query, which is why one fix addresses both. The
 * fix is that every write and every live listener that changes a thread NAMES
 * `listConversations` when it bumps, so its cached answers are dropped first.
 *
 * These assertions are on the source rather than on behaviour because what is
 * being protected is that the name is present at each site. Nothing fails at
 * runtime when it is dropped — the list just quietly goes stale again, which is
 * exactly how this survived the first time.
 */

function code(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Comments removed, so a call is distinguishable from a mention of one.
 *
 * This file's own subject is discussed at length in the comments around it —
 * `watchConversations` explains why it bumps at all — and a scan that counts
 * prose as code reports a violation that is only a sentence.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

const LEGACY = "lib/repositories/legacy/index.ts";
const MOCK = "lib/repositories/mock/index.ts";
const HOOK = "lib/hooks/useRepository.ts";

/**
 * The legacy repository's messaging block.
 *
 * Bounded by `listConversations` itself and by the end of the presence section
 * that follows the watchers, so a `notifyRepositoryChanged()` belonging to
 * tasks or timers is not swept in.
 */
function messagingBlock(): string {
  const src = withoutComments(code(LEGACY));
  const start = src.indexOf("async listConversations(");
  const end = src.indexOf("watchPresence(");
  assert.ok(start > 0, "listConversations not found in the legacy repository");
  assert.ok(end > start, "watchPresence not found after it");
  return src.slice(start, end);
}

test("every bump in the legacy messaging block names listConversations", () => {
  const block = messagingBlock();
  const bare = block.match(/notifyRepositoryChanged\(\s*\)/g) ?? [];
  assert.deepEqual(
    bare,
    [],
    "a message write or listener bumps without naming listConversations, so the " +
      "30s TTL will serve a stale preview and a missing unread badge",
  );
});

test("the messaging block really does bump — the check above is not vacuous", () => {
  const block = messagingBlock();
  const named = block.match(/notifyRepositoryChanged\("listConversations"\)/g) ?? [];
  assert.ok(
    named.length >= 12,
    `expected the messaging writes and both watchers to name it; found ${named.length}`,
  );
});

test("both live listeners name it — this is the incoming-message path", () => {
  /* A message somebody ELSE sends produces no local mutation, so `useAction`
     never fires. `watchConversations` is the only thing that learns about it,
     and if its bump does not clear the cache the unread badge cannot appear. */
  const src = code(LEGACY);
  for (const listener of ["watchConversations", "watchConversationMessages"]) {
    const start = src.indexOf(`${listener}(`);
    assert.ok(start > 0, `${listener} not found`);
    const body = src.slice(start, start + 2000);
    const bump = body.match(/debounce\(\s*\(\)\s*=>\s*notifyRepositoryChanged\(([^)]*)\)/);
    assert.ok(bump, `${listener} does not debounce a bump`);
    assert.equal(
      bump[1].trim(),
      '"listConversations"',
      `${listener} bumps without naming listConversations`,
    );
  }
});

test("the mock's messaging mutations invalidate the same query", () => {
  /* Purge-only there: `useAction` already bumps for the mock, and a second bump
     would run every query on the page twice. */
  const src = code(MOCK);
  const methods = [
    "sendMessage",
    "editMessage",
    "deleteMessage",
    "createConversation",
    "markConversationRead",
    "updateGroup",
    "addGroupMember",
    "removeGroupMember",
    "setGroupAdmin",
  ];
  for (const method of methods) {
    const start = src.indexOf(`async ${method}(`);
    assert.ok(start > 0, `${method} not found in the mock repository`);
    /* To the next member declaration, so the assertion is about THIS method. */
    const rest = src.slice(start);
    const next = rest.slice(1).search(/\n {2}(async |#|\/\*\*)/);
    const body = next < 0 ? rest : rest.slice(0, next + 1);
    assert.match(
      body,
      /invalidateQueries\("listConversations"\)/,
      `${method} changes a conversation without invalidating listConversations`,
    );
  }
});

test("the mock purges rather than bumps", () => {
  /* A `notifyRepositoryChanged` here would double-bump behind `useAction`. */
  const src = code(MOCK);
  assert.doesNotMatch(
    src,
    /notifyRepositoryChanged/,
    "the mock relies on useAction for the bump — it must only purge",
  );
});

test("listConversations still carries the TTL the naming makes safe", () => {
  /* If the TTL is ever removed the naming becomes harmless rather than wrong,
     but this pins the pairing so the comment above it cannot go stale. */
  assert.match(code(HOOK), /listConversations:\s*30_000/);
});

test("the query cache subscribes to the stale-data signal", () => {
  /* Without this subscriber every name passed above is inert — the signal
     fires, nobody listens, and the TTL goes on answering. The purge itself is
     tested directly in `events.test.ts`; what is asserted here is that this
     module is wired to it, and with BOTH of its caches. */
  const src = withoutComments(code(HOOK));
  assert.match(
    src,
    /subscribeToStaleData\(\s*\(methods\)\s*=>\s*purgeQueryCaches\(methods,\s*staleResultCache,\s*preloadCache,?\s*\)/,
    "useQuery's caches are not wired to the stale-data signal",
  );
});
