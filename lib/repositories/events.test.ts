import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cacheKeyTargets,
  getRepositoryVersion,
  invalidateQueries,
  notifyRepositoryChanged,
  purgeQueryCaches,
  subscribeToRepository,
  subscribeToStaleData,
} from "./events.ts";

/**
 * The change signal, and the second one that had to exist beside it.
 *
 * A bare version bump says *something* changed. That is enough for a query with
 * no `staleTime`, and it is NOT enough for one that has a TTL cache keyed
 * without the version — the cache answers from its own copy and the bump
 * changes nothing on screen.
 *
 * `listConversations` is exactly that case: a 30-second TTL over the data that
 * draws both the message previews and the unread badges. A message sent or
 * received inside the window left the conversation list showing the previous
 * message as the newest one, and raised no badge. These tests hold the signal
 * that fixes it.
 */

test("a bare bump advances the version and wakes subscribers", () => {
  const before = getRepositoryVersion();
  let woke = 0;
  const stop = subscribeToRepository(() => {
    woke += 1;
  });
  try {
    notifyRepositoryChanged();
  } finally {
    stop();
  }
  assert.equal(getRepositoryVersion(), before + 1);
  assert.equal(woke, 1);
});

test("a bare bump names nothing stale — existing callers are unchanged", () => {
  const seen: readonly string[][] = [];
  const heard: string[][] = [];
  const stop = subscribeToStaleData((m) => heard.push([...m]));
  try {
    notifyRepositoryChanged();
  } finally {
    stop();
  }
  assert.deepEqual(heard, seen);
});

test("naming a method tells the cache which reads to drop", () => {
  const heard: string[][] = [];
  const stop = subscribeToStaleData((m) => heard.push([...m]));
  try {
    notifyRepositoryChanged("listConversations");
  } finally {
    stop();
  }
  assert.deepEqual(heard, [["listConversations"]]);
});

test("the purge runs BEFORE the version bump, never after", () => {
  /* Order is the whole point. A subscriber woken by the bump re-reads
     immediately; a cache purged behind it would be purged too late and the
     stale answer would be served one more time. */
  const order: string[] = [];
  const stopStale = subscribeToStaleData(() => order.push("purge"));
  const stopBump = subscribeToRepository(() => order.push("bump"));
  try {
    notifyRepositoryChanged("listConversations");
  } finally {
    stopStale();
    stopBump();
  }
  assert.deepEqual(order, ["purge", "bump"]);
});

test("invalidateQueries purges without bumping", () => {
  /* The mock repository relies on this: `useAction` bumps for it already, and a
     second bump would make every query on the page run two round trips. */
  const before = getRepositoryVersion();
  const heard: string[][] = [];
  const stopStale = subscribeToStaleData((m) => heard.push([...m]));
  let woke = 0;
  const stopBump = subscribeToRepository(() => {
    woke += 1;
  });
  try {
    invalidateQueries("listConversations");
  } finally {
    stopStale();
    stopBump();
  }
  assert.deepEqual(heard, [["listConversations"]]);
  assert.equal(getRepositoryVersion(), before, "must not advance the version");
  assert.equal(woke, 0, "must not wake the version subscribers");
});

test("invalidateQueries with no names does nothing at all", () => {
  let heard = 0;
  const stop = subscribeToStaleData(() => {
    heard += 1;
  });
  try {
    invalidateQueries();
  } finally {
    stop();
  }
  assert.equal(heard, 0);
});

test("unsubscribing stops delivery", () => {
  let heard = 0;
  const stop = subscribeToStaleData(() => {
    heard += 1;
  });
  stop();
  notifyRepositoryChanged("listConversations");
  assert.equal(heard, 0);
});

/**
 * The string match that stands in for a dependency graph.
 *
 * The cache never stored a method name, so which entries belong to a method is
 * decided by looking for the call inside the fetcher's source text.
 */

test("matches the method the fetcher actually calls", () => {
  assert.equal(cacheKeyTargets("(r) => r.listConversations()[]", "listConversations"), true);
});

test("matches through a minified parameter name", () => {
  /* Property accesses survive minification; only the parameter is renamed. That
     is the same guarantee `METHOD_STALE_DEFAULTS` already depends on. */
  assert.equal(cacheKeyTargets("(e)=>e.listConversations()[]", "listConversations"), true);
});

