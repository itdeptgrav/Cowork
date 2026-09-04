import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Voice notes ride the existing attachment path — no new storage, no schema.
 * The mic records a `File` and hands it to the composer's `handleFiles`, exactly
 * as a picked file, so upload/send/render are reused. What is protected here is
 * that BOTH composers wire the mic to that path, and that the control renders
 * nothing where the browser cannot record.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const REC = strip("components/features/messages/VoiceRecorder.tsx");
const HOOK = strip("lib/hooks/useVoiceRecorder.ts");
const CHAT = strip("components/features/tasks/ChatPanel.tsx");
const MSGS = strip("components/features/messages/MessagesArea.tsx");

test("the recorder hides itself where recording is unsupported", () => {
  assert.match(REC, /if \(!rec\.supported\) return null;/);
});

test("the hook releases the mic and delivers a File on stop", () => {
  /* Tracks stopped on cleanup — the mic never stays open in the background. */
  assert.match(HOOK, /getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/);
  assert.match(HOOK, /new File\(\[blob\], name, \{ type: blob\.type \}\)/);
  /* Cancel discards; stop delivers. */
  assert.match(HOOK, /cancelledRef\.current = true/);
});

test("the task chat composer records a voice note into handleFiles", () => {
  assert.match(CHAT, /import \{ VoiceRecorder \}/);
  assert.match(CHAT, /<VoiceRecorder[\s\S]*?onRecorded=\{\(f\) => void handleFiles\(\[f\]\)\}/);
});

test("the message chat composer records a voice note into handleFiles", () => {
  assert.match(MSGS, /import \{ VoiceRecorder \}/);
  assert.match(MSGS, /<VoiceRecorder[\s\S]*?onRecorded=\{\(f\) => void handleFiles\(\[f\]\)\}/);
});
