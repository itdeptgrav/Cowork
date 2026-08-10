import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import {
  CLAIM_UNPROVEN_AFTER_MS,
  HEARTBEAT_INTERVAL_MS,
  PRESENCE_STALE_AFTER_MS,
  claimLapsedAtMs,
  readDutySnapshot,
  type DutyDocument,
} from "./duty.ts";
import {
  applyRemotePresence,
  claimLapsed,
  declareEmergency,
  getSnapshot,
  goOnline,
  reportShare,
  resetStatus,
  startBreak,
} from "../../status/employeeStatus.ts";

/**
 * **A disconnection is noticed, by the device that disconnected.**
 *
 * Staleness expired an `online` claim for every READER and for nobody else: the
 * device holding the claim had no way to expire its own, and since online became
 * a choice rather than a consequence of a live share, nothing local cleared it
 * either. So a laptop whose network died kept a green pill up indefinitely while
 * the rest of the company watched it go grey ten minutes later — one account,
 * two answers, and the wrong one on the screen of the only person who could act.
 *
 * Nothing wrote the lapse down, either. The document went on saying
 * `mode: "online"` for ever, because expiry is the ABSENCE of a write.
 *
 * These cover both halves, and the three things that must NOT move with them.
 */

const NOW = 1_760_000_000_000;

const doc = (over: DutyDocument = {}): DutyDocument => ({
  mode: "online",
  heartbeatAt: NOW,
  presenceConnectionId: "conn-a",
  ...over,
});

/* ── The lapse instant ────────────────────────────────────────────────────── */

test("a claim being kept alive has not lapsed", () => {
  assert.equal(claimLapsedAtMs(doc(), NOW), null);
  assert.equal(
    claimLapsedAtMs(doc({ heartbeatAt: NOW - PRESENCE_STALE_AFTER_MS }), NOW),
    null,
    "expiring exactly on the boundary is not yet expired",
  );
});

test("an expired claim reports WHEN it expired, not when it was noticed", () => {
  /* The whole reason the instant is carried: a laptop that shut at 18:05 must
     produce an 18:05 entry, not one stamped at whatever hour a browser next
     opened — which would file the day's trail under the wrong day entirely. */
  const beat = NOW - PRESENCE_STALE_AFTER_MS - 60_000;
  assert.equal(
    claimLapsedAtMs(doc({ heartbeatAt: beat }), NOW),
    beat + PRESENCE_STALE_AFTER_MS,
  );
});

test("a claim that never beat once lapses as of now", () => {
  /* The old app's manual toggle, which has no heartbeat and can leave `online`
     behind indefinitely. There is no instant to attribute it to. */
  assert.equal(claimLapsedAtMs(doc({ heartbeatAt: null }), NOW), NOW);
});

test("only online lapses", () => {
  /* A break and an emergency are claims about a PERSON, not a connection.
     Expiring one would quietly resume their deadlines and credit them nothing. */
  for (const mode of ["break", "emergency", "offline"] as const) {
    assert.equal(
      claimLapsedAtMs(doc({ mode, heartbeatAt: null }), NOW),
      null,
      `${mode} was treated as an expired claim`,
    );
  }
  assert.equal(claimLapsedAtMs(null, NOW), null);
});

test("an already-closed claim offers nothing to close", () => {
  /* What stops the tidy-up write repeating once a minute for ever: the watcher
     re-emits on its own sweep, and the corrected document must read as done. */
  const closed = readDutySnapshot(doc({ mode: "offline", heartbeatAt: null }), NOW);
  assert.equal(closed.lapsedAtMs, null);
});

test("the snapshot carries the lapse alongside the mode it already corrects", () => {
  const beat = NOW - PRESENCE_STALE_AFTER_MS - 1;
  const snap = readDutySnapshot(doc({ heartbeatAt: beat }), NOW);
  assert.equal(snap.mode, "offline", "the reader was already right about this");
  assert.equal(
    snap.lapsedAtMs,
    beat + PRESENCE_STALE_AFTER_MS,
    "the document is still wrong, and this is what lets it be corrected",
  );
});

/* ── The window ───────────────────────────────────────────────────────────── */

test("a device gives up on itself sooner than a reader gives up on it", () => {
  /* Direct evidence beats silence: the device knows its own writes are not
     landing, a reader only knows nothing has arrived. Demoting locally first is
     also what stops the pill claiming something everybody else has stopped
     believing. */
  assert.ok(
    CLAIM_UNPROVEN_AFTER_MS < PRESENCE_STALE_AFTER_MS,
    "a device would outlive the claim readers had already expired",
  );
  assert.ok(
    CLAIM_UNPROVEN_AFTER_MS > 2 * HEARTBEAT_INTERVAL_MS,
    "two missed beats is the ordinary throttle of a backgrounded tab",
  );
});

