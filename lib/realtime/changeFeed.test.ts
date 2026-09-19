import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  COALESCE_MS,
  INVALIDATES,
  methodsFor,
  startChangeFeed,
  type ChangeNotice,
  type ChangeSocket,
} from "./changeFeed.ts";

/**
 * The client half of realtime.
 *
 * What is being protected: that replacing Firestore's live cursors with a
 * server-pushed notice keeps the screen as current as it was, without turning
 * one user action into a storm of refetches.
 */

function fakeSocket() {
  const handlers = new Map<string, ((p: never) => void)[]>();
  return {
    socket: {
      on(event: string, handler: (p: never) => void) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      off(event: string, handler: (p: never) => void) {
        handlers.set(
          event,
          (handlers.get(event) ?? []).filter((h) => h !== handler),
        );
      },
    } satisfies ChangeSocket,
    fire(event: string, payload: unknown) {
      for (const h of handlers.get(event) ?? []) (h as (p: unknown) => void)(payload);
    },
    count(event: string) {
      return (handlers.get(event) ?? []).length;
    },
  };
}

const notice = (collection: string, over: Partial<ChangeNotice> = {}) =>
  ({ collection, id: "X1", operation: "update", ...over }) as ChangeNotice;

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── The map ──────────────────────────────────────────────────────────────── */

test("every mapped method is a real repository read", () => {
  /* A typo here is silent: `notifyRepositoryChanged` drops caches for the
     methods it is NAMED, so a misspelt one clears nothing and the list stays
     stale for its whole TTL. */
  const names = new Set(Object.values(INVALIDATES).flat());
  /* Read from the interface rather than restated, so the two cannot drift. */
  const types = readFileSync("lib/repositories/types.ts", "utf8").replace(
    /\r\n/g,
    "\n",
  );
  for (const name of names)
    assert.ok(
      new RegExp(`\\n  ${name}\\??\\s*[<(]`).test(types),
      `${name} is not a method on CoworkRepository`,
    );
});

test("a task change invalidates the reads a task appears in", () => {
  const m = methodsFor([notice("cowork_tasks")]);
  for (const expected of ["getTask", "listTasks", "listActionable"])
    assert.ok(m.includes(expected), `${expected} was not invalidated`);
});

test("a notification does not invalidate the task lists", () => {
  /* Too broad a map costs a refetch of everything on every notification — and
     notifications are the most frequent write in the product. */
  assert.deepEqual(methodsFor([notice("cowork_notifications")]), [
    "listNotifications",
  ]);
});

test("the flattened subcollections are keyed, since that is where the traffic is", () => {
  /**
   * `firestoreCompat` stores `cowork_tasks/{id}/chat` as `cowork_tasks__chat`,
   * so that is the name the server's notice carries. Keying this map only by
   * parent meant every chat message, every conversation message and every timer
   * session arrived under a name that matched nothing.
   */
  assert.deepEqual(methodsFor([notice("cowork_tasks__chat")]), ["listTaskChat"]);
  for (const c of [
    "cowork_direct_messages__messages",
    "cowork_conversations__messages",
    "cowork_groups__messages",
  ]) {
    const m = methodsFor([notice(c)]);
    assert.ok(m.includes("listMessages"), `${c} does not refresh the thread`);
    assert.ok(m.includes("listConversations"), `${c} does not refresh the list`);
  }
  assert.ok(methodsFor([notice("cowork_task_timers__sessions")]).includes("listTimers"));
});

test("every TTL-cached read this feed can touch is named, not left to the bump", () => {
  /**
   * A collection missing from the map still bumps the version, which is enough
   * for a zero-staleTime query. It is NOT enough for a cached one:
   * `notifyRepositoryChanged` drops cached answers only for the methods it is
   * NAMED, so a bare bump leaves a TTL entry standing and the list goes on
   * showing the previous state until the window lapses.
   */
  const cached = ["listConversations", "listTimers", "listDocuments"];
  const named = new Set(Object.values(INVALIDATES).flat());
  for (const m of cached)
    assert.ok(named.has(m), `${m} is TTL-cached but no collection invalidates it`);
});

