import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Why switching to another tab stopped your voice reaching the meeting.
 *
 * `LiveKitRoom`'s `audio` and `video` props are not "how to join". They are a
 * controlled value, and the library re-applies them on every `SignalConnected`
 * — an event that fires on every RECONNECT, not only the first connect. From
 * `@livekit/components-react`'s own source:
 *
 *     const d = () => { u.setMicrophoneEnabled(!!p); u.setCameraEnabled(!!y); … }
 *     room.on(SignalConnected, d)
 *
 * Cowork passes `audio={false}` so people arrive muted, which is right. What
 * nobody saw is the rest of it: you unmute, you talk, the signal connection
 * drops and comes back — and LiveKit re-applies `false` and mutes you again,
 * silently. Backgrounding a tab is one of the commonest causes of that
 * reconnect, which is why it showed up as "my voice stops when I switch tabs".
 *
 * Omitting the props does not help. The library's defaults are
 * `{ connect: true, audio: false, video: false }`, so `!!undefined` mutes just
 * the same. The only fix is to make the props describe the CURRENT microphone.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ROOM = "components/features/meetings/MeetingRoom.tsx";
const GUEST = "components/features/meetings/GuestMeetingArea.tsx";
const SYNC = "components/features/meetings/DeviceIntentSync.tsx";
const LIVEKIT = "node_modules/@livekit/components-react/dist/room-BC_ml4G1.mjs";

test("the library really does re-apply the props on every signal connection", () => {
  /* The premise of this whole file, asserted against the installed library so
     an upgrade that changes the behaviour fails here rather than in a meeting.
     If this breaks, re-read the room component before assuming the fix is
     still needed — it may have become unnecessary, or it may have moved. */
  let src: string;
  try {
    src = readFileSync(LIVEKIT, "utf8");
  } catch {
    /* A different build hash after an upgrade. Not a failure on its own — the
       tests below still pin Cowork's side of the contract. */
    return;
  }
  assert.match(src, /setMicrophoneEnabled/);
  assert.match(src, /SignalConnected/);
  assert.match(src, /audio: !1/, "the default is no longer audio:false");
});

test("the signed-in room passes the live microphone, not a constant", () => {
  const src = code(ROOM);
  assert.match(src, /audio=\{micOn\}/);
  assert.match(src, /video=\{camOn\}/);
  assert.doesNotMatch(
    src,
    /audio=\{false\}/,
    "a hardcoded false is re-applied on every reconnect and mutes the reader",
  );
});

test("the guest room does too, keeping its device constraints", () => {
  const src = code(GUEST);
  assert.match(src, /audio=\{micOn \?/);
  assert.match(src, /video=\{camOn \?/);
  assert.match(src, /deviceId: \{ exact: micId \}/, "the lobby's chosen microphone was dropped");
});

test("both rooms still START muted", () => {
  /* The fix must not undo the thing it is built on top of: joining publishes
     nothing until you say so. Only the SIGNED-IN room starts from silence —
     a guest decides in the lobby, so theirs is seeded from that choice. */
  const src = code(ROOM);
  assert.match(src, /const \[micOn, setMicOn\] = useState\(false\)/);
  assert.match(src, /const \[camOn, setCamOn\] = useState\(false\)/);
  const guest = code(GUEST);
  assert.match(guest, /useState\(micEnabled\)/);
  assert.match(guest, /useState\(camEnabled\)/);
});

test("both rooms mount the sync so the props can follow the tracks", () => {
  /* The signed-in room reaches it through `RoomInterior`, which is shared with
     a task's meeting; the guest room mounts it directly. Either way the props
     passed to `LiveKitRoom` end up following the real tracks. */
  assert.match(
    code(ROOM),
    /onDeviceIntent=\{onDeviceIntent\}/,
    "the signed-in room no longer feeds the sync",
  );
  assert.match(
    code("components/features/meetings/RoomInterior.tsx"),
    /<DeviceIntentSync onChange=\{onDeviceIntent\}/,
    "the shared interior no longer mounts the sync",
  );
  assert.match(code(GUEST), /<DeviceIntentSync onChange=\{onDeviceIntent\}/);
});

test("the callback is stable, or the sync resubscribes on every render", () => {
  for (const path of [ROOM, GUEST]) {
    assert.match(
      code(path),
      /const onDeviceIntent = useCallback\(/,
      `${path} passes an unstable callback`,
    );
  }
});

test("the sync reports from room events, not from an effect body", () => {
  /* Two reasons. The React Compiler's `set-state-in-effect` rule forbids the
     effect-body write, and events are the more truthful source: the state
     changes when the track changes rather than once per render that notices. */
  const src = code(SYNC);
  assert.match(src, /RoomEvent\.LocalTrackPublished/);
  assert.match(src, /RoomEvent\.LocalTrackUnpublished/);
  assert.match(src, /RoomEvent\.TrackMuted/);
  assert.match(src, /RoomEvent\.TrackUnmuted/);
});

test("the sync reports once on mount as well as on change", () => {
  /* A reader who unmuted before this mounted, or a reconnect that landed
     between renders, would otherwise leave the props describing a microphone
     that is no longer real. */
  const src = code(SYNC);
  const effect = src.slice(src.indexOf("useEffect("));
  const reported = effect.indexOf("report();");
  const subscribed = effect.indexOf(".on(RoomEvent");
  assert.ok(reported !== -1, "never reports on mount");
  assert.ok(reported < subscribed, "reports only after subscribing");
});

test("every listener is removed", () => {
  const src = code(SYNC);
  for (const ev of [
    "LocalTrackPublished",
    "LocalTrackUnpublished",
    "TrackMuted",
    "TrackUnmuted",
  ]) {
    assert.ok(src.includes(`.off(RoomEvent.${ev}`), `${ev} leaks`);
  }
});
