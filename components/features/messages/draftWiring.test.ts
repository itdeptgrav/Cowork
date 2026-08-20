import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * How the composer is wired to the draft store.
 *
 * The shape rules are tested against strings in
 * `lib/rules/messages/drafts.test.ts`. What is held here is the handful of
 * decisions in the component that a correct rule cannot protect, every one of
 * which fails silently — the composer still works, it just quietly loses or
 * leaks what somebody wrote.
 */

const AREA = "components/features/messages/MessagesArea.tsx";
const STORE = "components/features/messages/draftStorage.ts";
const SESSION = "components/features/auth/SessionProvider.tsx";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

test("the draft is restored as the INITIAL state, not in an effect", () => {
  /* An effect would render an empty composer first and fill it on the next
     pass, which is a visible flash of somebody's message being lost. */
  const src = code(AREA);
  assert.match(src, /const \[restored\] = useState\(\(\) => readDraft\(c\.id\)\);/);
  assert.match(src, /useState\(restored\?\.text \?\? ""\)/);
});

test("attachments and the reply are restored too, not just the text", () => {
  const src = code(AREA);
  assert.match(src, /useState<MessageAttachment\[\]>\(\s*restored\?\.attachments \?\? \[\],\s*\)/);
  assert.match(src, /useState<MessageReply \| null>\(\s*restored\?\.replyTo \?\? null,\s*\)/);
});

test("the draft is keyed by THIS conversation", () => {
  /* The requirement in one line: a draft from chat A must never appear in
     chat B. Every call passes `c.id`. */
  const src = code(AREA);
  assert.match(src, /readDraft\(c\.id\)/);
  assert.match(src, /saveDraft\(c\.id, \{/);
  assert.match(src, /clearDraft\(c\.id\)/);
});

test("saving is not debounced", () => {
  /* A debounced effect cancels its pending write in cleanup, so typing and
     immediately clicking another conversation would cancel the save on the way
     out — the exact case this feature exists for. A refresh gives no cleanup at
     all, so anything still in a timer is gone. */
  const src = code(AREA);
  const at = src.indexOf("saveDraft(c.id, {");
  const effect = src.slice(src.lastIndexOf("useEffect(", at), at + 220);
  assert.doesNotMatch(effect, /setTimeout|debounce/, "the draft save is debounced");
});

test("saving is skipped while editing an existing message", () => {
  /* `startEdit` replaces the composer with an existing message's text. Storing
     that would restore somebody's edit of an old message as a new draft. */
  const src = code(AREA);
  const at = src.indexOf("saveDraft(c.id, {");
  const effect = src.slice(src.lastIndexOf("useEffect(", at), at);
  assert.match(effect, /if \(editing\) return;/);
});

test("the draft is cleared ONLY after a successful send", () => {
  /* A failed send must leave the text and files exactly where they were, so a
     retry is pressing the button again rather than typing it out twice. */
  const src = code(AREA);
  const at = src.indexOf("clearDraft(c.id)");
  assert.ok(at > 0, "clearDraft is never called");
  const before = src.slice(src.lastIndexOf("const r = await send();", at), at);
  assert.match(before, /if \(r\.ok\) \{/, "clearDraft is not inside the success branch");
});

test("every storage call is guarded — none may throw", () => {
  /* localStorage throws for reasons unrelated to this app: private browsing,
     storage disabled by policy, a full quota, a sandboxed frame. A draft is a
     convenience; taking the conversation down with it is not. */
  const src = code(STORE);
  const fns = ["readDraft", "saveDraft", "clearDraft", "clearAllDrafts"];
  for (const fn of fns) {
    const at = src.indexOf(`export function ${fn}`);
    assert.ok(at > 0, `${fn} not found`);
    const body = src.slice(at, src.indexOf("\n}", at));
    assert.match(body, /try \{/, `${fn} touches storage without a guard`);
    assert.match(body, /catch/, `${fn} has no catch`);
  }
});

test("an emptied composer removes the key rather than storing emptiness", () => {
  /* Otherwise every conversation anybody typed one character into keeps a
     record for ever, and clearing a composer leaves a draft claiming otherwise. */
  const src = code(STORE);
  const at = src.indexOf("export function saveDraft");
  const body = src.slice(at, src.indexOf("\n}", at));
  assert.match(body, /if \(isDraftEmpty\(draft\)\) \{[\s\S]*?removeItem\(key\)/);
});

test("clearing all drafts collects the keys BEFORE removing any", () => {
  /* Mutating storage while walking its index shifts positions underneath the
     loop and silently skips entries — leaving exactly the drafts this is
     supposed to clear. */
  const src = code(STORE);
  const at = src.indexOf("export function clearAllDrafts");
  const body = src.slice(at, src.indexOf("\n}", at));
  assert.ok(
    body.indexOf("keys.push(key)") < body.indexOf("removeItem"),
    "keys are removed while the index is still being read",
  );
});

test("a different person signing in clears every draft", () => {
  /* A colleague's half-written message appearing in the next person's composer
     is a disclosure, not an untidiness. It needs its own call because there is
     one key per conversation — no fixed list to name. */
  const src = code(SESSION);
  const at = src.indexOf("noteSignedInUid(currentUser()?.uid ?? null)");
  assert.ok(at > 0, "the account-switch branch moved");
  const branch = src.slice(at, at + 320);
  assert.match(branch, /clearAllDrafts\(\)/);
});
