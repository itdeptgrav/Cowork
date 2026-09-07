import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Pressing Leave stops the leaver's own recording and finalises it at once.
 *
 * The recording is held globally so it survives a pop-out or a page change — you
 * are still in the meeting, just looking elsewhere. So leaving cannot rely on a
 * component unmounting to stop it; it has to be told. `stopRecording()` stops
 * this participant's capture and uploads their audio (idempotent, a no-op when
 * nothing is recording). It is called on a DELIBERATE disconnect only —
 * `DisconnectReason.CLIENT_INITIATED` — so a network blip, which LiveKit
 * reconnects from while `connect` is still set, does not finalise a recording
 * that should resume. Both rooms, because a guest records exactly as an employee
 * does.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const ROOM = strip("components/features/meetings/MeetingRoom.tsx");
const GUEST = strip("components/features/meetings/GuestRoom.tsx");

test("both rooms import DisconnectReason", () => {
  assert.match(ROOM, /import \{ DisconnectReason \} from "livekit-client"/);
  assert.match(GUEST, /DisconnectReason/);
  assert.match(GUEST, /from "livekit-client"/);
});

test("the signed-in room stops recording on a deliberate leave", () => {
  assert.match(ROOM, /onDisconnected=\{\(reason\) =>/);
  assert.match(
    ROOM,
    /if \(\s*reason === DisconnectReason\.CLIENT_INITIATED \|\|\s*reason === DisconnectReason\.ROOM_DELETED\s*\)\s*void recording\.stopRecording\(\)/,
  );
});

test("the guest room stops recording on a deliberate leave, the same way", () => {
  assert.match(GUEST, /onDisconnected=\{\(reason\) =>/);
  assert.match(
    GUEST,
    /if \(\s*reason === DisconnectReason\.CLIENT_INITIATED \|\|\s*reason === DisconnectReason\.ROOM_DELETED\s*\)\s*void recording\.stopRecording\(\)/,
  );
});