test("an unmapped collection invalidates nothing but still applies", () => {
  /* The safe side: the version still bumps so live queries re-run; no TTL cache
     is purged. Correct screen, one cached answer survives its window. */
  assert.deepEqual(methodsFor([notice("cowork_something_new")]), []);
});

test("a batch is the union, with no repeats", () => {
  const m = methodsFor([
    notice("cowork_tasks"),
    notice("cowork_tasks"),
    notice("cowork_notifications"),
  ]);
  assert.equal(new Set(m).size, m.length, "a method was invalidated twice");
  assert.ok(m.includes("listNotifications"));
  assert.ok(m.includes("getTask"));
});

/* ── Coalescing ───────────────────────────────────────────────────────────── */

test("a burst of changes is one invalidation, not twenty", async () => {
  /* Renumbering a queue writes a row per task. Each is its own oplog entry, and
     each bump makes every mounted query refetch. */
  const s = fakeSocket();
  const applied: string[][] = [];
  const stop = startChangeFeed(s.socket, {
    coalesceMs: 10,
    onApply: (m) => applied.push(m),
  });

  for (let i = 0; i < 20; i++) s.fire("realtime:change", notice("cowork_tasks"));
  await settle(30);

  assert.equal(applied.length, 1, `applied ${applied.length} times`);
  assert.ok(applied[0].includes("listTasks"));
  stop();
});

test("changes after a flush start a new batch", async () => {
  const s = fakeSocket();
  const applied: string[][] = [];
  const stop = startChangeFeed(s.socket, {
    coalesceMs: 10,
    onApply: (m) => applied.push(m),
  });

  s.fire("realtime:change", notice("cowork_tasks"));
  await settle(30);
  s.fire("realtime:change", notice("cowork_notifications"));
  await settle(30);

  assert.equal(applied.length, 2);
  assert.deepEqual(applied[1], ["listNotifications"]);
  stop();
});

test("the window is short enough not to be felt", () => {
  /* Long enough to gather one action's writes, far below the ~100ms where a
     delay starts reading as lag. */
  assert.ok(COALESCE_MS > 0 && COALESCE_MS <= 100);
});

test("a malformed notice is ignored rather than throwing", async () => {
  const s = fakeSocket();
  const applied: string[][] = [];
  const stop = startChangeFeed(s.socket, {
    coalesceMs: 10,
    onApply: (m) => applied.push(m),
  });
  for (const bad of [null, undefined, {}, { collection: 42 }])
    s.fire("realtime:change", bad);
  await settle(30);
  assert.equal(applied.length, 0);
  stop();
});

/* ── Resync ───────────────────────────────────────────────────────────────── */

test("a resync refreshes everything and drops the pending batch", async () => {
  /* The server could not resume, so some changes were never delivered. The
     pending batch is a strict subset of what a full refresh covers — applying
     it afterwards would be a second storm for nothing. */
  const s = fakeSocket();
  const applied: string[][] = [];
  let resyncs = 0;
  const stop = startChangeFeed(s.socket, {
    coalesceMs: 10,
    onApply: (m) => applied.push(m),
    onResync: () => {
      resyncs += 1;
    },
  });

  s.fire("realtime:change", notice("cowork_tasks"));
  s.fire("realtime:resync", {});
  await settle(30);

  assert.equal(resyncs, 1);
  assert.equal(applied.length, 0, "the dropped batch was applied anyway");
  stop();
});

/* ── Detaching ────────────────────────────────────────────────────────────── */

test("detaching removes both handlers", () => {
  const s = fakeSocket();
  const stop = startChangeFeed(s.socket, { onApply: () => {} });
  assert.equal(s.count("realtime:change"), 1);
  assert.equal(s.count("realtime:resync"), 1);
  stop();
  assert.equal(s.count("realtime:change"), 0);
  assert.equal(s.count("realtime:resync"), 0);
});

test("a batch in flight never fires after detaching", async () => {
  /* The socket is replaced when the viewer changes. A feed that fired after
     that would invalidate on behalf of a session that had ended. */
  const s = fakeSocket();
  const applied: string[][] = [];
  const stop = startChangeFeed(s.socket, {
    coalesceMs: 30,
    onApply: (m) => applied.push(m),
  });
  s.fire("realtime:change", notice("cowork_tasks"));
  stop();
  await settle(60);
  assert.equal(applied.length, 0);
});
