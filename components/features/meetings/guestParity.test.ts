import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * What a guest gets, measured against what a signed-in person gets.
 *
 * The guest room is a SECOND implementation of the room — deliberately, in
 * part: it has no tile menu that reads the employee directory, and it never
 * calls `listEmployees`. But two rooms are two things that drift, and the
 * drift is invisible because nothing renders both.
 *
 * These assert the pieces that must be the same, and name the two that are
 * deliberately not.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const GUEST = code("components/features/meetings/GuestRoom.tsx");
const INTERIOR = code("components/features/meetings/RoomInterior.tsx");

/* ── The in-call surface ─────────────────────────────────────────────────── */

test("a guest gets the same control bar, overlays, signals and side panel", () => {
  for (const piece of [
    "MeetingControlBar",
    "RoomOverlays",
    "RoomSidePanel",
    "RoomSignalsProvider",
    "RoomStage",
  ]) {
    assert.match(GUEST, new RegExp(`<${piece}`), `a guest has no ${piece}`);
    assert.match(INTERIOR, new RegExp(`<${piece}`), `${piece} left the room`);
  }
});

test("a guest records their own audio to Drive", () => {
  /* Through guest-keyed routes rather than an employee token — the audio is
     theirs and belongs in the meeting's record like anybody else's. */
  assert.match(GUEST, /useMeetingRecording\(\{/);
  assert.match(GUEST, /guestSessionId,/);
});

/* ── The gap this file was written for ───────────────────────────────────── */

test("a guest's recorder is told when they mute", () => {
  /**
   * `setMuted` is not cosmetic. It records a speech interval per unmuted
   * stretch, and the summary uses those to order who spoke when. Without it a
   * guest's voice reached Drive while their turn in the conversation did not —
   * present in the audio, absent from the ordering.
   */
  assert.match(GUEST, /<MuteBridge onMuteChange=\{recording\.setMuted\} \/>/);
});

test("both rooms use ONE mute bridge, not two", () => {
  /* Two implementations of "what muting means to a recording" is exactly the
     drift a second room invites. */
  assert.match(INTERIOR, /export function MuteBridge\(/);
  assert.match(GUEST, /import \{ MuteBridge \} from "\.\/RoomInterior"/);
  assert.doesNotMatch(
    GUEST,
    /function MuteBridge\(/,
    "the guest room has grown its own copy",
  );
});

test("the speech interval is what the summary orders by", () => {
  /* Named here so the next person who changes `setMuted` can see what depends
     on it from the guest side. */
  const rec = code("lib/legacy-ui/useMeetingRecording.ts");
  assert.match(rec, /currentSpeechStartRef/);
  assert.match(rec, /const setMuted = useCallback\(/);
});

/* ── What a guest deliberately does NOT get ──────────────────────────────── */

test("a guest never reads the employee directory", () => {
  /**
   * Not a gap — a decision. Reading the directory is a request a guest is not
   * entitled to make, so the guest roster is a different component that never
   * asks rather than the same one with a flag.
   */
  assert.match(GUEST, /withDirectory=\{false\}/);
});

test("a guest is never the host, so carries no backup recorder", () => {
  /**
   * `BackupRecorder` is the HOST's copy of everybody else's audio, kept for the
   * case where somebody's own upload never arrives. A guest holding one would
   * be an outsider recording the company's participants to their own session.
   */
  assert.match(INTERIOR, /<BackupRecorder/);
  assert.doesNotMatch(GUEST, /<BackupRecorder/);
  assert.match(GUEST, /isHost: false/);
});
