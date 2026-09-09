import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@/lib/domain";
import {
  forgetThreads,
  heldThreadCount,
  recentThread,
  rememberThread,
} from "./recentThreads.ts";

/**
 * Switching chats remounted the thread and drew skeleton rows for the length of
 * the round trip — every time, including switching straight back to the one you
 * were just reading. This holds what each thread last had on screen so that
 * moment shows the conversation instead of placeholders.
 *
 * The read is still always made; this only decides what is drawn while it is in
 * flight. So the tests that matter most are the ones about NOT holding on to
 * anything it should not.
 */

const msg = (id: string): Message =>
  ({ id, text: id, senderId: "E1", createdAt: "2026-09-09T10:00:00.000Z" }) as
    unknown as Message;

test("a thread that has not been opened has nothing to draw", () => {
  forgetThreads();
  assert.equal(recentThread("C1"), null);
});

test("what was on screen comes back for that conversation", () => {
  forgetThreads();
  rememberThread("C1", [msg("m1"), msg("m2")]);
  assert.deepEqual(
    recentThread("C1")?.map((m) => m.id),
    ["m1", "m2"],
  );
});

test("one conversation's messages never answer for another", () => {
  forgetThreads();
  rememberThread("C1", [msg("m1")]);
  assert.equal(recentThread("C2"), null);
});

test("re-remembering replaces rather than appends", () => {
  /* The live page is the whole page, not a delta — merging would resurrect a
     message that had since been deleted. */
  forgetThreads();
  rememberThread("C1", [msg("m1"), msg("m2")]);
  rememberThread("C1", [msg("m2")]);
  assert.deepEqual(
    recentThread("C1")?.map((m) => m.id),
    ["m2"],
  );
});

test("what is handed back is a copy, so a caller cannot mutate the store", () => {
  forgetThreads();
  rememberThread("C1", [msg("m1")]);
  const first = recentThread("C1")!;
  first.push(msg("intruder"));
  assert.equal(recentThread("C1")?.length, 1);
});

test("what is stored is a copy, so a caller mutating its own array cannot reach in", () => {
  forgetThreads();
  const live = [msg("m1")];
  rememberThread("C1", live);
  live.push(msg("m2"));
  assert.equal(recentThread("C1")?.length, 1);
});

/* ── Bounded, and least-recently-opened first ─────────────────────────────── */

test("it does not grow without limit", () => {
  forgetThreads();
  for (let i = 0; i < 40; i += 1) rememberThread(`C${i}`, [msg(`m${i}`)]);
  assert.ok(heldThreadCount() <= 12, `held ${heldThreadCount()}`);
});

test("the thread evicted is the one nobody has gone back to", () => {
  forgetThreads();
  for (let i = 0; i < 12; i += 1) rememberThread(`C${i}`, [msg(`m${i}`)]);
  /* C0 is the oldest — but opening it again should move it to the back of the
     queue, so the next eviction takes C1 instead. */
  rememberThread("C0", [msg("m0-again")]);
  rememberThread("NEW", [msg("new")]);
  assert.ok(recentThread("C0"), "the thread just re-opened was evicted");
  assert.equal(recentThread("C1"), null);
});

test("signing somebody else in leaves nothing behind", () => {
  /* One browser, two people. Their correspondence must not be drawable by the
     next person even for the moment before their own read lands. */
  rememberThread("C1", [msg("m1")]);
  forgetThreads();
  assert.equal(recentThread("C1"), null);
  assert.equal(heldThreadCount(), 0);
});
