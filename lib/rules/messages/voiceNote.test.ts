import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pickAudioMime,
  audioExtensionFor,
  formatDuration,
  voiceNoteFilename,
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
