import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The in-call features a meeting is expected to have, and the one place they
 * have to live.
 *
 * ## Why these assert WHERE a feature lives, not that it exists
 *
 * There are three rooms — scheduled, task and guest — and they have drifted
 * before. Pinning, the per-tile menu, profile pictures and the reconnect fix
 * all landed in the scheduled room and left the task room drawing a bare grid,
 * which is why `RoomInterior` exists at all. Live captions are still only in
 * the scheduled room today for exactly that reason.
 *
 * So these do not assert "chat exists". They assert it is mounted in the shared
 * place, because a feature added to one room is a feature two thirds of the
 * product does not have.
 *
 * The shared place is now two files, and the split is deliberate:
 *
 *  · `RoomInterior` — the whole inside of a workspace room, mounted by the
 *    scheduled and task rooms.
 *  · `RoomExtras` — the pieces that are the same in EVERY room, exported
 *    individually so each room places them in its own layout. The guest room
 *    keeps its own stage (no tile menu, no employee directory) and mounts these.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    /* CRLF first — every file here is CRLF and the searches below are written
       with "\n". See `cowork-source-text-tests-hazard`. */
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const INTERIOR = code("components/features/meetings/RoomInterior.tsx");
const TILE = code("components/features/meetings/TileContent.tsx");
const SIGNALS = code("components/features/meetings/RoomSignals.tsx");
const BAR = code("components/features/meetings/MeetingControlBar.tsx");
const ROSTER = code("components/features/meetings/ParticipantRoster.tsx");
const CHAT = code("components/features/meetings/MeetingChat.tsx");
const EXTRAS = code("components/features/meetings/RoomExtras.tsx");

/* Checked first: if a room stops mounting the shared parts, every assertion
   below still passes while that room quietly loses all of it. */
test("the two workspace rooms share one interior", () => {
  for (const path of [
    "components/features/meetings/MeetingRoom.tsx",
    "components/features/meetings/TaskRoom.tsx",
  ]) {
    assert.match(
      code(path),
      /<RoomInterior/,
      `${path} builds its own room interior again, so it will drift`,
    );
  }
});

test("the guest room gets the same in-call features, on its own stage", () => {
  /**
   * The guest room is a second implementation ON PURPOSE, in part: a guest has
   * no tile menu and never reads the employee directory, so `GuestStage` and
   * its bare `ParticipantTile` stay its own. What is NOT guest-specific is
   * chat, a raised hand, a reaction, a reconnection notice and knowing who else
   * is here — and a guest is usually the person in the meeting with the least
   * context to begin with.
   *
   * So this asserts the shared BEHAVIOUR reaches them, not that the layouts
   * were merged.
   */
  const guest = code("components/features/meetings/GuestMeetingArea.tsx");
  assert.match(guest, /<RoomSignalsProvider>/);
  assert.match(guest, /<RoomOverlays \/>/);
  assert.match(guest, /<RoomSidePanel/);
  assert.match(guest, /<MeetingControlBar/);
  assert.match(
    guest,
    /withDirectory=\{false\}/,
    "the guest roster now reads the employee directory, which a guest may not do",
  );
});

