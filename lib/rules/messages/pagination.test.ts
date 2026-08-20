import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mergeMessagePages,
  newMessagesIn,
  oldestLoadedAt,
  shouldLoadOlder,
} from "./pagination.ts";
import type { Message } from "@/lib/domain";

const msg = (id: string, createdAt: string, over: Partial<Message> = {}): Message => ({
  id,
  conversationId: "c1",
  senderId: "E001",
  senderName: "A",
  text: id,
  attachmentIds: [],
  replyToId: null,
  createdAt,
  readBy: [],
  ...over,
});

const T = (n: number) => `2026-08-20T10:${String(n).padStart(2, "0")}:00.000Z`;

/* ── Merging ──────────────────────────────────────────────────────────────── */

test("pages are stitched into one thread, oldest first", () => {
  const older = [msg("a", T(1)), msg("b", T(2))];
  const live = [msg("c", T(3)), msg("d", T(4))];
  assert.deepEqual(
    mergeMessagePages([older, live]).map((m) => m.id),
    ["a", "b", "c", "d"],
  );
});

test("a message in two pages is drawn once", () => {
  /* The cursor is inclusive on purpose, so an overlap of at least one message
     is guaranteed on every page. Without dedup it would be visible. */
  const older = [msg("a", T(1)), msg("b", T(2))];
  const live = [msg("b", T(2)), msg("c", T(3))];
  assert.deepEqual(
    mergeMessagePages([older, live]).map((m) => m.id),
    ["a", "b", "c"],
  );
});

test("the LIVE page's copy wins over an older page's", () => {
  /* The live page was just re-read, so it carries the edit, the tombstone and
     the newest readBy. A history page is a snapshot from whenever it was
     fetched, and letting it win would undo an edit on screen. */
  const stale = [msg("b", T(2), { text: "before" })];
  const live = [msg("b", T(2), { text: "after", editedAt: T(5) })];
  const merged = mergeMessagePages([stale, live]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, "after");
  assert.equal(merged[0].editedAt, T(5));
});

test("a deletion in the live page survives the merge", () => {
  const stale = [msg("b", T(2), { text: "secret" })];
  const live = [msg("b", T(2), { text: "This message was deleted.", isDeleted: true })];
  assert.equal(mergeMessagePages([stale, live])[0].isDeleted, true);
});

test("messages sharing an instant keep a stable order", () => {
  /* `serverTimestamp()` is not unique. Without the id tiebreak these two would
     reshuffle on every merge, which reads as messages jumping about. */
  const a = mergeMessagePages([[msg("y", T(2)), msg("x", T(2))]]).map((m) => m.id);
  const b = mergeMessagePages([[msg("x", T(2)), msg("y", T(2))]]).map((m) => m.id);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ["x", "y"]);
});

test("pages arriving out of order still produce one correct sequence", () => {
  const merged = mergeMessagePages([
    [msg("c", T(3))],
    [msg("a", T(1))],
    [msg("b", T(2))],
  ]);
  assert.deepEqual(merged.map((m) => m.id), ["a", "b", "c"]);
});

test("no pages is an empty thread, not a crash", () => {
  assert.deepEqual(mergeMessagePages([]), []);
  assert.deepEqual(mergeMessagePages([[], []]), []);
});

/* ── The cursor ───────────────────────────────────────────────────────────── */

test("the cursor is the oldest instant loaded", () => {
  assert.equal(oldestLoadedAt([msg("b", T(2)), msg("a", T(1)), msg("c", T(3))]), T(1));
});

test("nothing loaded yields no cursor", () => {
  /* A caller must read this as "do not ask yet". Asking without a cursor
     returns the NEWEST page again and stacks it on top of itself. */
  assert.equal(oldestLoadedAt([]), null);
});

test("a message with no timestamp cannot become the cursor", () => {
  /* A `serverTimestamp()` write reads back empty for a moment. Using it would
     ask for everything older than nothing. */
  assert.equal(oldestLoadedAt([msg("a", ""), msg("b", T(2))]), T(2));
});

/* ── What a page adds ─────────────────────────────────────────────────────── */

test("only unseen messages count as new", () => {
  const page = [msg("a", T(1)), msg("b", T(2))];
  assert.deepEqual(
    newMessagesIn(page, new Set(["b"])).map((m) => m.id),
    ["a"],
  );
});

test("a page of entirely known messages adds nothing", () => {
  /* This is how the top of the conversation announces itself: the inclusive
     cursor guarantees the page is never literally empty, so "adds nothing" —
     not "is empty" — is the signal there is no more history. */
  const page = [msg("a", T(1))];
  assert.deepEqual(newMessagesIn(page, new Set(["a"])), []);
});

/* ── When to ask ──────────────────────────────────────────────────────────── */

test("near the top asks for more", () => {
  assert.equal(
    shouldLoadOlder({ scrollTop: 20, loading: false, exhausted: false }),
    true,
  );
});

test("away from the top does not", () => {
  assert.equal(
    shouldLoadOlder({ scrollTop: 500, loading: false, exhausted: false }),
    false,
  );
});

test("a request already in flight blocks another", () => {
  /* The scroll handler runs on every frame. Unguarded, one scroll to the top
     fires dozens of identical requests before the first lands. */
  assert.equal(
    shouldLoadOlder({ scrollTop: 0, loading: true, exhausted: false }),
    false,
  );
});

test("an exhausted thread never asks again", () => {
  assert.equal(
    shouldLoadOlder({ scrollTop: 0, loading: false, exhausted: true }),
    false,
  );
});

test("exactly at the threshold counts as asking", () => {
  assert.equal(
    shouldLoadOlder({ scrollTop: 80, loading: false, exhausted: false }),
    true,
  );
  assert.equal(
    shouldLoadOlder({ scrollTop: 81, loading: false, exhausted: false }),
    false,
  );
});
