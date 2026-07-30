/**
 * Reading and writing the mock store to `localStorage`. Development only —
 * see `lib/config/mockPersistence.ts` for why this exists and what turns it off.
 *
 * Nothing outside `lib/repositories/mock/` may import this.
 *
 * Three properties this file is responsible for:
 *
 *  · **The seed is always the fallback.** No saved state, a different schema
 *    version, different fixtures, unparseable JSON, storage unavailable — every
 *    one of those paths returns the freshly built store untouched.
 *  · **A saved payload never widens the store.** Restoration merges onto a
 *    fresh build, key by key, and only for keys the build already has. A field
 *    the fixture has since dropped cannot come back from storage, and a
 *    collection added since the payload was written arrives seeded rather than
 *    missing.
 *  · **It stores state, not decisions.** The store holds records. Who may see
 *    them, who approves them and what happens next are computed from those
 *    records on every read, by code that does not know this file exists.
 */

/* Relative, extensioned imports rather than the `@/` alias: this module has a
   unit test, and the test runner is plain `node --test`, which resolves neither
   the alias nor an extensionless path. */
import {
  MOCK_PERSISTENCE_ENABLED,
  MOCK_STORE_STORAGE_KEY,
  MOCK_STORE_SCHEMA_VERSION,
} from "../../config/mockPersistence.ts";
import {
  exportRuleOverrides,
  importRuleOverrides,
} from "../../config/settings.ts";
import type { Store } from "./store.ts";

/**
 * `Store` is a type-only import, so this file and `store.ts` import each other
 * on paper and never at runtime.
 */

interface Payload {
  schemaVersion: number;
  /** Identifies the fixture the payload was written against — see `load`. */
  seedFingerprint: string;
  savedAt: string;
  store: unknown;
  /**
   * Published rule values, which live in `lib/config/settings.ts` rather than
   * in the store because the scoring engine reads them directly.
   *
   * They travel with the store because they are two halves of one fact.
   * `store.rules` is what the admin cards render; this map is what the engine
   * computes with. Persisting one without the other would restore a session
   * where a card reads 0.5 and every score is still calculated at 0.2 — the
   * exact divergence `settings.ts` was written to prevent.
   */
  ruleOverrides: [string, number | string][];
}

/**
 * Store keys the save deliberately skips.
 *
 * `failure` is the DemoBar's simulated-failure switch — a control, not workspace
 * state. Restoring it would mean a reload taken while demonstrating the offline
 * state comes back offline, with the app appearing broken and no indication
 * why.
 */
const TRANSIENT_KEYS = new Set<keyof Store>(["failure"]);

/**
 * Turned off for the rest of the session when storage refuses a write. One
 * warning, then silence: a quota error repeating on every keystroke would bury
 * the console output somebody is probably reading at the time.
 */
let disabledForSession = false;

function storage(): globalThis.Storage | null {
  if (!MOCK_PERSISTENCE_ENABLED || disabledForSession) return null;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    /* Storage can throw on access alone under some privacy settings. */
    return null;
  }
}

/**
 * The saved store, merged onto `fresh`, or `fresh` unchanged.
 *
 * `fresh` is both the fallback and the shape specification: the merge copies a
 * saved value only where `fresh` has that key and agrees on whether it is an
 * array. That is what makes a stale payload degrade to "some collections are
 * seeded" instead of "a collection is `undefined` and the first read throws".
 *
 * `seedFingerprint` handles the other staleness: editing `lib/mock/seed.ts`
 * while a saved store exists would otherwise leave the new fixtures invisible
 * behind a payload written before them. A changed fingerprint discards the save
 * — the new seed is the thing you just asked for.
 */
export function load(fresh: Store, seedFingerprint: string): Store {
  const s = storage();
  if (!s) return fresh;

  let raw: string | null;
  try {
    raw = s.getItem(MOCK_STORE_STORAGE_KEY);
  } catch {
    return fresh;
  }
  if (!raw) return fresh;

  let payload: Payload;
  try {
    payload = JSON.parse(raw) as Payload;
  } catch {
    clear();
    return fresh;
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    payload.schemaVersion !== MOCK_STORE_SCHEMA_VERSION ||
    payload.seedFingerprint !== seedFingerprint ||
    !payload.store ||
    typeof payload.store !== "object"
  ) {
    clear();
    return fresh;
  }

  const saved = payload.store as Record<string, unknown>;
  const merged = fresh as unknown as Record<string, unknown>;

  for (const key of Object.keys(merged)) {
    if (TRANSIENT_KEYS.has(key as keyof Store)) continue;
    if (!(key in saved)) continue;
    const savedValue = saved[key];
    const freshValue = merged[key];
    if (Array.isArray(freshValue) !== Array.isArray(savedValue)) continue;
    if (savedValue === null || savedValue === undefined) continue;
    merged[key] = savedValue;
  }

  if (Array.isArray(payload.ruleOverrides)) {
    importRuleOverrides(payload.ruleOverrides);
  }

  return fresh;
}

/** Written by `save`, cleared by `clear`, coalesced by `scheduleSave`. */
let pending: (() => Payload) | null = null;

/**
 * Coalesces a burst of mutations into one write.
 *
 * A microtask rather than a timer, deliberately: it flushes before the browser
 * can process a click that navigates or reloads, so "mutate, then reload" is
 * ordered rather than a race. A debounce measured in milliseconds would lose
 * the last change often enough to look like a bug in the thing being verified.
 */
export function scheduleSave(read: () => Store): void {
  if (!MOCK_PERSISTENCE_ENABLED || disabledForSession) return;
  if (typeof window === "undefined") return;

  const wasPending = pending !== null;
  pending = () => ({
    schemaVersion: MOCK_STORE_SCHEMA_VERSION,
    seedFingerprint: currentFingerprint,
    savedAt: new Date().toISOString(),
    store: withoutTransient(read()),
    ruleOverrides: exportRuleOverrides(),
  });
  if (wasPending) return;

  queueMicrotask(() => {
    const build = pending;
    pending = null;
    if (build) write(build());
  });
}

/** Both halves read the same skip-list, so a key can never save but not load. */
function withoutTransient(store: Store): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(store)) {
    if (TRANSIENT_KEYS.has(key as keyof Store)) continue;
    out[key] = value;
  }
  return out;
}

/** Set once by `store.ts` so `scheduleSave` need not be handed it every time. */
let currentFingerprint = "";

export function setSeedFingerprint(fingerprint: string): void {
  currentFingerprint = fingerprint;
}

function write(payload: Payload): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(MOCK_STORE_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    disabledForSession = true;
    console.warn(
      "[mock] Could not persist the store; this session will not survive a " +
        "reload. Everything else works normally.",
      err,
    );
  }
}

/** Drops the saved store, so the next load builds from the seed. */
export function clear(): void {
  pending = null;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(MOCK_STORE_STORAGE_KEY);
  } catch {
    /* Nothing to do — a store we cannot clear is one we cannot have written. */
  }
}
