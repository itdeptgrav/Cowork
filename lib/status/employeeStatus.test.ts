import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearManual,
  declareEmergency,
  derive,
  getSnapshot,
  applyRemotePresence,
  goOffline,
  startScreenShare,
  reportShare,
  resetStatus,
  startBreak,
  takePendingTrack,
  type ShareFacts,
} from "./employeeStatus.ts";

/**
 * The presence rules, locked.
 *
 * These are the parts that cannot be checked by clicking: that Online is a
 * consequence rather than a choice, that a manual state survives losing the
 * track, and that leaving the room ends everything. Run with `npm test`.
 */

const LIVE: ShareFacts = {
  sharing: true,
  connected: true,
  surface: "entire_screen",
  detail: "Sharing your entire screen.",
};
const IDLE: ShareFacts = {
  sharing: false,
  connected: true,
  surface: null,
  detail: "No screen share is running.",
};
/**
 * A share that exists but is the wrong surface.
 *
 * `sharing` is false because `isLiveScreenShare` — the one predicate that
 * decides it — requires an entire screen. This fixture encodes that a window
 * share is a *present* share that still does not make anyone online.
 */
const WINDOW_ONLY: ShareFacts = {
  sharing: false,
  connected: true,
  surface: "window",
  detail: "Application window sharing is not accepted.",
};
const GONE: ShareFacts = {
  sharing: false,
  connected: false,
  surface: null,
  detail: "Not connected to a room.",
};

function fresh() {
  resetStatus();
  clearManual();
}

/* ── A seat, without a network ─────────────────────────────────────────────
   `startScreenShare` no longer opens a picker: Grav Stream's embed owns the
   capture prompt, and what this function does is fetch the seat that page is
   loaded with. So what is worth testing is what it does with a seat it got, and
   with one it did not. */

/* The seat as the route answers it. `url` is the REALTIME SERVER — the field
   the publisher SDK connects to — and it is deliberately nothing like the embed
   page a watcher loads, because holding the wrong one of the two is a share
   that starts and stops a second later. */
const SEAT = {
  token: "test-token",
  url: "wss://stream.grav.in",
};

test("derive: the priority order is emergency, break, then the track", () => {
  assert.equal(derive("emergency", LIVE), "emergency");
  assert.equal(derive("emergency", IDLE), "emergency");
  assert.equal(derive("break", LIVE), "break");
  assert.equal(derive(null, LIVE), "online");
  assert.equal(derive(null, IDLE), "offline");
  assert.equal(derive(null, GONE), "offline");
});

test("Online is a consequence of the share, never of the request", async () => {
  fresh();
  reportShare(LIVE);
  assert.equal(getSnapshot().status, "online");
  /* Already sharing: "go online" is a no-op that never has to fetch a fresh
     seat — so it completes even when the route would throw, because the
     online-ness comes from the room, not from the request. */
  const started = await startScreenShare(async () => {
    throw new Error("should never be reached");
  });
  assert.equal(started, true);
  assert.equal(getSnapshot().status, "online");
});

test("a seat is held for the room, and holding one is not being online", async () => {
  fresh();
  const started = await startScreenShare(async () => SEAT);
  assert.equal(started, true);
  assert.equal(getSnapshot().token, SEAT.token);
  assert.equal(
    getSnapshot().url,
    SEAT.url,
    "the SDK would be pointed at an HTML page instead of the media server",
  );
  assert.equal(
    getSnapshot().status,
    "offline",
    "a seat is not a share — only the room's own answer says online",
  );
});

test("a refused seat says why, and holds nothing", async () => {
  /* The route's own sentence: not their manager, no reporting line, not
     configured. A status code would tell the reader nothing to act on. */
  fresh();
  const started = await startScreenShare(async () => {
    throw new Error("Only their primary manager can watch this screen.");
  });
  assert.equal(started, false);
  assert.equal(getSnapshot().token, null);
  assert.equal(getSnapshot().url, null);
  assert.equal(getSnapshot().session, "error");
  assert.match(getSnapshot().notice ?? "", /primary manager/);
});

test("a live share alone makes someone online — no click required", () => {
  fresh();
  reportShare(LIVE);
  assert.equal(getSnapshot().status, "online");
});

test("losing the share drops to offline on its own", () => {
  fresh();
  reportShare(LIVE);
  assert.equal(getSnapshot().status, "online");
  reportShare(IDLE);
  assert.equal(getSnapshot().status, "offline");
});

test("a disconnect drops to offline", () => {
  fresh();
  reportShare(LIVE);
  reportShare(GONE);
  assert.equal(getSnapshot().status, "offline");
});

test("break STOPS the screen share", () => {
  /* Changed by owner decision: an unavailable person is not being watched, so
     break — like emergency and offline — tears down the recording. It was
     previously "presence suppressed, media untouched". */
  fresh();
  reportShare(LIVE);
  startBreak();
  assert.equal(getSnapshot().status, "break");
  assert.ok(getSnapshot().breakStartedAt !== null, "the stopwatch starts");
  assert.equal(getSnapshot().share.sharing, false, "the recording is stopped");
  assert.equal(getSnapshot().token, null, "the room credentials are released");
});

