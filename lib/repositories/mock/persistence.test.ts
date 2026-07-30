import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { clear, load, scheduleSave, setSeedFingerprint } from "./persistence.ts";
import {
  clearAllRuleOverrides,
  exportRuleOverrides,
  setRuleOverride,
} from "../../config/settings.ts";
import {
  MOCK_STORE_SCHEMA_VERSION,
  MOCK_STORE_STORAGE_KEY,
} from "../../config/mockPersistence.ts";

/**
 * What these hold.
 *
 * Persistence is the one part of the mock layer whose failures are silent and
 * destructive: a bad restore does not throw, it hands the application a store
 * that is subtly not the one it saved. So the tests are about the FALLBACK
 * paths — every reason a payload might be untrustworthy has to end at the seed,
 * because the alternative is the prototype quietly running on half a fixture.
 *
 * The round-trip test is the cheap one. The five rejection tests are the point.
 */

/* A store-shaped object. Deliberately not the real one: these tests are about
   the persistence mechanism, and coupling them to the fixture would make every
   seed edit a failing persistence test. */
interface FakeStore {
  tasks: { id: string }[];
  approvals: { id: string }[];
  notifications: { id: string }[];
  seq: number;
  failure: string;
  clockOffsetMs: number;
}

function fresh(): FakeStore {
  return {
    tasks: [{ id: "seeded" }],
    approvals: [],
    notifications: [],
    seq: 1000,
    failure: "none",
    clockOffsetMs: 0,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const asStore = (s: FakeStore) => s as any;

class FakeStorage {
  items = new Map<string, string>();
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
  (globalThis as any).window = { localStorage: storage };
  setSeedFingerprint("fp-1");
  clearAllRuleOverrides();
  clear();
});

/** `scheduleSave` coalesces on a microtask, so a save has to be awaited. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function saved(): any {
  const raw = storage.getItem(MOCK_STORE_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

test("a saved store comes back on the next load", async () => {
  const s = fresh();
  s.tasks.push({ id: "t-created" });
  s.seq = 1042;
  scheduleSave(() => asStore(s));
  await flush();

  const restored = load(asStore(fresh()), "fp-1") as unknown as FakeStore;
  assert.deepEqual(
    restored.tasks.map((t) => t.id),
    ["seeded", "t-created"],
  );
  assert.equal(restored.seq, 1042);
});

test("no saved state falls back to the seed", () => {
  const restored = load(asStore(fresh()), "fp-1") as unknown as FakeStore;
  assert.deepEqual(
    restored.tasks.map((t) => t.id),
    ["seeded"],
  );
});

test("a store saved against a different fixture is discarded", async () => {
  const s = fresh();
  s.tasks = [{ id: "t-old-fixture" }];
  scheduleSave(() => asStore(s));
  await flush();

  /* The seed gained a task since the save — the new fixture is the thing the
     developer just asked for, so the stale payload loses. */
  const restored = load(asStore(fresh()), "fp-2") as unknown as FakeStore;
  assert.deepEqual(
    restored.tasks.map((t) => t.id),
    ["seeded"],
  );
  assert.equal(saved(), null, "the rejected payload is also cleared");
});

test("a payload from an older schema is discarded", async () => {
  const s = fresh();
  s.tasks = [{ id: "t-old-schema" }];
  scheduleSave(() => asStore(s));
  await flush();

  const payload = saved();
  payload.schemaVersion = 0;
  storage.setItem(MOCK_STORE_STORAGE_KEY, JSON.stringify(payload));

  const restored = load(asStore(fresh()), "fp-1") as unknown as FakeStore;
  assert.deepEqual(
    restored.tasks.map((t) => t.id),
    ["seeded"],
  );
});

test("unparseable storage falls back rather than throwing", () => {
  storage.setItem(MOCK_STORE_STORAGE_KEY, "{ not json");
  const restored = load(asStore(fresh()), "fp-1") as unknown as FakeStore;
  assert.deepEqual(
    restored.tasks.map((t) => t.id),
    ["seeded"],
  );
  assert.equal(saved(), null);
});

test("a collection the payload predates arrives seeded, not missing", async () => {
  /* The save happens before `notifications` exists in the store shape. This is
     the case that would otherwise hand the application `undefined` and fail on
     the first read, well away from the cause. */
  const old = { tasks: [{ id: "t-1" }], seq: 5 };
  storage.setItem(
    MOCK_STORE_STORAGE_KEY,
    JSON.stringify({
      schemaVersion: MOCK_STORE_SCHEMA_VERSION,
      seedFingerprint: "fp-1",
      savedAt: "2026-07-27T00:00:00.000Z",
      store: old,
      ruleOverrides: [],
    }),
  );

  const restored = load(asStore(fresh()), "fp-1") as unknown as FakeStore;
  assert.deepEqual(
    restored.tasks.map((t) => t.id),
    ["t-1"],
    "what the payload did carry is restored",
  );
  assert.deepEqual(restored.notifications, [], "and the rest is seeded");
  assert.ok(Array.isArray(restored.approvals));
});

test("a saved value of the wrong arity is ignored", () => {
  storage.setItem(
    MOCK_STORE_STORAGE_KEY,
    JSON.stringify({
      schemaVersion: MOCK_STORE_SCHEMA_VERSION,
      seedFingerprint: "fp-1",
      savedAt: "2026-07-27T00:00:00.000Z",
      store: { tasks: { corrupted: true }, seq: 9 },
      ruleOverrides: [],
    }),
  );

  const restored = load(asStore(fresh()), "fp-1") as unknown as FakeStore;
  assert.ok(Array.isArray(restored.tasks), "tasks stayed an array");
  assert.equal(restored.seq, 9, "and the sound keys still restored");
});

test("the simulated-failure switch is not persisted", async () => {
  const s = fresh();
  s.failure = "offline";
  scheduleSave(() => asStore(s));
  await flush();

  assert.equal(
    saved().store.failure,
    undefined,
    "a reload during an offline demo must not come back offline",
  );

  const restored = load(asStore(fresh()), "fp-1") as unknown as FakeStore;
  assert.equal(restored.failure, "none");
});

test("published rule values travel with the store", async () => {
  setRuleOverride("deadlineMissDeduction", 0.5);
  scheduleSave(() => asStore(fresh()));
  await flush();

  /* The engine reads these, the admin cards read `store.rules`. Restoring one
     without the other is the card-says-0.5-engine-says-0.2 divergence. */
  clearAllRuleOverrides();
  assert.deepEqual(exportRuleOverrides(), []);

  load(asStore(fresh()), "fp-1");
  assert.deepEqual(exportRuleOverrides(), [["deadlineMissDeduction", 0.5]]);
});

test("clear() removes the saved store", async () => {
  scheduleSave(() => asStore(fresh()));
  await flush();
  assert.notEqual(saved(), null);

  clear();
  assert.equal(saved(), null, "reset must not be undone by the next reload");
});

test("a burst of mutations writes once", async () => {
  let reads = 0;
  const read = () => {
    reads += 1;
    return asStore(fresh());
  };
  scheduleSave(read);
  scheduleSave(read);
  scheduleSave(read);
  await flush();
  assert.equal(reads, 1);
});
