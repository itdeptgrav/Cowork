import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Cursor paging, and the reconciliation the old design existed to avoid.
 *
 * The thread used to grow ONE window — 50, then 100, then 150 — re-reading
 * everything already on screen to add fifty more. That was correct, and for a
 * real reason: the conversation is re-read on every live update, and a single
 * window stays right under that refetch for free. It was also quadratic, in
 * both directions — scrolling back re-read from the beginning at every step,
 * and each live update then re-read however far somebody had scrolled.
 *
 * The reconciliation is now written down (`mergeMessagePages`). What is held
 * here is the handful of component decisions that make it safe, each of which
 * fails silently: a live page that stops being live, history refetched on every
 * update, a request storm on one scroll, or a thread that quietly loses the
 * bottom of itself.
 */

const AREA = "components/features/messages/MessagesArea.tsx";
const TYPES = "lib/repositories/types.ts";
const LEGACY = "lib/repositories/legacy/index.ts";
const MOCK = "lib/repositories/mock/index.ts";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

test("the live query is a FIXED page, not a growing window", () => {
  /* The whole point: a live update costs 50 reads however deep the reader has
     scrolled. A `limit` that grew would put the old cost straight back. */
  const src = code(AREA);
  assert.match(
    src,
    /r\.listMessages\(c\.id, \{ limit: MESSAGE_PAGE_SIZE \}\),\s*\[c\.id\],/,
    "the live message query is not a fixed-size page keyed on the conversation alone",
  );
  assert.doesNotMatch(src, /visibleCount/, "the growing-window state is still present");
});

test("older pages are held in state and never refetched", () => {
  const src = code(AREA);
  assert.match(src, /const \[olderPages, setOlderPages\] = useState<Message\[\]\[\]>\(\[\]\)/);
  /* Prepended, so history stays in order as pages arrive. */
  assert.match(src, /setOlderPages\(\(prev\) => \[fresh, \.\.\.prev\]\)/);
});

test("the live page is merged LAST so its copy wins", () => {
  /* It is the one just re-read, so it carries the edit, the tombstone and the
     newest readBy. History passed last would pin a message to whatever it
     looked like when that page happened to be fetched.

     `live ?? seed` is still that page: `seed` is only what this thread last had
     on screen, drawn while the read that replaces it is in flight, and it is
     never merged ALONGSIDE the live page — the moment one exists the other is
     not consulted. See `recentThreads`. */
  assert.match(
    code(AREA),
    /mergeMessagePages\(\[\.\.\.olderPages, live \?\? seed \?\? \[\]\]\)/,
  );
  assert.match(code(AREA), /const live = messages\.data\?\.messages \?\? null;/);
});

test("the merge is memoised on the data, not on a fresh array", () => {
  /* Anything that builds a new array per render defeats the memo and re-merges
     the whole thread on every keystroke. Two ways that can happen here:
     `?? []` computed outside it (so `live` falls back to `null`, not `[]`), and
     `recentThread`, which hands back a COPY — hence its own memo on the
     conversation. */
  const src = code(AREA);
  const at = src.indexOf("mergeMessagePages([...olderPages");
  assert.match(src.slice(at, at + 140), /\[olderPages, live, seed\]/);
  assert.match(src, /const seed = useMemo\(\(\) => recentThread\(c\.id\), \[c\.id\]\);/);
});

test("a thread that has been open before is not redrawn as placeholders", () => {
  /* The report: switching chats showed skeleton rows for the length of the
     round trip, every time, including switching straight back to the thread you
     were just reading. */
  const src = code(AREA);
  assert.match(
    src,
    /messages\.isLoading && list\.length === 0 \? \(/,
    "the skeleton shows again while there is something to draw",
  );
});

test("a page request is guarded by a ref, not by state", () => {
  /* The scroll handler runs on every frame; a state flag does not take effect
     until the next render, so dozens of identical requests would go out before
     the first one landed. */
  const src = code(AREA);
  const at = src.indexOf("const loadOlder = useCallback");
  assert.ok(at > 0, "loadOlder not found");
  const body = src.slice(at, src.indexOf("function onThreadScroll", at));
  assert.match(body, /if \(!el \|\| loadingOlderRef\.current \|\| exhausted\) return;/);
  assert.match(body, /loadingOlderRef\.current = true;/);
});

test("no cursor means no request", () => {
  /* Asking without one returns the NEWEST page again and stacks it on itself. */
  const src = code(AREA);
  const at = src.indexOf("const loadOlder = useCallback");
  const body = src.slice(at, src.indexOf("function onThreadScroll", at));
  assert.match(body, /const cursor = oldestLoadedAt\(list\);/);
  assert.match(body, /if \(!cursor\) return;/);
});

test("a page that adds nothing ends the paging", () => {
  /* The inclusive cursor means a page is never literally empty, so "adds
     nothing" — not "is empty" — is the signal, and `hasMore` alone would offer
     a page that adds nothing for ever. */
  const src = code(AREA);
  const at = src.indexOf("const loadOlder = useCallback");
  const body = src.slice(at, src.indexOf("function onThreadScroll", at));
  assert.match(body, /const fresh = newMessagesIn\(page\.messages, known\);/);
  assert.match(body, /if \(fresh\.length === 0 \|\| !page\.hasMore\) setExhausted\(true\);/);
});

test("a failed page does not pretend the thread is exhausted", () => {
  /* Otherwise one dropped request permanently hides the rest of the history. */
  const src = code(AREA);
  const at = src.indexOf("const loadOlder = useCallback");
  const body = src.slice(at, src.indexOf("function onThreadScroll", at));
  const catchAt = body.indexOf("} catch {");
  assert.ok(catchAt > 0, "loadOlder does not handle a failed page");
  assert.doesNotMatch(
    body.slice(catchAt, body.indexOf("} finally {")),
    /setExhausted/,
  );
});

test("history landing restores the reader's place", () => {
  /* `olderPages` in the deps is what makes the effect run at all for a page of
     history — and without it `loadingOlderRef` would stay true, so no further
     page could ever be requested. */
  const src = code(AREA);
  const at = src.indexOf("if (loadingOlderRef.current) {");
  const deps = src.slice(at, at + 900).match(/\}, \[([^\]]*)\]\);/);
  assert.ok(deps, "the pin effect has no dependency array");
  assert.match(deps[1], /olderPages/);
  const branch = src.slice(at, at + 320);
  assert.match(branch, /el\.scrollTop = el\.scrollHeight - prevScrollHeightRef\.current/);
});

test("both repositories accept the cursor", () => {
  for (const path of [TYPES, LEGACY, MOCK]) {
    assert.match(
      code(path),
      /limit\?: number; before\?: string/,
      `${path} does not accept a paging cursor`,
    );
  }
});

test("the cursor comparison is inclusive in BOTH implementations", () => {
  /* `createdAt` is a serverTimestamp and is not unique. An exclusive cursor
     steps over a message sharing its instant — a message that silently never
     appears, which is far worse than one drawn twice. */
  assert.match(code(LEGACY), /where\("createdAt", "<=", cursor\)/);
  assert.match(code(MOCK), /m\.createdAt <= opts\.before!/);
});

test("the loading state is shown rather than left unused", () => {
  /* Telling somebody to scroll up while the page they asked for is already on
     its way reads as the scroll having done nothing. */
  const src = code(AREA);
  assert.match(src, /\{loadingOlder \?/);
  assert.match(src, /Loading earlier messages…/);
});
