import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HEARTBEAT_INTERVAL_MS,
  STALE_AFTER_MS,
  dailyHoursSecs,
  dutyDayKey,
  dutyTransition,
  heartbeatPatch,
  isStale,
  ownsClaim,
  queueAnchorMs,
  readDutyMode,
  storedMode,
  type DutyDocument,
} from "./duty.ts";

/**
 * The presence rules, locked.
 *
 * These are the cases that are hard to stage by hand and therefore the ones
 * most likely to be wrong: a crashed tab, two tabs, a refresh mid-session, a
 * break that spans a sign-out. Every transition assertion cites
 * `DutyStatusToggle.jsx`, because legacy's arithmetic is the specification and
 * this is a port of it rather than a fresh design.
 */

const T0 = 1_800_000_000_000;

/* ── Reading ──────────────────────────────────────────────────────────────── */

test("an absent document is offline, as a fact rather than a default", () => {
  /* Nobody has ever gone on duty. That IS offline — it is not a value standing
     in for one we could not read. */
  assert.equal(readDutyMode(null, T0), "offline");
  assert.equal(storedMode(null), "offline");
});

test("legacy's older isOnline boolean is still read", () => {
  /* The old app writes `mode`, but documents predating it carry only the
     boolean, and `useDutyStatus` falls back to it. Both apps must agree about
     one document or the same person is online in one and offline in the other. */
  assert.equal(storedMode({ isOnline: true }), "online");
  assert.equal(storedMode({ isOnline: false }), "offline");
  /* `mode` wins where both exist. */
  assert.equal(storedMode({ mode: "break", isOnline: true }), "break");
});

test("an unrecognised mode withholds rather than grants", () => {
  /* A fifth mode means the old app grew one we have not ported. Reading it as
     offline withholds task actions; reading it as online would grant them on a
     guess about a state we do not know the rules for. */
  assert.equal(storedMode({ mode: "lunch" }), "offline");
  assert.equal(storedMode({ mode: "" }), "offline");
});

/* ── Staleness — the closed-browser case ──────────────────────────────────── */

test("a heartbeat older than the window stops being believed", () => {
  const doc: DutyDocument = { mode: "online", heartbeatAt: T0 };
  assert.equal(readDutyMode(doc, T0 + 1_000), "online");
  assert.equal(readDutyMode(doc, T0 + STALE_AFTER_MS), "online", "the edge is inclusive");
  assert.equal(readDutyMode(doc, T0 + STALE_AFTER_MS + 1), "offline");
});

test("the window survives a missed beat, so a throttled tab is not reported away", () => {
  /* This application is sometimes deliberately backgrounded, where timers are
     clamped. A window that only just cleared one interval would read an
     ordinary throttle as a disconnection. */
  assert.ok(
    STALE_AFTER_MS > HEARTBEAT_INTERVAL_MS * 2,
    "the staleness window must tolerate two missed beats",
  );
});

test("an online claim with no heartbeat at all is stale immediately", () => {
  /* The old app's manual toggle writes no heartbeat and never expires. That is
     how a manager ends up watching a green dot for somebody who went home on
     Friday. */
  assert.equal(readDutyMode({ mode: "online" }, T0), "offline");
  assert.equal(isStale({ mode: "online" }, T0), true);
});

test("a break and an emergency never expire", () => {
  /* They are claims about a PERSON, not about a connection. Somebody who shuts
     their laptop mid-break is still on a break — expiring it would resume their
     deadlines silently and credit them nothing. Legacy carries an unfinished
     one across sessions in `pendingBreakGapMs` for exactly this reason. */
  const old = T0 - STALE_AFTER_MS * 100;
  assert.equal(readDutyMode({ mode: "break", heartbeatAt: old }, T0), "break");
  assert.equal(readDutyMode({ mode: "emergency", heartbeatAt: null }, T0), "emergency");
  assert.equal(isStale({ mode: "break" }, T0), false);
});

/* ── Multi-tab ────────────────────────────────────────────────────────────── */

test("a tab without the claim cannot put its own user offline", () => {
  /* Two tabs, one sharing. The other has no room, so its view is "not sharing".
     If it wrote that, it would end a share that is still being watched. */
  const held: DutyDocument = {
    mode: "online",
    heartbeatAt: T0,
    presenceConnectionId: "tab-a",
  };
  assert.equal(ownsClaim(held, "tab-b", T0), false);
  assert.equal(ownsClaim(held, "tab-a", T0), true);
});

test("a stale claim belongs to nobody and any tab may clear it", () => {
  const abandoned: DutyDocument = {
    mode: "online",
    heartbeatAt: T0 - STALE_AFTER_MS - 1,
    presenceConnectionId: "dead-tab",
  };
  assert.equal(ownsClaim(abandoned, "tab-b", T0), true);
});

