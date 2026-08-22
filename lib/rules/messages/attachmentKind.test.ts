import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachmentKind,
  extensionOf,
  isPlayable,
} from "./attachmentKind.ts";

test("a stated MIME type decides it", () => {
  assert.equal(attachmentKind("clip.mp4", "video/mp4"), "video");
  assert.equal(attachmentKind("song.mp3", "audio/mpeg"), "voice");
  assert.equal(attachmentKind("photo.jpg", "image/jpeg"), "image");
  assert.equal(attachmentKind("report.pdf", "application/pdf"), "pdf");
  assert.equal(attachmentKind("sheet.xlsx", "application/vnd.ms-excel"), "file");
});

test("an empty MIME type falls back to the extension", () => {
  /* The case this module exists for: File.type is empty far more often than
     people expect, and a video filed as "file" renders as a paperclip row. */
  assert.equal(attachmentKind("clip.mkv", ""), "video");
  assert.equal(attachmentKind("clip.mov", null), "video");
  assert.equal(attachmentKind("voice.m4a", undefined), "voice");
  assert.equal(attachmentKind("scan.tiff", ""), "image");
  assert.equal(attachmentKind("notes.pdf", ""), "pdf");
});

test("octet-stream is a shrug, not an answer", () => {
  /* Drive hands this back for plenty of files. Trusting it turns every one of
     them into a generic download link. */
  assert.equal(attachmentKind("clip.mp4", "application/octet-stream"), "video");
  assert.equal(attachmentKind("track.flac", "binary/octet-stream"), "voice");
  assert.equal(attachmentKind("mystery.bin", "application/octet-stream"), "file");
});

test("a recognised MIME is not second-guessed by the name", () => {
  /* "clip.mov.zip" is an archive that happens to mention a video. The stated
     type is the truth; the name is a hint used only when there is no truth. */
  assert.equal(attachmentKind("clip.mov.zip", "application/zip"), "file");
  assert.equal(attachmentKind("photo.jpg", "application/pdf"), "pdf");
});

test("an unknown thing is a file, not a guess", () => {
  assert.equal(attachmentKind("data.xyz", ""), "file");
  assert.equal(attachmentKind(null, null), "file");
  assert.equal(attachmentKind("", ""), "file");
});

test("case and paths do not matter", () => {
  assert.equal(attachmentKind("CLIP.MP4", ""), "video");
  assert.equal(attachmentKind("Holiday.MOV", "VIDEO/QUICKTIME"), "video");
  assert.equal(attachmentKind("C:\\Users\\me\\clip.webm", ""), "video");
  assert.equal(attachmentKind("/home/me/clip.avi", ""), "video");
});

test("a dotfile has no extension", () => {
  assert.equal(extensionOf(".gitignore"), "");
  assert.equal(extensionOf("noextension"), "");
  assert.equal(extensionOf("archive.tar.gz"), "gz");
  assert.equal(extensionOf(null), "");
});

test("video and audio get players; everything else gets a link", () => {
  assert.equal(isPlayable("video"), true);
  assert.equal(isPlayable("voice"), true);
  assert.equal(isPlayable("image"), false);
  assert.equal(isPlayable("pdf"), false);
  assert.equal(isPlayable("file"), false);
});

test("the formats people actually send are all recognised", () => {
  for (const n of ["a.mp4", "a.mov", "a.webm", "a.mkv", "a.avi", "a.3gp", "a.m4v"])
    assert.equal(attachmentKind(n, ""), "video", n);
  for (const n of ["a.mp3", "a.wav", "a.m4a", "a.aac", "a.ogg", "a.opus", "a.flac"])
    assert.equal(attachmentKind(n, ""), "voice", n);
  for (const n of ["a.jpg", "a.png", "a.gif", "a.webp", "a.heic"])
    assert.equal(attachmentKind(n, ""), "image", n);
});
