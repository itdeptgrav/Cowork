import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import {
  clearCachedIdentity,
  readCachedIdentity,
  writeCachedIdentity,
} from "./sessionCache.ts";

/**
 * Remembering who somebody is, so a reload does not re-earn it.
 *
 * Nothing about the sign-in expires — Firebase holds the session and the token
 * cookie is re-mirrored on every silent renewal. What was never kept is the
 * ANSWER: which workspace employee this Firebase user is. So every reload sat
 * on "Signing you in…" through `/cowork/me` and the enrichment behind it.
 *
 * Everything here is about the entry never answering a question it should not:
 * it is keyed by the uid Firebase itself reports, it ages out, and it is
 * forgotten the moment somebody signs out.
 */

const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

const NOW = Date.UTC(2026, 7, 7, 9, 0, 0);
const IDENTITY = {
  employeeId: "E101",
  displayName: "Rakesh Biswal",
  email: "rakesh@example.com",
  archetype: "administrator",
  landing: "/home",
};

beforeEach(() => store.clear());

test("what was written for a uid comes back for that uid", () => {
  writeCachedIdentity("uid-A", IDENTITY, NOW);
  assert.deepEqual(readCachedIdentity("uid-A", NOW), IDENTITY);
});

test("ANOTHER user on the same browser reads nothing", () => {
  /* The one way this could be worse than the wait it replaces: showing
     somebody the shell of the last person to use this machine. */
  writeCachedIdentity("uid-A", IDENTITY, NOW);
  assert.equal(readCachedIdentity("uid-B", NOW), null);
});

test("it never answers without a uid", () => {
  /* It must not be used to GUESS who is signed in — only to skip re-deriving
     an identity for somebody Firebase has already named. */
  writeCachedIdentity("uid-A", IDENTITY, NOW);
  assert.equal(readCachedIdentity(null, NOW), null);
  assert.equal(readCachedIdentity("", NOW), null);
});

test("it ages out", () => {
  writeCachedIdentity("uid-A", IDENTITY, NOW);
  const elevenHours = NOW + 11 * 60 * 60 * 1000;
  const thirteenHours = NOW + 13 * 60 * 60 * 1000;
  assert.deepEqual(readCachedIdentity("uid-A", elevenHours), IDENTITY);
  assert.equal(
    readCachedIdentity("uid-A", thirteenHours),
    null,
    "a browser opened after a weekend used a stale answer",
  );
});

test("signing out forgets it", () => {
  writeCachedIdentity("uid-A", IDENTITY, NOW);
  clearCachedIdentity();
  assert.equal(readCachedIdentity("uid-A", NOW), null);
});

test("an entry from an older shape is ignored, not read", () => {
  store.set(
    "cowork:session:identity",
    JSON.stringify({ v: 0, uid: "uid-A", employeeId: "E101", at: NOW }),
  );
  assert.equal(readCachedIdentity("uid-A", NOW), null);
});

test("corrupt storage is survivable", () => {
  store.set("cowork:session:identity", "{not json");
  assert.equal(readCachedIdentity("uid-A", NOW), null);
});

test("an entry with no employee id is worthless and refused", () => {
  writeCachedIdentity("uid-A", { ...IDENTITY, employeeId: "" }, NOW);
  assert.equal(readCachedIdentity("uid-A", NOW), null);
});

/* ── How the provider uses it ─────────────────────────────────────────────── */

test("the provider reads the uid from FIREBASE, never from the cache or cookie", () => {
  /* The safety property the whole design rests on. If the uid ever came from
     the cache itself, or from the mirrored cookie, this would be guessing who
     is signed in rather than skipping work for somebody already named. */
  const src = readFileSync("components/features/auth/SessionProvider.tsx", "utf8");
  assert.match(
    src,
    /readCachedIdentity\(currentUser\(\)\?\.uid \?\? null\)/,
    "the remembered identity is keyed on something other than the SDK's own user",
  );
});

test("the ladder still runs, and still overwrites it", () => {
  /* The cache is a first paint, not a substitute. A role change, a transfer or
     a deactivation has to correct itself within one round trip. */
  const src = readFileSync("components/features/auth/SessionProvider.tsx", "utf8");
  const from = src.indexOf("const remembered = readCachedIdentity");
  assert.ok(from > 0, "the fast paint is gone");
  const after = src.slice(from);
  assert.match(
    after,
    /const data = await readIdentityPayload\(\);/,
    "the identity ladder no longer runs after the cached paint",
  );
  assert.ok(
    after.indexOf("writeCachedIdentity(") > after.indexOf("status: \"authenticated\""),
    "the entry is written before the ladder has answered",
  );
});

test("a refusal forgets it", () => {
  const src = readFileSync("components/features/auth/SessionProvider.tsx", "utf8");
  const anon = src.indexOf('if (!data.authenticated || !data.employeeId)');
  assert.ok(anon > 0, "the anonymous branch moved");
  assert.match(
    src.slice(anon, anon + 400),
    /clearCachedIdentity\(\)/,
    "resolving to anonymous leaves a remembered identity behind",
  );
});