test("an ownerless online claim is ours to correct", () => {
  /* Written by the old app's toggle, which has no concept of a connection.
     Nothing else will ever clear it. */
  assert.equal(ownsClaim({ mode: "online", heartbeatAt: T0 }, "tab-a", T0), true);
});

test("a non-online document is always writable", () => {
  assert.equal(ownsClaim({ mode: "offline" }, "tab-a", T0), true);
  assert.equal(ownsClaim({ mode: "break" }, "tab-a", T0), true);
});

test("a tab with no connection id owns nothing", () => {
  assert.equal(ownsClaim({ mode: "online", heartbeatAt: T0 }, null, T0), false);
});

/* ── Transitions — legacy's arithmetic ────────────────────────────────────── */

test("going online stamps the claim; leaving clears it", () => {
  const on = dutyTransition({ previous: null, next: "online", nowMs: T0, connectionId: "tab-a" });
  assert.equal(on.patch.mode, "online");
  assert.equal(on.patch.isOnline, true);
  assert.equal(on.patch.heartbeatAt, T0);
  assert.equal(on.patch.presenceConnectionId, "tab-a");

  const off = dutyTransition({
    previous: { mode: "online", presenceConnectionId: "tab-a" },
    next: "offline", nowMs: T0, connectionId: "tab-a",
  });
  assert.equal(off.patch.isOnline, false);
  assert.equal(off.patch.heartbeatAt, null);
  assert.equal(
    off.patch.presenceConnectionId, null,
    "a stale id left behind would let a dead tab look like the owner",
  );
});

test("both spellings are written, so neither app reads a half-written document", () => {
  const t = dutyTransition({ previous: null, next: "break", nowMs: T0, connectionId: null });
  assert.equal(t.patch.mode, "break");
  assert.equal(t.patch.isOnline, false);
});

test("leaving emergency for online raises the span immediately", () => {
  /* `DutyStatusToggle.jsx:138` — the direct path. */
  const started = T0 - 600_000;
  const t = dutyTransition({
    previous: { mode: "emergency", emergencyStartedAtMs: started, emergencyReason: "power cut" },
    next: "online", nowMs: T0, connectionId: "tab-a",
  });
  assert.equal(t.emergencyToRaiseMs, 600_000);
  assert.equal(t.emergencyReason, "power cut");
  assert.equal(t.patch.emergencyStartedAtMs, null);
  assert.equal(t.patch.pendingEmergencyGapMs, undefined, "nothing is held — it was raised");
});

test("leaving emergency for anything else holds the span for next time", () => {
  /* `:142`. The span is the whole subject of the approval request and cannot be
     reconstructed once the start is cleared, so it is banked rather than lost. */
  const t = dutyTransition({
    previous: { mode: "emergency", emergencyStartedAtMs: T0 - 300_000, emergencyReason: "flood" },
    next: "offline", nowMs: T0, connectionId: null,
  });
  assert.equal(t.emergencyToRaiseMs, 0);
  assert.equal(t.patch.pendingEmergencyGapMs, 300_000);
  assert.equal(t.patch.pendingEmergencyReason, "flood");
  assert.equal(t.patch.emergencyStartedAtMs, null);
});

test("re-declaring an emergency keeps the original start", () => {
  /* `:334` in the presence store, and legacy's own behaviour: the episode under
     review is the whole of it, not the last press. */
  const original = T0 - 900_000;
  const t = dutyTransition({
    previous: { mode: "emergency", emergencyStartedAtMs: original },
    next: "emergency", nowMs: T0, connectionId: null, reason: "still out",
  });
  assert.equal(t.patch.emergencyStartedAtMs, original);
});

test("leaving a break for online credits it; otherwise it is banked", () => {
  /* `:154-167`. The cap is applied where the credit is applied, not here —
     the allowance is a property of the day it lands on. */
  const direct = dutyTransition({
    previous: { mode: "break", breakStartedAtMs: T0 - 120_000 },
    next: "online", nowMs: T0, connectionId: "tab-a",
  });
  assert.equal(direct.breakToCreditMs, 120_000);
  assert.equal(direct.patch.breakStartedAtMs, null);

  const banked = dutyTransition({
    previous: { mode: "break", breakStartedAtMs: T0 - 120_000 },
    next: "offline", nowMs: T0, connectionId: null,
  });
  assert.equal(banked.breakToCreditMs, 0);
  assert.equal(banked.patch.pendingBreakGapMs, 120_000);
});

test("entering a break stamps its start, which is what makes it measurable", () => {
  const t = dutyTransition({ previous: { mode: "online" }, next: "break", nowMs: T0, connectionId: "a" });
  assert.equal(t.patch.breakStartedAtMs, T0);
});