test("chat is in the shared interior, not one room", () => {
  assert.match(EXTRAS, /<MeetingChat/);
  assert.match(INTERIOR, /<RoomSidePanel/);
  assert.match(CHAT, /useChat\(\)/, "chat no longer rides the room's data channel");
  /* The unread count must be tracked while the panel is CLOSED, which is when
     the component that renders messages does not exist. */
  assert.match(EXTRAS, /useChatUnread\(/);
});

test("the participant roster is in the shared interior", () => {
  assert.match(EXTRAS, /<DirectoryRoster/);
  assert.match(EXTRAS, /<ParticipantRoster/);
  assert.match(ROSTER, /useParticipants\(\)/);
  assert.match(ROSTER, /roster-search/, "the roster is no longer searchable");
});

test("raise hand and reactions ride one channel, and are provided to the room", () => {
  assert.match(INTERIOR, /<RoomSignalsProvider>/);
  assert.match(EXTRAS, /<ReactionOverlay/);
  assert.match(INTERIOR, /<RoomOverlays/);
  assert.match(BAR, /toggleHand/);
  assert.match(BAR, /sendReaction\(/);
  assert.match(SIGNALS, /useDataChannel\(TOPIC/);
});

test("a late joiner learns which hands are already up", () => {
  /* Data messages reach whoever is in the room at the time, so without this a
     hand raised before somebody arrived is invisible to them for the rest of
     the meeting. */
  assert.match(SIGNALS, /kind: "sync"/);
  assert.match(
    SIGNALS,
    /if \(handsRef\.current\.has\(meRef\.current\)\)/,
    "raised hands no longer answer a new arrival's sync",
  );
});

test("a hand does not outlive the person who raised it", () => {
  /* Nobody can lower another person's hand, so a participant who left with one
     up stayed raised in every roster for the rest of the meeting. */
  assert.match(SIGNALS, /const present = new Set\(\[me, \.\.\.remotes/);
});

test("your own reaction is shown to you", () => {
  /* LiveKit does not echo a participant's own data messages back, so without a
     local echo the sender is the one person who cannot see what they sent. */
  const send = SIGNALS.slice(SIGNALS.indexOf("const sendReaction"));
  assert.match(
    send.slice(0, send.indexOf("publish(send")),
    /setReactions\(/,
    "a reaction is broadcast without being shown locally",
  );
});

test("a raised hand is visible without opening a panel", () => {
  /* The entire purpose of raising one is being noticed. */
  assert.match(TILE, /signals\?\.hands\.has\(participant\.identity\)/);
});

test("connection quality is back on the tile", () => {
  /* Supplying children to `ParticipantTile` REPLACES the default content, so
     taking the tile over to draw a photograph silently dropped this — and a bad
     line then looks identical to somebody mumbling. */
  assert.match(TILE, /<ConnectionQualityIndicator participant=\{participant\} \/>/);
});

test("a reconnect says so", () => {
  assert.match(EXTRAS, /<ConnectionBanner/);
  const banner = code("components/features/meetings/ConnectionBanner.tsx");
  assert.match(banner, /ConnectionState\.Reconnecting/);
  assert.match(
    banner,
    /aria-live="assertive"/,
    "losing the meeting is announced only to people who can see the tiles freeze",
  );
});

test("the mute and camera shortcuts do not fire while typing", () => {
  /* A global key handler in a room containing a chat box is a way to make
     typing unpredictable. */
  const keys = code("components/features/meetings/RoomShortcuts.tsx");
  assert.match(keys, /tag === "INPUT"/);
  assert.match(keys, /tag === "TEXTAREA"/);
  assert.match(keys, /el\.isContentEditable/);
  assert.match(keys, /key === "d"/);
  assert.match(keys, /key === "e"/);
});

test("speaker selection is offered only where it can work", () => {
  /* Safari has no `setSinkId`; a menu there changes a dropdown and nothing
     else, which is worse than not offering one. */
  assert.match(INTERIOR, /"setSinkId" in HTMLMediaElement\.prototype/);
  assert.match(BAR, /kind="audiooutput"/);
});

test("the toggles are still LiveKit's, only their appearance is ours", () => {
  /**
   * **What changed, and what must not.**
   *
   * This used to assert `<ControlBar` — LiveKit's own bar, mounted whole. It
   * was replaced by `MeetingControlBar` so the room has ONE row of circular
   * buttons instead of two rows in two visual languages.
   *
   * The thing that mattered about mounting `ControlBar` survives: the
   * microphone, the camera and the screen share are still driven by LiveKit's
   * `TrackToggle` / `useTrackToggle`, and the device lists by
   * `MediaDeviceMenu`. `showIcon={false}` is what asks for the behaviour
   * without the appearance.
   *
   * A hand-rolled `setMicrophoneEnabled` here would be a second implementation
   * of muting, and the button and the track would disagree the first time
   * either changed. That is the regression this now guards.
   */
  assert.match(INTERIOR, /<MeetingControlBar/);
  assert.match(BAR, /<TrackToggle/);
  assert.match(BAR, /showIcon=\{false\}/);
  assert.match(BAR, /useTrackToggle\(\{ source: Track\.Source\.Microphone \}\)/);
  assert.match(BAR, /<MediaDeviceMenu kind="audioinput"/);
  assert.match(BAR, /<DisconnectButton/, "Leave is no longer LiveKit's disconnect");
  assert.doesNotMatch(
    BAR,
    /setMicrophoneEnabled|setCameraEnabled/,
    "the bar has grown its own microphone control instead of using the toggle",
  );
});
