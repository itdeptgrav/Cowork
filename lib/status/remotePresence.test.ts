import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import {
  applyRemotePresence,
  derive,
  getSnapshot,
  reportShare,
  resetStatus,
} from "./employeeStatus.ts";

const SHARING = {
  sharing: true,
  connected: true,
  surface: "entire_screen" as const,
  detail: "Sharing your entire screen.",
};

beforeEach(() => resetStatus());

const remote = (over: Partial<Parameters<typeof applyRemotePresence>[0]> = {}) =>
  applyRemotePresence({
    mode: "offline",
    breakStartedAtMs: null,
    emergencyStartedAtMs: null,
    onlineElsewhere: false,
    ...over,
  });

test("a device that is not sharing still shows Online when the account is", () => {
  /* **The reported fault.** A laptop shares its screen; the phone in the same
     person's pocket said Offline for the same account. Presence describes a
     person, and a person is not four different people because they have four
     devices open. */
  remote({ mode: "online", onlineElsewhere: true });
  assert.equal(getSnapshot().status, "online");
  assert.equal(getSnapshot().remoteOnline, true);
});

test("the break clock comes from the ACCOUNT, not from this device", () => {
  /* Two devices showed 13 seconds and 4 seconds for one break, because each
     began counting when it found out. One origin is what makes them agree. */
  const started = Date.now() - 60_000;
  remote({ mode: "break", breakStartedAtMs: started });
  assert.equal(getSnapshot().breakStartedAt, started);
  assert.equal(getSnapshot().status, "break");
});

test("the emergency clock comes from the account too", () => {
  const started = Date.now() - 300_000;
  remote({ mode: "emergency", emergencyStartedAtMs: started });
  assert.equal(getSnapshot().emergencyStartedAt, started);
  assert.equal(getSnapshot().status, "emergency");
});

test("presence is unknown until the account has been heard from", () => {
  /* The Offline-then-Break flash: the store's initial `offline` is a guess, and
     the pill was reading it out loud. */
  assert.equal(getSnapshot().hydrated, false);
  remote({ mode: "break", breakStartedAtMs: Date.now() });
  assert.equal(getSnapshot().hydrated, true);
});

test("the device holding the claim does not also mark itself remote", () => {
  /* Its own share already says it is online. A second, redundant reason would
     outlive the share if the document were slow to catch up. */
  reportShare(SHARING);
  remote({ mode: "online", onlineElsewhere: false });
  assert.equal(getSnapshot().remoteOnline, false);
  assert.equal(getSnapshot().status, "online");
});

test("a live share still wins when the account says offline", () => {
  /* This device can see its own track. The document is behind, and the next
     publish corrects it — this must not stop the share. */
  reportShare(SHARING);
  remote({ mode: "offline" });
  assert.equal(getSnapshot().status, "online");
});

test("the account leaving a break clears it everywhere", () => {
  remote({ mode: "break", breakStartedAtMs: Date.now() - 1_000 });
  assert.equal(getSnapshot().status, "break");
  remote({ mode: "offline" });
  assert.equal(getSnapshot().manual, null);
  assert.equal(getSnapshot().breakStartedAt, null);
  assert.equal(getSnapshot().status, "offline");
});

test("a break started here survives a snapshot that has not caught up", () => {
  /* The window between starting a break and the write landing. Falling back to
     `Date.now()` there would restart the clock the person is watching. */
  const started = Date.now() - 5_000;
  remote({ mode: "break", breakStartedAtMs: started });
  remote({ mode: "break", breakStartedAtMs: null });
  assert.equal(getSnapshot().breakStartedAt, started);
});

test("a manual state outranks the account being online elsewhere", () => {
  remote({ mode: "break", breakStartedAtMs: Date.now() });
  assert.equal(getSnapshot().status, "break");
});

test("derive is unchanged for every existing caller", () => {
  /* The new argument is defaulted, so nothing that predates it moved. */
  const idle = { sharing: false, connected: false, surface: null, detail: "" };
  assert.equal(derive(null, idle), "offline");
  assert.equal(derive(null, SHARING), "online");
  assert.equal(derive("break", SHARING), "break");
  assert.equal(derive("emergency", SHARING), "emergency");
});