test("ending a break leaves you offline — the share was stopped", () => {
  /* Previously a break kept the track, so ending one returned straight to
     online. Now the break stopped the recording, so there is nothing to fall
     back to and coming back means sharing again. */
  fresh();
  reportShare(LIVE);
  startBreak();
  clearManual();
  assert.equal(
    getSnapshot().status,
    "offline",
    "coming back requires sharing again",
  );
});

test("emergency STOPS the screen share", () => {
  /* Same owner decision as break: not a moment to keep broadcasting a screen. */
  fresh();
  reportShare(LIVE);
  declareEmergency();
  assert.equal(getSnapshot().status, "emergency");
  assert.equal(getSnapshot().share.sharing, false, "the recording is stopped");
  assert.equal(getSnapshot().token, null, "the room credentials are released");
});

test("a manual state survives a lost track but not leaving the room", () => {
  fresh();
  reportShare(LIVE);
  startBreak();
  reportShare(GONE);
  assert.equal(getSnapshot().status, "break");

  resetStatus();
  assert.equal(getSnapshot().status, "offline");
  assert.equal(getSnapshot().manual, null);
  assert.equal(getSnapshot().breakStartedAt, null);
});

test("going offline ends the session and drops the credentials", () => {
  fresh();
  reportShare(LIVE);
  startBreak();
  goOffline();
  const s = getSnapshot();
  assert.equal(s.status, "offline");
  assert.equal(s.manual, null, "leaving clears a break");
  assert.equal(s.token, null, "dropping the token unmounts the room");
  assert.equal(s.url, null);
  assert.equal(s.session, "idle");
  assert.equal(s.share.sharing, false);
  assert.equal(takePendingTrack(), null);
});

/* ── Online is a live share — OWNER DECISION, restored ────────────────────── */

/**
 * For a period, pressing Online set the status directly: no picker, nothing
 * verified, presence self-declared. It is a live whole-screen track again, and
 * these hold the two halves that are easy to lose — the store offering a way to
 * declare it, and a device that is NOT the one sharing failing to report what
 * its own account plainly says.
 */

test("the store offers no way to declare yourself online", () => {
  const src = readFileSync("lib/status/employeeStatus.ts", "utf8");
  assert.ok(
    !/export function goOnline/.test(src),
    "a function that asserts online is back — the picker is bypassable again",
  );
  const at = src.indexOf("export function derive");
  const body = src.slice(at, src.indexOf("\nconst INITIAL", at));
  assert.ok(
    !/manual === "online"/.test(body),
    "derive reads a manual online again",
  );
  assert.match(
    body,
    /if \(share\.sharing && share\.connected\) return "online";/,
    "the track no longer decides",
  );
});

test("the account's word makes a NON-sharing device report online", () => {
  /* The reload case, and the one that produced "it goes offline by itself":
     after a refresh this device has no track of its own, the laptop across the
     room is still sharing, and the account says online. It reports online —
     whether or not the claim happens to be stamped with this tab's id. */
  fresh();
  for (const elsewhere of [true, false]) {
    applyRemotePresence({
      mode: "online",
      breakStartedAtMs: null,
      emergencyStartedAtMs: null,
      onlineElsewhere: elsewhere,
    });
    assert.equal(getSnapshot().status, "online", `onlineElsewhere: ${elsewhere}`);
    assert.equal(getSnapshot().remoteOnline, true);
    assert.equal(getSnapshot().manual, null, "online became a manual state again");
  }
});

test("the device that IS sharing does not also mark itself remote", () => {
  /* Its own track says online. A second reason for the same truth would outlive
     the share if the document were slow to catch up. */
  fresh();
  reportShare(LIVE);
  applyRemotePresence({
    mode: "online",
    breakStartedAtMs: null,
    emergencyStartedAtMs: null,
    onlineElsewhere: false,
  });
  assert.equal(getSnapshot().status, "online");
  assert.equal(getSnapshot().remoteOnline, false);
});

test("a live share hydrates this device, even if the account never answers", () => {
  /* `hydrated` gates the publish so nothing announces the initial `offline`
     guess. A track that is flowing is not a guess. */
  /* `resetStatus` rather than `fresh()`: ending a break is itself a person
     acting in front of us, so `clearManual` settles the same question. */
  resetStatus();
  assert.equal(getSnapshot().hydrated, false);
  reportShare(LIVE);
  assert.equal(getSnapshot().hydrated, true);
});

test("the account going offline takes a device that is not sharing with it", () => {
  fresh();
  applyRemotePresence({
    mode: "online",
    breakStartedAtMs: null,
    emergencyStartedAtMs: null,
    onlineElsewhere: true,
  });
  assert.equal(getSnapshot().status, "online");
  applyRemotePresence({
    mode: "offline",
    breakStartedAtMs: null,
    emergencyStartedAtMs: null,
    onlineElsewhere: false,
  });
  assert.equal(getSnapshot().status, "offline");
});

test("a break declared elsewhere still outranks the account being online", () => {
  fresh();
  applyRemotePresence({
    mode: "break",
    breakStartedAtMs: Date.now(),
    emergencyStartedAtMs: null,
    onlineElsewhere: false,
  });
  assert.equal(getSnapshot().status, "break");
});
