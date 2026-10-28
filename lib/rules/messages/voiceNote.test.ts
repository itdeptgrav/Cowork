import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pickAudioMime,
  audioExtensionFor,
  formatDuration,
  voiceNoteFilename,
  audioClock,
  audioTitle,
} from "./voiceNote.ts";

test("pickAudioMime prefers opus-in-webm, then falls back in order", () => {
  const only = (t: string) => (x: string) => x === t;
  assert.equal(pickAudioMime(() => true), "audio/webm;codecs=opus");
  assert.equal(pickAudioMime(only("audio/mp4")), "audio/mp4");
  assert.equal(pickAudioMime(only("audio/ogg")), "audio/ogg");
  /* Nothing supported → empty, and the caller lets the browser choose. */
  assert.equal(pickAudioMime(() => false), "");
});

test("audioExtensionFor names the file so the OS and proxy know it", () => {
  assert.equal(audioExtensionFor("audio/webm;codecs=opus"), "webm");
  assert.equal(audioExtensionFor("audio/mp4"), "m4a");
  assert.equal(audioExtensionFor("audio/ogg"), "ogg");
  assert.equal(audioExtensionFor("audio/wav"), "wav");
  assert.equal(audioExtensionFor("weird/thing"), "webm");
});

test("formatDuration is m:ss, floored and zero-padded", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(5), "0:05");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(600), "10:00");
  assert.equal(formatDuration(-3), "0:00");
});

test("voiceNoteFilename is deterministic for a given stamp", () => {
  assert.equal(voiceNoteFilename("audio/mp4", "123"), "voice-note-123.m4a");
  assert.equal(voiceNoteFilename("audio/webm", "abc"), "voice-note-abc.webm");
});

test("the audio clock shows the length before playing, then position and length", () => {
  assert.equal(audioClock(0, 63, false), "1:03");
  assert.equal(audioClock(12.4, 63, true), "0:12 / 1:03");
  /* A length nobody could measure is never shown as 0:00. */
  assert.equal(audioClock(0, null, false), "");
  assert.equal(audioClock(0, Number.POSITIVE_INFINITY, false), "");
  assert.equal(audioClock(7, null, true), "0:07");
});

test("a recorded note reads as a voice note; any other audio keeps its name", () => {
  assert.equal(audioTitle("voice-note-20261011-1408.webm"), "Voice note");
  assert.equal(audioTitle(null), "Voice note");
  assert.equal(audioTitle("  "), "Voice note");
  assert.equal(audioTitle("Site meeting.m4a"), "Site meeting.m4a");
  assert.equal(audioTitle("song.mp3"), "song.mp3");
});
