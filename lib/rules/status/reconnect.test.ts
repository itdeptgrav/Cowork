import assert from "node:assert/strict";
import { test } from "node:test";
import { RECONNECTING_DETAIL, shareFactsFor } from "./reconnect.ts";
import { derive } from "../../status/employeeStatus.ts";
import type { ShareFacts } from "../../status/employeeStatus.ts";

const SHARING: ShareFacts = {
  sharing: true,
  connected: true,
  surface: "entire_screen",
  detail: "Sharing your entire screen.",
};

const IDLE: ShareFacts = {
  sharing: false,
  connected: false,
  surface: null,
  detail: "Not sharing. Go online to start.",
};

const facts = (over: Parameters<typeof shareFactsFor>[0]) => shareFactsFor(over);

const base = {
  previous: SHARING,
  live: true,
  any: true,
  surface: "entire_screen" as const,
  wrongSurfaceDetail: "Window sharing is not accepted.",
};

test("a reconnect does NOT take somebody offline", () => {
  /* **The whole bug.** LiveKit enters `Reconnecting` for a wifi blip, a VPN hop
     or a laptop sleeping for a second. Deriving offline from it flipped people
     Offline and back with no interaction, and published both to the duty record
     every manager reads. */
  const next = facts({ ...base, phase: "reconnecting" });
  assert.equal(derive(null, next), "online");
});

test("a reconnect holds the last known facts and changes only the sentence", () => {
  const next = facts({ ...base, phase: "reconnecting" });
  assert.equal(next.sharing, SHARING.sharing);
  assert.equal(next.connected, SHARING.connected);
  assert.equal(next.surface, SHARING.surface);
  assert.equal(next.detail, RECONNECTING_DETAIL);
});

test("a reconnect while already offline stays offline", () => {
  /* Holding cuts both ways: it asserts nothing new, so it cannot invent
     presence for somebody who was not sharing. */
  const next = facts({ ...base, previous: IDLE, phase: "reconnecting", live: false, any: false });
  assert.equal(derive(null, next), "offline");
});

test("a real disconnection still reports offline", () => {
  /* The hold lasts exactly as long as the uncertainty. When LiveKit gives up it
     leaves `Reconnecting`, and the truth is reported. */
  const next = facts({ ...base, phase: "disconnected" });
  assert.equal(next.sharing, false);
  assert.equal(next.connected, false);
  assert.equal(derive(null, next), "offline");
});

test("connected and sharing the whole screen is online", () => {
  const next = facts({ ...base, phase: "connected" });
  assert.equal(next.sharing, true);
  assert.equal(next.connected, true);
  assert.equal(next.detail, "Sharing your entire screen.");
  assert.equal(derive(null, next), "online");
});

test("sharing a window is connected but not online, and says which", () => {
  const next = facts({
    ...base,
    phase: "connected",
    live: false,
    any: true,
    surface: "window",
  });
  assert.equal(next.sharing, false);
  assert.equal(next.connected, true);
  assert.equal(next.detail, "Window sharing is not accepted.");
  assert.equal(derive(null, next), "offline");
});

test("connected with nothing shared names that, rather than blaming the room", () => {
  const next = facts({
    ...base,
    phase: "connected",
    live: false,
    any: false,
    surface: null,
  });
  assert.equal(next.detail, "Connected, but nothing is being shared.");
});

test("a manual state still outranks a held reconnect", () => {
  /* Someone who started a break during a blip is on a break, not online. */
  const next = facts({ ...base, phase: "reconnecting" });
  assert.equal(derive("break", next), "break");
  assert.equal(derive("emergency", next), "emergency");
});

test("the surface is dropped when nothing at all is shared", () => {
  const next = facts({
    ...base,
    phase: "connected",
    live: false,
    any: false,
    surface: "entire_screen",
  });
  assert.equal(next.surface, null);
});
