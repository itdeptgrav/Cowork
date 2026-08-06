import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRESENCE_STALE_AFTER_MS,
  readDutySnapshot,
  type DutyDocument,
} from "./duty.ts";

const NOW = 1_760_000_000_000;

const doc = (over: Partial<DutyDocument> = {}): DutyDocument => ({
  mode: "online",
  heartbeatAt: NOW - 1_000,
  ...over,
});

test("a break carries the instant it began, so every device agrees", () => {
  /* **The 13-seconds-vs-4-seconds bug.** The mode crossed to the second device
     and the timestamp did not, so each device started counting from whenever it
     happened to find out. The clocks are not synchronised — they cannot be —
     they are given one shared origin. */
  const started = NOW - 90_000;
  const snap = readDutySnapshot(
    doc({ mode: "break", breakStartedAtMs: started }),
    NOW,
  );
  assert.equal(snap.mode, "break");
  assert.equal(snap.breakStartedAtMs, started);
});

test("an emergency carries its own instant too", () => {
  const started = NOW - 300_000;
  const snap = readDutySnapshot(
    doc({ mode: "emergency", emergencyStartedAtMs: started }),
    NOW,
  );
  assert.equal(snap.mode, "emergency");
  assert.equal(snap.emergencyStartedAtMs, started);
});

test("a start time is returned only for the mode actually in force", () => {
  /* A `breakStartedAtMs` left behind by a break that ENDED is not a live clock.
     Handing it back would let a device count a break nobody is on. */
  const snap = readDutySnapshot(
    doc({ mode: "online", breakStartedAtMs: NOW - 5_000 }),
    NOW,
  );
  assert.equal(snap.breakStartedAtMs, null);
  assert.equal(snap.emergencyStartedAtMs, null);
});

test("a break and an emergency never both report a clock", () => {
  const snap = readDutySnapshot(
    doc({
      mode: "break",
      breakStartedAtMs: NOW - 1_000,
      emergencyStartedAtMs: NOW - 9_000,
    }),
    NOW,
  );
  assert.equal(snap.emergencyStartedAtMs, null);
});

test("the online claim names the connection holding it", () => {
  /* What lets a device tell "I am the one sharing" from "somebody else on this
     account is" — the same fact, needing two different sentences on screen. */
  const snap = readDutySnapshot(
    doc({ mode: "online", presenceConnectionId: "conn-a" }),
    NOW,
  );
  assert.equal(snap.presenceConnectionId, "conn-a");
});

test("a stale online claim reports offline and names nobody", () => {
  /* Staleness is applied before anything else, so a laptop that was shut does
     not keep a phone showing Online. */
  const snap = readDutySnapshot(
    doc({
      mode: "online",
      presenceConnectionId: "conn-a",
      heartbeatAt: NOW - PRESENCE_STALE_AFTER_MS - 1,
    }),
    NOW,
  );
  assert.equal(snap.mode, "offline");
  assert.equal(snap.presenceConnectionId, null);
});

test("a missing document is offline with no clocks", () => {
  const snap = readDutySnapshot(null, NOW);
  assert.deepEqual(snap, {
    mode: "offline",
    breakStartedAtMs: null,
    emergencyStartedAtMs: null,
    presenceConnectionId: null,
  });
});

test("a malformed timestamp is dropped rather than trusted", () => {
  /* The document is written by two applications across several years. A string
     or a NaN where a number belongs must not become `new Date(NaN)` in a
     stopwatch. */
  for (const bad of ["1760000000000", NaN, Infinity, null, undefined, {}]) {
    const snap = readDutySnapshot(
      doc({ mode: "break", breakStartedAtMs: bad as never }),
      NOW,
    );
    assert.equal(snap.breakStartedAtMs, null, `accepted ${String(bad)}`);
  }
});
