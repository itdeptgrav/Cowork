import assert from "node:assert/strict";
import { test } from "node:test";
import { isEmbeddableImage, sniffImageMime } from "./imageBytes.ts";

const bytes = (...values: number[]) => Uint8Array.from(values);
const pad = (head: number[], length = 32) => {
  const out = new Uint8Array(length);
  out.set(head, 0);
  return out;
};

const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const GIF = pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const BMP = pad([0x42, 0x4d]);
const WEBP = pad([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

test("each image kind is recognised from its bytes alone", () => {
  assert.equal(sniffImageMime(PNG), "image/png");
  assert.equal(sniffImageMime(JPEG), "image/jpeg");
  assert.equal(sniffImageMime(GIF), "image/gif");
  assert.equal(sniffImageMime(BMP), "image/bmp");
  assert.equal(sniffImageMime(WEBP), "image/webp");
});

test("a wrong header does not override the bytes", () => {
  /**
   * The bug this file exists for. A static file server labels a PNG
   * `application/octet-stream` by default, and a proxy that streams a file
   * through without inspecting it does the same. Dropping a picture the
   * browser has already drawn, because a header was vague, is the worst kind
   * of failure — it is plainly on the screen and plainly not in the file.
   */
  assert.equal(sniffImageMime(PNG, "application/octet-stream"), "image/png");
  assert.equal(sniffImageMime(PNG, "text/plain"), "image/png");
  assert.equal(sniffImageMime(JPEG, "image/png"), "image/jpeg");
  assert.equal(isEmbeddableImage(PNG, "application/octet-stream"), true);
});

test("a RIFF file that is not WEBP is not claimed as one", () => {
  /* A wave file starts with the same four bytes; only the form type at offset
     8 tells them apart. */
  const wave = pad([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
  ]);
  assert.equal(sniffImageMime(wave), null);
  assert.equal(sniffImageMime(wave, "audio/wav"), null);
});

test("SVG is recognised by shape, since text has no magic number", () => {
  const svg = (s: string) => new TextEncoder().encode(s);
  assert.equal(sniffImageMime(svg('<svg xmlns="http://www.w3.org/2000/svg"/>')), "image/svg+xml");
  assert.equal(sniffImageMime(svg('<?xml version="1.0"?><svg/>')), "image/svg+xml");
  assert.equal(sniffImageMime(svg("  \n <svg/>")), "image/svg+xml");
  /* A byte-order mark before the declaration is common from Windows tools. */
  assert.equal(sniffImageMime(svg("﻿<?xml version=\"1.0\"?><svg/>")), "image/svg+xml");
});

test("the declared type is the tie-breaker when the bytes say nothing", () => {
  /* An image kind we have no signature for is still an image if the server
     says so — the fallback is a fallback, not a second opinion. */
  const unknown = bytes(0x01, 0x02, 0x03, 0x04, 0x05, 0x06);
  assert.equal(sniffImageMime(unknown, "image/avif"), "image/avif");
  assert.equal(sniffImageMime(unknown, "IMAGE/AVIF"), "image/avif");
  assert.equal(sniffImageMime(unknown, "image/png; charset=binary"), "image/png");
  assert.equal(sniffImageMime(unknown, "application/pdf"), null);
  assert.equal(sniffImageMime(unknown), null);
});

test("nothing is not an image", () => {
  assert.equal(sniffImageMime(new Uint8Array(0)), null);
  assert.equal(sniffImageMime(new Uint8Array(0), "image/png"), null);
  assert.equal(isEmbeddableImage(new Uint8Array(0), "image/png"), false);
});

test("a truncated signature is not accepted", () => {
  /* Four bytes of a PNG header is not a PNG — embedding it would produce a
     file Word opens with a broken picture rather than no picture. */
  assert.equal(sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47)), null);
  assert.equal(sniffImageMime(bytes(0xff, 0xd8)), null);
  assert.equal(sniffImageMime(bytes(0x47, 0x49, 0x46)), null);
});

test("a PDF is never mistaken for an image", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ");
  assert.equal(sniffImageMime(pdf), null);
  assert.equal(sniffImageMime(pdf, "application/pdf"), null);
});
