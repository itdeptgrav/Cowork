import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import type { Message } from "@/lib/domain";
import { forgetThreads, recentThread, rememberThread } from "./recentThreads";
import { inflightPrefetchCount, pendingThread, prefetchThread } from "./prefetchThread";

/**
 * A conversation's first page starts loading when its row is about to be
 * clicked, so a first open draws at once (10 Nov 2026).
 */

const msg = (id: string) => ({ id }) as unknown as Message;

function fakeRepo() {
  const calls: string[] = [];
  let release: (() => void) | null = null;
  return {
    calls,
    finish: () => release?.(),
    listMessages: (id: string) => {
      calls.push(id);
      return new Promise<{ messages: Message[]; hasMore: boolean }>((resolve) => {
        release = () => resolve({ messages: [msg(`${id}-m1`)], hasMore: false });
      });
    },
  };
}

test("a prefetch fills the thread store once it lands", async () => {
  forgetThreads();
  const repo = fakeRepo();
  prefetchThread(repo, "C1");
  assert.equal(recentThread("C1"), null, "nothing is drawn before the read lands");
  repo.finish();
  await pendingThread("C1");
  assert.deepEqual(recentThread("C1")?.map((m) => m.id), ["C1-m1"]);
});

test("hovering twice reads once; a held thread is not read again", async () => {
  forgetThreads();
  const repo = fakeRepo();
  prefetchThread(repo, "C1");
  prefetchThread(repo, "C1");
  assert.equal(repo.calls.length, 1);
  repo.finish();
  await pendingThread("C1");
  prefetchThread(repo, "C1");
  assert.equal(repo.calls.length, 1, "a thread already held was read again");
  assert.equal(inflightPrefetchCount(), 0);
});

test("a fresher page the thread remembered itself is not overwritten", async () => {
  forgetThreads();
  const repo = fakeRepo();
  prefetchThread(repo, "C1");
  rememberThread("C1", [msg("fresher")]);
  repo.finish();
  await pendingThread("C1");
  assert.deepEqual(recentThread("C1")?.map((m) => m.id), ["fresher"]);
});

test("rows warm on pointer, touch and focus; the top of the list warms when idle", () => {
  const src = readFileSync("components/features/messages/MessagesArea.tsx", "utf8");
  assert.match(src, /onPointerEnter=\{warm\}\s*onTouchStart=\{warm\}\s*onFocus=\{warm\}/);
  assert.match(src, /all\.slice\(0, 3\)\.map\(\(c\) => c\.id\)/);
  assert.match(src, /requestIdleCallback\(run/);
  /* A thread opened mid-prefetch joins it rather than waiting on nothing. */
  assert.match(src, /pendingThread\(c\.id\)\?\.then\(\(m\) => \{\s*if \(!cancelled && m\) setSeed\(m\);/);
});

test("the list remembers each conversation's collection, so a first open is one read", () => {
  const repo = readFileSync("lib/repositories/legacy/index.ts", "utf8");
  assert.match(
    repo,
    /for \(const \{ conv, coll \} of base\)\s*LegacyRepository\.#conversationCollectionById\.set\(conv\.id, coll\);/,
  );
});
