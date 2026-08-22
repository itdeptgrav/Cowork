import assert from "node:assert/strict";
import { test } from "node:test";
import { readAttachment } from "./messaging.ts";

/**
 * Reading a stored attachment back into something the thread can draw.
 *
 * The kind is FROZEN into the message document when it is sent, so this
 * function is the only place a video already sitting in somebody's history can
 * be recognised. Two bugs met here and both are covered below: `video` was
 * missing from the accepted list, and every clip sent before that kind existed
 * is stored as `file`.
 */

const URL_ = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view";

test("a stored video kind survives the read", () => {
  /* It did not. `video` was absent from the whitelist, so the kind the upload
     path had just worked out was read straight back as `file` and the player
     could never be reached. */
  const a = readAttachment({ type: "video", url: URL_, name: "clip.mp4" });
  assert.equal(a?.kind, "video");
});

test("a video stored as “file” before the kind existed is recognised by name", () => {
  /* The retro-fix, and the reason the whitelist alone was not enough: every
     clip already in a thread is stored as `file` for good. */
  const a = readAttachment({ type: "file", url: URL_, name: "Barsaat.mp4" });
  assert.equal(a?.kind, "video");
});

test("an attachment with no type at all is classified by name", () => {
  const a = readAttachment({ url: URL_, name: "recording.mov" });
  assert.equal(a?.kind, "video");
});

test("a genuine file stays a file", () => {
  /* The second look must not turn every unrecognised attachment into media. */
  assert.equal(
    readAttachment({ type: "file", url: URL_, name: "accounts.xlsx" })?.kind,
    "file",
  );
  assert.equal(
    readAttachment({ type: "file", url: URL_, name: "archive.zip" })?.kind,
    "file",
  );
  assert.equal(readAttachment({ type: "file", url: URL_ })?.kind, "file");
});

test("a deliberately stated kind is taken at its word", () => {
  /* `image`, `pdf`, `voice` and `video` were each decided rather than defaulted,
     so they are trusted even where the filename disagrees. Only `file` — the
     fallback bucket — gets a second look. */
  assert.equal(
    readAttachment({ type: "pdf", url: URL_, name: "scan.mp4" })?.kind,
    "pdf",
  );
  assert.equal(
    readAttachment({ type: "voice", url: URL_, name: "note.bin" })?.kind,
    "voice",
  );
  assert.equal(
    readAttachment({ type: "image", url: URL_, name: "photo" })?.kind,
    "image",
  );
});

test("an unknown stored type falls back to the name rather than vanishing", () => {
  assert.equal(
    readAttachment({ type: "something-else", url: URL_, name: "clip.webm" })?.kind,
    "video",
  );
});

test("the Drive id is still read, since the player cannot open without one", () => {
  const a = readAttachment({ type: "video", url: URL_, name: "clip.mp4" });
  assert.equal(a?.fileId, "1AbCdEfGhIjKlMnOpQrStUv");
});

test("an attachment with no URL is still dropped", () => {
  assert.equal(readAttachment({ type: "video", name: "clip.mp4" }), null);
  assert.equal(readAttachment(null), null);
});
