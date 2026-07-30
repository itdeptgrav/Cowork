import assert from "node:assert/strict";
import { test } from "node:test";
import { directConversationKey } from "./work.ts";

/**
 * The direct-conversation key.
 *
 * Small function, real invariant: it is what stops "message Tobias" producing a
 * second thread beside the one you already have with him. The bug it guards
 * against is not a crash — it is two plausible-looking threads with the same
 * person, where neither party can tell which one the other is reading, and
 * where the older one silently stops being answered.
 *
 * The repository itself cannot be unit-tested here: `lib/repositories/mock`
 * imports through the `@/` alias and the test runner is plain `node --test`,
 * which does not resolve it. So the pair rule is tested where it lives and the
 * end-to-end path — create, dedupe, group — was walked in the browser.
 */

test("the key does not depend on who started the conversation", () => {
  assert.equal(
    directConversationKey(["e-01", "e-05"]),
    directConversationKey(["e-05", "e-01"]),
  );
});

test("different pairs get different keys", () => {
  assert.notEqual(
    directConversationKey(["e-01", "e-05"]),
    directConversationKey(["e-01", "e-06"]),
  );
});

test("a repeated id does not change the pair", () => {
  /* The repository adds the caller and the caller may also appear in the
     submitted list. Without the dedupe, `[me, me, them]` would key differently
     from `[me, them]` and open a duplicate thread on the second attempt. */
  assert.equal(
    directConversationKey(["e-01", "e-01", "e-05"]),
    directConversationKey(["e-01", "e-05"]),
  );
});

test("a self-conversation is stable rather than empty", () => {
  /* Not a case the UI can reach — the repository refuses an empty participant
     list — but a key that collapsed to "" would collide with every other
     degenerate conversation, so it is worth pinning. */
  assert.equal(directConversationKey(["e-01", "e-01"]), "e-01");
});
