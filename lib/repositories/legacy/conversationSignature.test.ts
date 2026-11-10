/**
 * The conversation list refetches only when something it shows changed
 * (10 Nov 2026). Typing stamps and the viewer's own delivery stamp live on the
 * same document and used to refetch the whole page every few seconds while
 * anyone typed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { conversationSignature, LIVE_THREAD_WINDOW } from "./messaging.ts";

const base = {
  participantIds: ["GR0108", "GR0069"],
  lastMessage: "hi",
  lastMessageAt: { seconds: 10, nanoseconds: 0 },
  delivery: { GR0108: 5, GR0069: 4 },
};

test("a typing stamp does not count as a change", () => {
  assert.equal(
    conversationSignature({ ...base, typing: { GR0069: 123 } }, "GR0108"),
    conversationSignature(base, "GR0108"),
  );
});

test("my own delivery stamp does not count; someone else's does", () => {
  const mine = { ...base, delivery: { ...base.delivery, GR0108: 99 } };
  assert.equal(conversationSignature(mine, "GR0108"), conversationSignature(base, "GR0108"));
  /* Theirs turns my ticks grey, so the list must hear about it. */
  const theirs = { ...base, delivery: { ...base.delivery, GR0069: 99 } };
  assert.notEqual(conversationSignature(theirs, "GR0108"), conversationSignature(base, "GR0108"));
});

test("a new message counts", () => {
  assert.notEqual(
    conversationSignature({ ...base, lastMessage: "new" }, "GR0108"),
    conversationSignature(base, "GR0108"),
  );
});

test("key order does not make two equal documents look different", () => {
  const reordered = { delivery: base.delivery, lastMessage: "hi", lastMessageAt: base.lastMessageAt, participantIds: base.participantIds };
  assert.equal(conversationSignature(reordered, "GR0108"), conversationSignature(base, "GR0108"));
});

test("the list watcher and the thread watcher use them", () => {
  const repo = readFileSync("lib/repositories/legacy/index.ts", "utf8");
  assert.match(repo, /const signature = conversationSignature\(ch\.doc\.data\(\), me\);/);
  assert.match(repo, /if \(changed\) bump\(\);/);
  assert.match(repo, /orderBy\("createdAt", "desc"\),\s*limit\(LIVE_THREAD_WINDOW\),/);
  assert.ok(LIVE_THREAD_WINDOW >= 100, "the live window must cover more than one page");
});

test("typing expires on a clock, and presence never attaches after cleanup", () => {
  const repo = readFileSync("lib/repositories/legacy/index.ts", "utf8");
  assert.match(repo, /const tick = setInterval\(emit, 1000\);/);
  assert.match(repo, /clearInterval\(tick\);/);
  assert.match(repo, /const ref = await this\.#dutyDoc\(id\);[^]*?if \(disposed\) return;\s*unsubs\.push\(/);
});