/* ── The store ────────────────────────────────────────────────────────────── */

const SHARING = {
  sharing: true,
  connected: true,
  surface: "entire_screen" as const,
  detail: "Sharing your entire screen.",
};

beforeEach(() => resetStatus());

test("a chosen online that cannot be proved is stood down", () => {
  goOnline();
  assert.equal(getSnapshot().status, "online");

  claimLapsed();
  assert.equal(getSnapshot().status, "offline");
  assert.equal(getSnapshot().manual, null);
  assert.match(
    getSnapshot().notice ?? "",
    /could not confirm/i,
    "offline is never left to be inferred — the menu states the reason",
  );
});

test("a break is not a connection, and does not lapse with one", () => {
  startBreak();
  const started = getSnapshot().breakStartedAt;
  claimLapsed();
  assert.equal(getSnapshot().status, "break");
  assert.equal(
    getSnapshot().breakStartedAt,
    started,
    "the stopwatch the person is watching restarted",
  );
});

test("an emergency does not lapse either", () => {
  declareEmergency();
  claimLapsed();
  assert.equal(getSnapshot().status, "emergency");
  assert.notEqual(getSnapshot().emergencyStartedAt, null);
});

test("a live share is evidence of its own, and outlives an unproven claim", () => {
  /* The room is a separate channel to a separate service. A presence write that
     went unacknowledged says nothing at all about whether the screen is still
     going out to a watching manager. */
  goOnline();
  reportShare(SHARING);
  claimLapsed();
  assert.equal(getSnapshot().status, "online");
  assert.equal(
    getSnapshot().notice,
    null,
    "a notice announcing offline would contradict the pill beside it",
  );
});

test("the account being online elsewhere still shows online here", () => {
  /* `remoteOnline` is a fact about the ACCOUNT, restated on every snapshot. A
     device standing down its OWN claim must not also announce that the laptop
     across the room has stopped sharing. */
  goOnline();
  applyRemotePresence({
    mode: "online",
    breakStartedAtMs: null,
    emergencyStartedAtMs: null,
    onlineElsewhere: true,
  });
  claimLapsed();
  assert.equal(getSnapshot().status, "online");
  assert.equal(getSnapshot().remoteOnline, true);
});

test("standing down twice is not a second event", () => {
  goOnline();
  claimLapsed();
  const after = getSnapshot();
  claimLapsed();
  assert.equal(getSnapshot(), after, "an idempotent call re-committed the state");
});

/* ── The wiring ───────────────────────────────────────────────────────────── */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("no heartbeat restates a claim that has already expired", () => {
  /**
   * `ownsClaim` deliberately hands a stale claim to whoever asks — that is its
   * adoption path — so a guard on `storedMode` let a laptop that slept for three
   * hours wake up, beat on `visibilitychange`, and stamp a fresh heartbeat onto
   * a claim that had died before lunch. The absence retroactively never
   * happened. Presence that a timer can resurrect is not presence.
   */
  for (const path of [
    "lib/repositories/legacy/index.ts",
    "lib/repositories/mock/index.ts",
  ]) {
    const src = code(path);
    const at = src.indexOf("async heartbeatDuty");
    assert.ok(at > 0, `${path} has no heartbeatDuty`);
    const body = src.slice(at, src.indexOf("\n  }", at));
    assert.match(
      body,
      /readDutyMode\(previous, now\) !== "online"/,
      `${path} guards its heartbeat on the raw mode, so an expired claim is revived`,
    );
    assert.ok(
      !body.includes("storedMode"),
      `${path} still reads storedMode, which ignores the staleness window`,
    );
  }
});

test("only an acknowledged beat counts as proof of life", () => {
  /* A beat is declined in silence when the claim belongs to another connection
     or has already expired. Reading either as success is how a device goes on
     asserting a session it has lost. */
  const src = code("components/features/status/DutySync.tsx");
  assert.match(src, /if \(result\.ok && result\.data\) lastAck = Date\.now\(\)/);
  assert.match(src, /claimLapsed\(\)/, "nothing stands the claim down");
  assert.match(
    src,
    /CLAIM_UNPROVEN_AFTER_MS/,
    "the watchdog measures against something other than the agreed window",
  );
});

test("the expired claim is written down, not merely read past", () => {
  /* Staleness was read-only, and that was half a mechanism: every reader
     resolved the claim correctly while the document went on saying online for
     ever — which the old application, reading `mode` verbatim, believed. */
  const src = code("components/features/status/DutySync.tsx");
  assert.match(src, /snapshot\.lapsedAtMs !== null/);
  assert.match(src, /mode: "offline",[\s\S]{0,120}lapsedAtMs/);
});
