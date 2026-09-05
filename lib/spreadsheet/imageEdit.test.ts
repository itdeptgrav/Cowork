import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampCrop,
  editedSize,
  fullCrop,
  isIdentityEdit,
  normalizeTurns,
  rotatedSize,
} from "./imageEdit.ts";

/* ── Rotation ─────────────────────────────────────────────────────────────── */

test("four turns is none, and the button can be held down", () => {
  assert.equal(normalizeTurns(4), 0);
  assert.equal(normalizeTurns(9), 1);
  assert.equal(normalizeTurns(0), 0);
});

test("turning the other way is negative, not the caller's arithmetic", () => {
  assert.equal(normalizeTurns(-1), 3);
  assert.equal(normalizeTurns(-5), 3);
});

test("nonsense turns rest at upright rather than throwing", () => {
  assert.equal(normalizeTurns(NaN), 0);
  assert.equal(normalizeTurns(Infinity), 0);
});

test("an odd turn swaps the sides; an even one does not", () => {
  const portrait = { width: 300, height: 900 };
  assert.deepEqual(rotatedSize(portrait, 0), { width: 300, height: 900 });
  assert.deepEqual(rotatedSize(portrait, 1), { width: 900, height: 300 });
  assert.deepEqual(rotatedSize(portrait, 2), { width: 300, height: 900 });
  assert.deepEqual(rotatedSize(portrait, 3), { width: 900, height: 300 });
});

/* ── Crop ─────────────────────────────────────────────────────────────────── */

test("a rectangle inside the image is left alone", () => {
  const crop = { x: 10, y: 20, width: 100, height: 50 };
  assert.deepEqual(clampCrop(crop, { width: 400, height: 300 }), crop);
});

test("a rectangle dragged past an edge stops at the edge", () => {
  /* Not rejected — stopped. A handle that refuses to move reads as broken. */
  const out = clampCrop({ x: 350, y: 0, width: 100, height: 50 }, { width: 400, height: 300 });
  assert.deepEqual(out, { x: 300, y: 0, width: 100, height: 50 });
});

test("a rectangle bigger than the image becomes the image", () => {
  const out = clampCrop({ x: -50, y: -50, width: 9999, height: 9999 }, { width: 400, height: 300 });
  assert.deepEqual(out, { x: 0, y: 0, width: 400, height: 300 });
});

test("width is clamped before position, or it lands off the far edge", () => {
  /* A 500-wide box at x=380 in a 400-wide image. Clamp x first and you get
     x=0 with width 500 — still 100px over. */
  const out = clampCrop({ x: 380, y: 0, width: 500, height: 10 }, { width: 400, height: 300 });
  assert.ok(out);
  assert.ok(out.x + out.width <= 400, `${out.x} + ${out.width} > 400`);
});

test("a crop never collapses to nothing", () => {
  const out = clampCrop({ x: 0, y: 0, width: 0, height: 0 }, { width: 400, height: 300 });
  assert.deepEqual(out, { x: 0, y: 0, width: 1, height: 1 });
});

test("there is nothing to clamp against a zero-sized image", () => {
  assert.equal(clampCrop({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 300 }), null);
  assert.equal(clampCrop({ x: 0, y: 0, width: 10, height: 10 }, { width: NaN, height: 3 }), null);
});

test("the resting crop is the whole picture", () => {
  assert.deepEqual(fullCrop({ width: 640, height: 480 }), {
    x: 0,
    y: 0,
    width: 640,
    height: 480,
  });
});

/* ── The two composed ─────────────────────────────────────────────────────── */

test("no edit at all is the picture's own size", () => {
  assert.deepEqual(editedSize({ width: 640, height: 480 }, { turns: 0 }), {
    width: 640,
    height: 480,
  });
});

test("the crop is read in the ROTATED image's coordinates", () => {
  /* 300×900 turned once is 900×300. A 900-wide crop is legal there and would
     be impossible in the original — which is the whole point of rotating
     first: the box is drawn on what the person is looking at. */
  const out = editedSize(
    { width: 300, height: 900 },
    { turns: 1, crop: { x: 0, y: 0, width: 900, height: 200 } },
  );
  assert.deepEqual(out, { width: 900, height: 200 });
});

test("a crop drawn past the rotated bounds is clamped, not honoured", () => {
  const out = editedSize(
    { width: 300, height: 900 },
    { turns: 0, crop: { x: 0, y: 0, width: 900, height: 200 } },
  );
  /* Unrotated it is only 300 wide. */
  assert.deepEqual(out, { width: 300, height: 200 });
});

/* ── Leaving the file alone ───────────────────────────────────────────────── */

test("an untouched editor is an identity edit", () => {
  /* Re-encoding a JPEG for no change costs a generation of quality and drops
     whatever the camera wrote into it. */
  const nat = { width: 640, height: 480 };
  assert.equal(isIdentityEdit(nat, { turns: 0 }), true);
  assert.equal(isIdentityEdit(nat, { turns: 0, crop: fullCrop(nat) }), true);
  assert.equal(isIdentityEdit(nat, { turns: 4 }), true);
});

test("any rotation or any real crop is not", () => {
  const nat = { width: 640, height: 480 };
  assert.equal(isIdentityEdit(nat, { turns: 1 }), false);
  assert.equal(
    isIdentityEdit(nat, { turns: 0, crop: { x: 1, y: 0, width: 639, height: 480 } }),
    false,
  );
  assert.equal(
    isIdentityEdit(nat, { turns: 0, crop: { x: 0, y: 0, width: 640, height: 479 } }),
    false,
  );
});
