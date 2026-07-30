import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearManual,
  declareEmergency,
  derive,
  getSnapshot,
  goOffline,
  goOnline,
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

/* ── A screen picker that never touches a browser ──────────────────────────
   `getDisplayMedia` is stood in for so the ordering rule can be tested at all:
   what matters is not the media, it is that a cancelled prompt never reaches
   the token endpoint. `navigator` is a configurable global in Node, so the
   picker can be swapped per test and put back. */

type Picker = () => Promise<MediaStream>;

function withPicker<T>(picker: Picker | null, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: picker ? { mediaDevices: { getDisplayMedia: picker } } : {},
    configurable: true,
  });
  try {
    return run();
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
  }
}

/** `displaySurface` is what the entire-screen rule is decided on. */
function fakeTrack(displaySurface = "monitor"): MediaStreamTrack {
  return {
    readyState: "live",
    stop() {},
    getSettings: () => ({ displaySurface }),
  } as unknown as MediaStreamTrack;
}

/** Safari and older Firefox: a live track that will not say what it is. */
function unnamedSurfaceTrack(): MediaStreamTrack {
  return {
    readyState: "live",
    stop() {},
    getSettings: () => ({}),
  } as unknown as MediaStreamTrack;
}

function grants(track: MediaStreamTrack): Picker {
  return async () =>
    ({
      getVideoTracks: () => [track],
      getTracks: () => [track],
    }) as unknown as MediaStream;
}

function cancels(): Picker {
  return async () => {
    const e = new Error("Permission denied");
    e.name = "NotAllowedError";
    throw e;
  };
}

const CREDENTIALS = { token: "test-token", url: "wss://example.invalid" };

test("derive: the priority order is emergency, break, then the track", () => {
  assert.equal(derive("emergency", LIVE), "emergency");
  assert.equal(derive("emergency", IDLE), "emergency");
  assert.equal(derive("break", LIVE), "break");
  assert.equal(derive(null, LIVE), "online");
  assert.equal(derive(null, IDLE), "offline");
  assert.equal(derive(null, GONE), "offline");
});

test("a window share is refused before any token is minted", async () => {
  fresh();
  const track = fakeTrack("window");
  let stopped = false;
  track.stop = () => {
    stopped = true;
  };
  let asked = 0;
  const started = await withPicker(grants(track), () =>
    goOnline(async () => {
      asked += 1;
      return CREDENTIALS;
    }),
  );
  assert.equal(started, false);
  assert.equal(asked, 0, "the wrong surface never reaches the token endpoint");
  assert.equal(stopped, true, "the rejected capture is released immediately");
  assert.equal(getSnapshot().status, "offline");
  assert.equal(getSnapshot().share.surface, "window");
  assert.match(getSnapshot().notice ?? "", /entire screen/i);
});

test("a browser tab share is refused the same way", async () => {
  fresh();
  const started = await withPicker(grants(fakeTrack("browser")), () =>
    goOnline(async () => CREDENTIALS),
  );
  assert.equal(started, false);
  assert.equal(getSnapshot().share.surface, "browser_tab");
  assert.equal(getSnapshot().status, "offline");
});

test("a browser that will not name the surface is refused, not trusted", async () => {
  fresh();
  const started = await withPicker(grants(unnamedSurfaceTrack()), () =>
    goOnline(async () => CREDENTIALS),
  );
  assert.equal(started, false);
  assert.equal(getSnapshot().share.surface, "unknown");
  assert.equal(getSnapshot().status, "offline");
});

test("a window share reported by the room never reads as online", () => {
  fresh();
  reportShare(WINDOW_ONLY);
  assert.equal(getSnapshot().status, "offline");
  assert.equal(derive(null, WINDOW_ONLY), "offline");
});

test("cancelling the screen picker costs no token and stays offline", async () => {
  fresh();
  let asked = 0;
  const started = await withPicker(cancels(), () =>
    goOnline(async () => {
      asked += 1;
      return CREDENTIALS;
    }),
  );
  assert.equal(started, false);
  assert.equal(asked, 0, "no token is minted for a share that never happened");
  assert.equal(getSnapshot().status, "offline");
  assert.equal(getSnapshot().token, null);
  assert.equal(getSnapshot().session, "idle");
  assert.match(getSnapshot().notice ?? "", /cancelled/i);
});

test("granting a screen holds the track and fetches credentials", async () => {
  fresh();
  const track = fakeTrack();
  const started = await withPicker(grants(track), () =>
    goOnline(async () => CREDENTIALS),
  );
  assert.equal(started, true);
  assert.equal(
    takePendingTrack(),
    track,
    "the publisher gets the captured track",
  );
  assert.equal(getSnapshot().token, CREDENTIALS.token);
  assert.equal(getSnapshot().session, "connecting");
  assert.equal(
    getSnapshot().status,
    "offline",
    "connecting is not online — only the track can say that",
  );
});

test("a token failure releases the capture and stays offline", async () => {
  fresh();
  const track = fakeTrack();
  let stopped = false;
  track.stop = () => {
    stopped = true;
  };
  const started = await withPicker(grants(track), () =>
    goOnline(async () => {
      throw new Error("500");
    }),
  );
  assert.equal(started, false);
  assert.equal(
    stopped,
    true,
    "the screen stops sharing if the room is unreachable",
  );
  assert.equal(takePendingTrack(), null);
  assert.equal(getSnapshot().token, null);
  assert.equal(getSnapshot().status, "offline");
});

test("Online is a consequence of the track, never of the request", async () => {
  fresh();
  reportShare(LIVE);
  assert.equal(getSnapshot().status, "online");
  /* Already sharing: "go online" is a no-op that never has to fetch fresh
     credentials — so it completes even when the token endpoint would throw,
     because the online-ness comes from the live track, not the request. (A break
     no longer keeps the track, so it is not the vehicle for this case anymore.) */
  const started = await withPicker(null, () =>
    goOnline(async () => {
      throw new Error("should never be reached");
    }),
  );
  assert.equal(started, true);
  assert.equal(getSnapshot().status, "online");
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