test("a missing start does not invent a span", () => {
  /* A document with `mode: "break"` and no `breakStartedAtMs` is damaged. The
     honest read is a zero-length break, not a break that began at the epoch —
     which would credit somebody fifty-five years of deadline relief. */
  const t = dutyTransition({
    previous: { mode: "break" }, next: "online", nowMs: T0, connectionId: "a",
  });
  assert.equal(t.breakToCreditMs, 0);
});

test("a heartbeat restates the claim and changes nothing else", () => {
  const p = heartbeatPatch(T0, "tab-a");
  assert.deepEqual(p, { heartbeatAt: T0, presenceConnectionId: "tab-a" });
  assert.equal("mode" in p, false, "a heartbeat must never move the mode");
});

/* ── Hours today ──────────────────────────────────────────────────────────── */

test("online seconds come from the engine's own accumulator", () => {
  /* `dailyHours` is written in HOURS as a float, keyed by a UTC day —
     `DutyStatusToggle.jsx:114` is explicit that this is the convention, and it
     differs from the IST key the same file uses for deadline shifts. */
  const key = new Date(T0).toISOString().slice(0, 10);
  assert.equal(dailyHoursSecs({ dailyHours: { [key]: 2.5 } }, T0), 9000);
});

test("no entry for today is zero, not a guess", () => {
  /* Cumulative field: no entry genuinely means no session has closed today. */
  assert.equal(dailyHoursSecs({ dailyHours: {} }, T0), 0);
  assert.equal(dailyHoursSecs({}, T0), 0);
  assert.equal(dailyHoursSecs(null, T0), 0);
});

test("a nonsense hours value is ignored rather than rendered", () => {
  assert.equal(dailyHoursSecs({ dailyHours: { [dutyDayKey(T0)]: -3 } }, T0), 0);
  assert.equal(dailyHoursSecs({ dailyHours: { [dutyDayKey(T0)]: "2" } }, T0), 0);
  assert.equal(dailyHoursSecs({ dailyHours: [] }, T0), 0);
});

test("yesterday's hours are not reported as today's", () => {
  const yesterday = dutyDayKey(T0 - 86_400_000);
  assert.equal(dailyHoursSecs({ dailyHours: { [yesterday]: 8 } }, T0), 0);
});

/* ── Queue anchor: freeze the projection while online ─────────────────────── */

test("an online person freezes the projection at their session start", () => {
  /* Came online an hour ago; the anchor is that moment, not now, so the
     projected finish does not creep with the clock while they sit available. */
  const onlineSince = T0 - 3_600_000;
  const doc: DutyDocument & { updatedAt: number } = {
    mode: "online",
    heartbeatAt: T0 - 10_000,
    updatedAt: onlineSince,
  };
  assert.equal(queueAnchorMs(doc, T0), onlineSince);
});

test("an offline person anchors at now, because their work genuinely slips", () => {
  const doc: DutyDocument & { updatedAt: number } = {
    mode: "offline",
    updatedAt: T0 - 3_600_000,
  };
  assert.equal(queueAnchorMs(doc, T0), T0);
  assert.equal(queueAnchorMs(null, T0), T0);
});

test("a break or emergency anchors at now — only online is frozen", () => {
  for (const mode of ["break", "emergency"] as const) {
    const doc: DutyDocument & { updatedAt: number } = {
      mode,
      updatedAt: T0 - 3_600_000,
    };
    assert.equal(queueAnchorMs(doc, T0), T0, `${mode} should not freeze`);
  }
});

test("a stale online claim is not frozen at whenever they were last here", () => {
  /* `readDutyMode` resolves a stale online claim to offline, so the anchor is
     now — freezing at a session start from before they vanished would hold the
     projection at a time that is no longer true. */
  const doc: DutyDocument & { updatedAt: number } = {
    mode: "online",
    heartbeatAt: T0 - (STALE_AFTER_MS + 60_000),
    updatedAt: T0 - 7_200_000,
  };
  assert.equal(queueAnchorMs(doc, T0), T0);
});

test("an untrustworthy session start falls back to now, never past the clock", () => {
  const base = { mode: "online", heartbeatAt: T0 - 10_000 } as const;
  /* A future value (clock skew), a missing field, and a Firestore Timestamp on a
     pre-migration doc are each not a usable millisecond session start. */
  assert.equal(queueAnchorMs({ ...base, updatedAt: T0 + 60_000 }, T0), T0);
  assert.equal(queueAnchorMs({ ...base }, T0), T0);
  assert.equal(
    queueAnchorMs(
      { ...base, updatedAt: { seconds: 1 } } as unknown as DutyDocument,
      T0,
    ),
    T0,
  );
});