test("a longer method name is not cleared by a shorter one", () => {
  /* `listMessages` must not clear `listMessagesForTask`. Anchoring on the
     opening bracket is what prevents it. */
  const key = '(r) => r.listMessagesForTask(id)["t1"]';
  assert.equal(cacheKeyTargets(key, "listMessages"), false);
  assert.equal(cacheKeyTargets(key, "listMessagesForTask"), true);
});

test("a method named without being called does not match", () => {
  /* A name inside a comment is not a call, and clearing on it would drop a
     cached read for a query that never made one. */
  assert.equal(
    cacheKeyTargets("(r) => r.getTask(id) /* not listConversations */[]", "listConversations"),
    false,
  );
});

test("an unrelated fetcher is left alone", () => {
  assert.equal(cacheKeyTargets("(r) => r.getWorkloadFlow(q)[]", "listConversations"), false);
});

test("the dot is required — a bare occurrence is not a call on the repository", () => {
  assert.equal(cacheKeyTargets("listConversations(", "listConversations"), false);
});

/**
 * The purge itself — the link that actually empties the cache.
 *
 * `useQuery` holds two caches with different key shapes, and both have to lose
 * the right entries and keep the rest. Getting this wrong is silent either way:
 * clear too little and the conversation list stays frozen exactly as it was,
 * clear too much and every expensive read on the page re-runs on every message.
 */

/** The shape `useQuery` builds: the fetcher's source text, then the deps. */
const conversationsKey = '(r) => r.listConversations()[]';
const workloadKey = '(r) => r.getWorkloadFlow(q)[{"weeks":4}]';

test("purging drops the named method's TTL entry", () => {
  const ttl = new Map<string, unknown>([[conversationsKey, { data: [] }]]);
  purgeQueryCaches(["listConversations"], ttl, new Map());
  assert.equal(ttl.has(conversationsKey), false);
});

test("purging leaves every other TTL entry alone", () => {
  /* The whole point of `staleTime` is that a message does not re-run the
     weekly graph. A purge that took this with it would undo the cache. */
  const ttl = new Map<string, unknown>([
    [conversationsKey, { data: [] }],
    [workloadKey, { data: [] }],
  ]);
  purgeQueryCaches(["listConversations"], ttl, new Map());
  assert.deepEqual([...ttl.keys()], [workloadKey]);
});

test("purging drops the preload entry for the same method", () => {
  /* Keyed by NAME plus stringified deps, not by source. */
  const preload = new Map<string, unknown>([['listConversations[]', { data: [] }]]);
  purgeQueryCaches(["listConversations"], new Map(), preload);
  assert.equal(preload.size, 0);
});

test("a preload key for a longer method name survives", () => {
  const preload = new Map<string, unknown>([
    ['listMessages[]', { data: [] }],
    ['listMessagesForTask["t1"]', { data: [] }],
  ]);
  purgeQueryCaches(["listMessages"], new Map(), preload);
  assert.deepEqual([...preload.keys()], ['listMessagesForTask["t1"]']);
});

test("several methods purge in one pass", () => {
  const ttl = new Map<string, unknown>([
    [conversationsKey, { data: [] }],
    [workloadKey, { data: [] }],
  ]);
  purgeQueryCaches(["listConversations", "getWorkloadFlow"], ttl, new Map());
  assert.equal(ttl.size, 0);
});

test("purging a method nothing cached is a no-op, not a throw", () => {
  const ttl = new Map<string, unknown>([[workloadKey, { data: [] }]]);
  purgeQueryCaches(["listConversations"], ttl, new Map());
  assert.equal(ttl.size, 1);
});

test("the signal reaches a subscriber that purges — end to end", () => {
  /* What `useRepository` wires up at module load, assembled here so the whole
     chain is covered rather than only its two ends. */
  const ttl = new Map<string, unknown>([[conversationsKey, { data: [] }]]);
  const preload = new Map<string, unknown>();
  const stop = subscribeToStaleData((m) => purgeQueryCaches(m, ttl, preload));
  try {
    notifyRepositoryChanged("listConversations");
  } finally {
    stop();
  }
  assert.equal(ttl.size, 0, "a named bump must empty the conversation cache");
});

test("a bare bump leaves the cache standing — the TTL still does its job", () => {
  const ttl = new Map<string, unknown>([[workloadKey, { data: [] }]]);
  const stop = subscribeToStaleData((m) => purgeQueryCaches(m, ttl, new Map()));
  try {
    notifyRepositoryChanged();
  } finally {
    stop();
  }
  assert.equal(ttl.size, 1, "an unrelated mutation must not re-run a cached read");
});
