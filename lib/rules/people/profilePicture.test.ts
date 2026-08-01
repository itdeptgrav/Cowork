import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_SOURCE_BYTES,
  MAX_STORED_BYTES,
  OUTPUT_QUALITY,
  OUTPUT_SIZE_PX,
  byteLengthOfDataUrl,
  initialsOf,
  isRenderablePicture,
  pictureRefusal,
  readProfilePicture,
  storedPictureRefusal,
} from "./profilePicture.ts";

/** A data URL of a given payload size, for the ceiling tests. */
const dataUrl = (payloadChars: number, mime = "image/jpeg"): string =>
  `data:${mime};base64,${"A".repeat(payloadChars)}`;

test("the encoder settings are legacy's, not ours", () => {
  /* Pinned as VALUES, because the same field is written by the old app: a
     different output size would give one person's face two resolutions
     depending on which application they happened to open. */
  assert.equal(OUTPUT_SIZE_PX, 160);
  assert.equal(OUTPUT_QUALITY, 0.75);
  assert.equal(MAX_SOURCE_BYTES, 10 * 1024 * 1024);
});

test("a file that is not an image is refused in the product's own words", () => {
  assert.equal(
    pictureRefusal({ type: "application/pdf", size: 1000 }),
    "Please select an image file.",
  );
  assert.equal(
    pictureRefusal({ type: "", size: 1000 }),
    "Please select an image file.",
  );
});

test("an oversized file is refused in the product's own words", () => {
  assert.equal(
    pictureRefusal({ type: "image/png", size: MAX_SOURCE_BYTES + 1 }),
    "Image must be under 10MB.",
  );
  /* Exactly at the cap is allowed — "under 10MB" is the message, and refusing
     the boundary would make the message wrong by one byte. */
  assert.equal(pictureRefusal({ type: "image/png", size: MAX_SOURCE_BYTES }), null);
});

test("an empty file is named rather than left to fail at the decoder", () => {
  assert.equal(pictureRefusal({ type: "image/png", size: 0 }), "That file is empty.");
});

test("an ordinary photograph is not refused", () => {
  assert.equal(pictureRefusal({ type: "image/jpeg", size: 2_400_000 }), null);
  assert.equal(pictureRefusal({ type: "image/heic", size: 3_000_000 }), null);
});

test("the type test is a prefix, so every image subtype passes", () => {
  /* Legacy accepts `image/*` and so does this. The stored value is always a
     JPEG the canvas produced, whatever went in — so there is no subtype here
     that reaches storage unchanged. */
  for (const type of ["image/png", "image/webp", "image/avif", "image/svg+xml"]) {
    assert.equal(pictureRefusal({ type, size: 5000 }), null, type);
  }
});

test("a data URL's size is measured from its payload, not its whole string", () => {
  /* Four base64 characters carry three bytes. Measuring the string instead
     would overstate every picture by a third and by the preamble. */
  assert.equal(byteLengthOfDataUrl(dataUrl(4)), 3);
  assert.equal(byteLengthOfDataUrl(dataUrl(400)), 300);
});

test("a string with no comma is measured whole rather than crashing", () => {
  assert.equal(byteLengthOfDataUrl("not-a-data-url"), "not-a-data-url".length);
});

test("a picture within the ceiling is renderable; one beyond it is not", () => {
  assert.equal(isRenderablePicture(dataUrl(1000)), true);
  assert.equal(isRenderablePicture(dataUrl(MAX_STORED_BYTES * 2)), false);
});

test("an https URL is accepted on read, so a move to a bucket needs no mapper change", () => {
  assert.equal(isRenderablePicture("https://example.test/a.jpg"), true);
});

test("anything that is not an image URL is refused, including javascript:", () => {
  for (const value of [
    "javascript:alert(1)",
    "http://example.test/a.jpg",
    "data:text/html;base64,PHNjcmlwdD4=",
    "",
    null,
    undefined,
    42,
  ]) {
    assert.equal(isRenderablePicture(value), false, String(value));
  }
});

test("the write refuses a value that is not an image, and one that is too big", () => {
  assert.equal(
    storedPictureRefusal("https://example.test/a.jpg"),
    "A profile picture has to be an image.",
    "the writer only ever produces a data URL, whatever the reader tolerates",
  );
  assert.equal(
    storedPictureRefusal(dataUrl(MAX_STORED_BYTES * 2)),
    "That picture is too large to store. Try a smaller one.",
  );
  assert.equal(storedPictureRefusal(dataUrl(1000)), null);
});

test("an unreadable stored value leaves somebody their monogram, not an error", () => {
  assert.equal(readProfilePicture("javascript:alert(1)"), null);
  assert.equal(readProfilePicture(undefined), null);
  assert.equal(readProfilePicture(dataUrl(500)), dataUrl(500));
});

test("initials are the first letter of each word, at most two", () => {
  assert.equal(initialsOf("Rakesh Biswal"), "RB");
  assert.equal(initialsOf("Soumya"), "S");
  assert.equal(initialsOf("Ana Maria Lopez Diaz"), "AM");
});

test("initials survive extra whitespace and punctuation-only names", () => {
  assert.equal(initialsOf("  Rishee   Ray  "), "RR");
  assert.equal(initialsOf("—"), "?");
  assert.equal(initialsOf(""), "?");
  assert.equal(initialsOf("   "), "?");
});

test("a non-Latin name still produces initials rather than a question mark", () => {
  assert.equal(initialsOf("অভিজিৎ রায়"), "অর");
});
