import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Creating a conversation, and the stale list that swallowed it.
 *
 * **The bug.** `listConversations` carries a 30s `staleTime`, and `useQuery`'s
 * TTL cache is keyed on the fetcher source plus its deps and NOT on the
 * repository version — deliberately, so an unrelated write does not re-run an
 * expensive read. Creating a conversation therefore did not clear it. Pushing
 * to `/messages/[conversationId]` is a different route segment from
 * `/messages`, so the page REMOUNTS: its new `useQuery` starts at nonce 0 with
 * nothing forced, and the TTL answered it with the list as it stood before the
 * conversation existed. The id in the URL matched nothing, so the right pane
 * fell through to its empty state — which offered to start a conversation the
 * reader had just finished starting.
 *
 * Taking that offer is the second half of the fault. `createConversation`
 * deduplicates direct pairs on a deterministic id, so a DM reopened; a GROUP
 * uses `addDoc` and wrote a fresh group with the same name and members every
 * time the button was pressed.
 *
 * Read from source: what is protected here is the ORDER of two calls and the
 * absence of a control, neither of which a rendering test would state plainly.
 */

const AREA = "components/features/messages/MessagesArea.tsx";
const HOOK = "lib/hooks/useRepository.ts";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * One top-level declaration's source.
 *
 * Cut at the NEXT declaration rather than at a closing brace: these files are
 * CRLF, so a naive `indexOf("\n}")` lands on the `}` that closes a destructured
 * parameter list and returns a body 79 characters long.
 */
function block(src: string, decl: string): string {
  const at = src.indexOf(decl);
  assert.ok(at > 0, `${decl} is gone`);
  const next = src.indexOf("\nfunction ", at + decl.length);
  return src.slice(at, next === -1 ? src.length : next);
}

test("creating a conversation drops the cached list before navigating", () => {
  const body = block(code(AREA), "function openCreated(");
  const invalidate = body.indexOf('invalidateQuery("listConversations")');
  const push = body.indexOf("router.push");
  assert.ok(
    invalidate > 0,
    "the cached conversation list is not invalidated — the page it navigates to " +
      "will be served the list from before this conversation existed",
  );
  assert.ok(push > 0, "openCreated no longer navigates");
  assert.ok(
    invalidate < push,
    "invalidateQuery must run BEFORE router.push — after it, the next page has " +
      "already mounted and read the stale entry",
  );
});

test("the TTL cache is still keyed without the repository version", () => {
  /* The reason `invalidateQuery` has to exist at all. If this ever changes so
     that a version bump clears the entry, the call above becomes redundant
     rather than wrong — but somebody should decide that deliberately. */
  const src = code(HOOK);
  assert.match(
    src,
    /const fetcherKey = fetcher\.toString\(\) \+ JSON\.stringify\(deps\);/,
    "the stale-cache key changed shape — re-check that a write still cannot clear it",
  );
  assert.ok(
    /staleResultCache\.get\(fetcherKey\)/.test(src),
    "the TTL read no longer uses fetcherKey",
  );
});

test("invalidateQuery's needle matches the real fetcher source", () => {
  /**
   * The fragile coupling: `invalidateQuery` finds entries by the property
   * access `.listConversations(` inside `fetcher.toString()`. Property names
   * survive minification where local variables do not, which is why the match
   * is on the property and not on the parameter.
   */
  const needle = ".listConversations(";
  const sources = [
    ((r: { listConversations: () => unknown }) => r.listConversations()).toString(),
    "e=>e.listConversations()",
    "(r) => r.listConversations()",
  ];
  for (const fetcherSource of sources)
    assert.ok(
      (fetcherSource + JSON.stringify([])).includes(needle),
      `invalidateQuery would not match this fetcher: ${fetcherSource}`,
    );

  /* The trailing bracket is what bounds the match, so a longer method sharing
     the whole prefix is left alone — the cheap version of this needle, without
     the bracket, would clear both. */
  for (const other of [
    "(r) => r.listConversationsArchived()",
    "(r) => r.listConversationSummaries()",
  ])
    assert.ok(
      !other.includes(needle),
      `the needle reaches an unrelated method: ${other}`,
    );
});

test("a route naming a missing conversation offers no way to create another", () => {
  const src = code(AREA);
  assert.match(
    src,
    /missing=\{Boolean\(conversationId\)\}/,
    "NoThread is no longer told whether the route named a conversation",
  );
  const body = block(src, "function NoThread(");
  const guardAt = body.indexOf("{!missing && (");
  assert.ok(
    guardAt > 0,
    "the create controls are not withheld on the not-found state — pressing them " +
      "writes a duplicate group, which is the fault this guards",
  );
  /* Both controls must sit inside that guard, not just the first. */
  assert.ok(
    body.indexOf("Start a conversation") > guardAt &&
      body.indexOf("Create a group") > guardAt,
    "a create control escaped the !missing guard",
  );
});
