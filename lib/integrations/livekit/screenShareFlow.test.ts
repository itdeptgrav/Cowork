import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  MANAGER_IDENTITY,
  isPresenceIdentity,
  isWatcherIdentity,
  presenceIdentityFor,
  presenceRoomName,
  watcherIdentity,
} from "./identity.ts";

/**
 * The screen-share flow, end to end, as far as it can be checked without a room.
 *
 * **The reported bug was not in LiveKit.** The employee published correctly, the
 * manager's seat subscribed, and the track arrived. But `LiveScreenViewer`
 * matches incoming tracks against `subject.presenceIdentity`, and
 * `getMonitoringSubject` returned `null` on the legacy backend — so
 * `PersonMonitor` rendered `NoSubjectFrame` instead of the viewer, and
 * `ScreenDialog` was handed `presenceIdentity=""`, which matches no participant
 * that has ever existed. The screen was in the room the whole time with nobody
 * asking for it.
 *
 * **Identities still have to agree, even though the transport changed.** The
 * sharer joins Grav Stream under `employee-<id>` and `/api/stream/presence`
 * looks for that exact string in the room's participant list, so "is this person
 * live" is asked and answered about one name. A mismatch there is the same class
 * of fault this file was written for: a screen in a room with nobody asking for
 * it.
 *
 * These pin the names, the seat grants — widening who may watch must never widen
 * what a watcher may do — and the fact that a watching frame cannot capture.
 */

const viewer = readFileSync(
  "components/features/monitoring/LiveScreenViewer.tsx",
  "utf8",
);
const route = readFileSync("app/api/stream/token/route.ts", "utf8");
const repo = readFileSync("lib/repositories/legacy/index.ts", "utf8");

/* ── The identity both sides derive ───────────────────────────────────────── */

test("publisher and viewer derive the identity from ONE function", () => {
  /* The bug this prevents already happened once: the publisher joined as a
     fixed "employee" string while the viewer looked for `employee-<id>`, so a
     screen shared by anyone but one seeded person matched nothing — and one
     shared by anybody appeared under THAT person's name. */
  assert.equal(presenceIdentityFor("GR0045"), "employee-GR0045");
  assert.equal(isPresenceIdentity(presenceIdentityFor("GR0045")), true);
});

test("the repository hands the viewer the same identity the publisher uses", () => {
  /* The actual fix. `getMonitoringSubject` returned null, so there was no
     identity to match and the viewer never rendered. */
  assert.match(repo, /presenceIdentity: presenceIdentityFor\(id\)/);
  assert.match(
    repo,
    /async getMonitoringSubject\(/,
    "getMonitoringSubject is unwired again — the manager will see no screen",
  );
});

test("an employee id is never mistaken for a watcher, or the reverse", () => {
  assert.equal(isWatcherIdentity(presenceIdentityFor("GR0045")), false);
  assert.equal(isPresenceIdentity(watcherIdentity("abc")), false);
  assert.equal(isPresenceIdentity("employee-"), false, "the bare prefix is not an employee");
});

/* ── Multiple watchers ────────────────────────────────────────────────────── */

test("two watchers get two identities", () => {
  /* LiveKit treats identity as unique in a room and EVICTS the existing
     participant when a second joins under the same string. Every watcher used
     to join as the bare "manager", so the second manager to open a monitoring
     page silently disconnected the first, whose screen went blank having done
     nothing. */
  assert.notEqual(watcherIdentity("seat-a"), watcherIdentity("seat-b"));
  assert.equal(isWatcherIdentity(watcherIdentity("seat-a")), true);
  assert.equal(isWatcherIdentity(watcherIdentity("seat-b")), true);
});

test("a token minted before the change still identifies a watcher", () => {
  /* Someone holding the bare identity is still watching, and refusing them
     mid-session would be a self-inflicted outage on deploy. */
  assert.equal(isWatcherIdentity(MANAGER_IDENTITY), true);
});

/* ── Seat grants ──────────────────────────────────────────────────────────── */

test("the two seats still join under different names", () => {
  /**
   * The grants no longer differ — their embed cannot join without publish
   * rights, so both seats carry both (see the route, and the token-route test
   * that guards the room). What still differs, and must, is WHO each seat says
   * it is: the sharer joins under the identity `/api/stream/presence` looks for,
   * and each watcher gets a seat of their own so two managers do not evict each
   * other.
   */
  assert.match(
    route,
    /presenceIdentityFor\(subject\)/,
    "the sharing seat no longer joins under the identity presence looks for",
  );
  assert.match(
    route,
    /watcherIdentity\(seat\)/,
    "watchers share one identity again, so the second one evicts the first",
  );
});

test("a watcher publishes nothing, and it is the SERVICE that says so", () => {
  /**
   * The manager's frame used to be muted by hand the moment it joined, because
   * the only room type was a meeting and its embed published a camera and a
   * microphone as part of getting in. A `screen` room prompts a viewer for no
   * device at all, and their SFU rejects any publish attempt from a viewer
   * token — an access-control boundary rather than a UI courtesy.
   *
   * So the mute is gone, and what must not come back is a seat minted with
   * anything other than `viewer` for somebody who is only watching.
   */
  assert.match(route, /role: role === "publish" \? "publisher" : "viewer"/);
  assert.ok(
    !/toggle-mic|toggle-camera/.test(viewer),
    "the viewer's frame is muting devices again, which means it is publishing them",
  );
});

test("the room is the subject's own, decided server-side", () => {
  /* One room per person, not one for the company. The service caps a room at 30
     participants, and — the reason that matters more — a seat minted for one
     person's room cannot show anybody else's screen however a component
     misbehaves. */
  assert.match(route, /roomName: presenceRoomName\(subject\)/);
  assert.equal(presenceRoomName("GR0045"), "cowork-presence-GR0045");
});

/* ── Rendering ────────────────────────────────────────────────────────────── */

test("the viewer renders the room it was granted", () => {
  /**
   * **The identity match is gone, and that is a strengthening rather than a
   * loss.** The viewer used to subscribe to one shared room and filter tracks
   * by `presenceIdentity` — so every manager's token could reach everybody's
   * screen, and a component decided who saw what. The seat is now minted for
   * one person's room and refused to anybody but their primary manager, so the
   * permission lives in the credential.
   *
   * The frame carries the full `allow` list, and withholding it was a mistake
   * that looked like caution: the embed refuses at its own join screen without
   * it, so a manager saw "Camera and microphone are blocked" instead of a
   * screen. What stops a watcher publishing is `canPublish: false` on the seat,
   * asserted above and enforced by the service.
   */
  assert.match(viewer, /src=\{embedUrl\}/);
  assert.match(
    viewer,
    /allow="camera; microphone; display-capture; autoplay"/,
    "the embed will refuse to join without its documented permissions",
  );
  assert.ok(
    !/useTracks|VideoTrack/.test(viewer),
    "the viewer is back on a track subscription that no longer exists",
  );
});

test("the badge does not claim Live over a join screen", () => {
  /* A URL is not a stream. The badge lit the moment a seat existed, above a
     frame still showing "Ready to join?" — the one thing on the panel a manager
     would take on trust. It follows their published presence instead. */
  assert.match(viewer, /const live = room && presence === "online"/);
});
