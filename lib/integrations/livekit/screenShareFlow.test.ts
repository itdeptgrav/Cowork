import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  MANAGER_IDENTITY,
  ROOM_NAME,
  isPresenceIdentity,
  isWatcherIdentity,
  presenceIdentityFor,
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
 * These tests pin the two halves that have to agree — who publishes under what
 * name, and who the viewer looks for — plus the seat grants, because widening
 * who may watch must never widen what a watcher may do.
 */

const publisher = readFileSync(
  "components/features/status/ScreenSharePublisher.tsx",
  "utf8",
);
const share = readFileSync("lib/integrations/livekit/screenShare.ts", "utf8");
const viewer = readFileSync(
  "components/features/monitoring/LiveScreenViewer.tsx",
  "utf8",
);
const route = readFileSync("app/api/livekit/token/route.ts", "utf8");
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

test("the two seats still cannot do each other's job", () => {
  /* Widening WHO may take a watching seat must not widen what one can do. A
     watcher publishing would put a track in the room under a name of their
     choosing; a publisher subscribing would let an employee watch colleagues. */
  assert.match(route, /canPublish: isPublisher/);
  assert.match(route, /canSubscribe: isWatcher/);
  assert.match(route, /isWatcherIdentity\(identity\)/);
  assert.match(route, /room: ROOM_NAME/, "the room is still pinned server-side");
  assert.equal(ROOM_NAME.length > 0, true);
});

/* ── Source and rendering ─────────────────────────────────────────────────── */

test("the track is published on the source the viewer subscribes to", () => {
  /* Screen share is its own `Track.Source`, and the viewer's `useTracks` asks
     for exactly that one. A string literal here — which this file once had —
     type-errors the build AND silently fails the viewer's filter. */
  assert.match(share, /source: Track\.Source\.ScreenShare/);
  assert.match(viewer, /source: Track\.Source\.ScreenShare/);
});

test("the viewer subscribes to REMOTE tracks, not just its own", () => {
  /* `useTracks` returns every participant's tracks; the filter is by identity,
     not by locality. Filtering to the local participant would show a manager
     their own (never-published) screen and nobody else's. */
  assert.match(viewer, /useTracks\(/);
  assert.match(viewer, /t\.participant\.identity === props\.presenceIdentity/);
  assert.equal(
    viewer.includes("localParticipant"),
    false,
    "the viewer reads the local participant — it should match remote publishers",
  );
});

test("the viewer only renders a publication that actually exists", () => {
  /* `withPlaceholder: false` plus the `!!t.publication` narrowing. A
     placeholder entry has no track, and rendering one is a black frame that
     looks like a broken stream rather than an absent one. */
  assert.match(viewer, /withPlaceholder: false/);
  assert.match(viewer, /!!t\.publication/);
});

/* ── Start and stop ───────────────────────────────────────────────────────── */

test("the browser's own Stop sharing bar ends the session", () => {
  /* It ends the TRACK without unpublishing, so nothing else would notice. The
     `ended` listener is the only signal there is. */
  assert.match(publisher, /addEventListener\("ended"/);
  assert.match(publisher, /stopScreenShare/);
  assert.match(publisher, /goOffline\(\)/);
});

test("unmounting releases the capture", () => {
  /* Otherwise the browser keeps its "sharing your screen" indicator up after
     Cowork has stopped listening — the product appears to still be watching. */
  assert.match(publisher, /return \(\) => \{[\s\S]*?stopScreenShare/);
});

test("publishing happens once per captured track", () => {
  /* `takePendingTrack` hands the track over exactly once and the ref guards a
     re-run, so a re-render cannot publish the same capture twice. */
  assert.match(publisher, /publishedFor\.current === track/);
});
