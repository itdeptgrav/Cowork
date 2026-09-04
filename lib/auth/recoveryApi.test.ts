import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQrPayload, readQrPayload } from "./recoveryApi.ts";

/**
 * The QR payload is the seam between two devices that share no state — one
 * draws a picture, the other reads it back, and nothing in between can report
 * a mismatch. So the round trip is pinned here rather than trusted.
 */

test("a built payload reads back as the token that went in", () => {
  const token = "aVeryLong-base64url_TOKEN_value_0123456789ab";
  assert.equal(readQrPayload(buildQrPayload("https://cowork.example", token)), token);
});

test("a trailing slash on the origin does not double up", () => {
  /* `${origin}/signin` with a trailing slash gives `//signin`, which some
     proxies rewrite and others 404 — the same hazard `joinUrl` exists for. */
  assert.equal(
    buildQrPayload("https://cowork.example/", "abc123"),
    "https://cowork.example/signin?qr=abc123",
  );
});

test("tokens needing escaping survive the round trip", () => {
  /* base64url yields `-` and `_`, which are URL-safe — but the encode/decode
     pair must still be symmetrical, and a token is worthless if one character
     changes. */
  const token = "a-b_c-D_E1234567890xyzABCDEFGHIJKLM";
  const payload = buildQrPayload("https://cowork.example", token);
  assert.equal(readQrPayload(payload), token);
});

test("a bare token is accepted, because a scanner will meet one", () => {
  assert.equal(
    readQrPayload("Kf3nQ8xLm2pR7vT1yB4wZ6aC9dE0gH5jI"),
    "Kf3nQ8xLm2pR7vT1yB4wZ6aC9dE0gH5jI",
  );
});

test("surrounding whitespace is trimmed", () => {
  /* Decoders vary on what they include; a stray newline must not turn a good
     scan into "that code is not readable". */
  assert.equal(readQrPayload("  Kf3nQ8xLm2pR7vT1yB4wZ6aC9dE0gH5jI \n"), "Kf3nQ8xLm2pR7vT1yB4wZ6aC9dE0gH5jI");
});

test("a URL from a different host still yields its token", () => {
  /* Deliberate: a code generated on production and scanned by a laptop on the
     tunnel is the ordinary case. A foreign token simply fails to redeem — the
     server decides validity, not this parser. */
  assert.equal(
    readQrPayload("https://some-tunnel.example/signin?qr=TOKEN_from_elsewhere_01234567890"),
    "TOKEN_from_elsewhere_01234567890",
  );
});

test("a QR that is not ours is rejected rather than guessed at", () => {
  /* Cameras find QR codes everywhere — a WiFi config, a payment code, a
     product label. Each must fail as "not readable" here rather than travel to
     the server as a redemption attempt. */
  assert.equal(readQrPayload("WIFI:S:GravOffice;T:WPA;P:hunter2;;"), null);
  assert.equal(readQrPayload("https://grav.in/employee/GR0108"), null);
  assert.equal(readQrPayload("https://cowork.example/signin"), null);
  assert.equal(readQrPayload("hello world"), null);
  assert.equal(readQrPayload(""), null);
  assert.equal(readQrPayload("   "), null);
});

test("the CMS's own employee QR is not mistaken for a sign-in code", () => {
  /* `components/employee/IdCardGenerator.js` prints `https://grav.in/employee/<id>`
     on every ID card. Those cards are in people's pockets, and one of them
     being read as a credential is the exact confusion this parser must not
     make. */
  assert.equal(readQrPayload("https://grav.in/employee/EMP001"), null);
});

test("a short bare string is not treated as a token", () => {
  /* The server issues 32 bytes — 43 base64url characters. A four-character
     scan is noise, and sending it on would spend a rate-limit slot. */
  assert.equal(readQrPayload("abc"), null);
});
