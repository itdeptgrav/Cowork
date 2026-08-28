import assert from "node:assert/strict";
import { test } from "node:test";
import {
  uploadAriaLabel,
  uploadPercent,
  uploadStage,
  uploadStageLabel,
} from "./uploadStage.ts";

/* ── The two stages ───────────────────────────────────────────────────────── */

test("bytes still moving is the sending stage", () => {
  for (const f of [0, 0.01, 0.5, 0.994]) {
    assert.equal(uploadStage(f), "sending", `${f} should still be sending`);
  }
});

test("all bytes sent is the processing stage, not done", () => {
  /*
   * The reported fault. `uploadToDrive` reports 0–1 across the byte transfer
   * ONLY — the finalize call after it grants `role: reader, type: anyone` and
   * is what makes the image renderable by anybody. The bar reaching 100% means
   * the bytes have gone, not that the attachment is ready.
   */
  assert.equal(uploadStage(1), "processing");
  assert.equal(uploadStageLabel(uploadStage(1)), "Processing…");
});

test("a fraction that rounds to 100 is already processing", () => {
  /* 0.9996 draws a full bar. Calling that "sending" would show a spinner-less
     bar sitting at 100%, which is the exact appearance being fixed. */
  assert.equal(uploadPercent(0.9996), 100);
  assert.equal(uploadStage(0.9996), "processing");
});

test("the label says which stage it is", () => {
  assert.equal(uploadStageLabel("sending"), "Uploading");
  assert.notEqual(uploadStageLabel("processing"), uploadStageLabel("sending"));
});

/* ── The clamp ────────────────────────────────────────────────────────────── */

test("a missing or broken fraction reads as zero, never NaN", () => {
  /* `Math.round(undefined)` is NaN, and NaN reached three places: an
     `aria-valuenow` no screen reader can say, a `width: NaN%` the browser
     discards, and "NaN%" on screen. */
  for (const bad of [
    undefined as unknown as number,
    null as unknown as number,
    NaN,
    "" as unknown as number,
  ]) {
    assert.equal(uploadPercent(bad), 0);
    assert.equal(uploadStage(bad), "sending");
  }
});

test("the percentage cannot leave 0–100", () => {
  /* A resumed upload can report an offset past the total for a moment. */
  assert.equal(uploadPercent(-2), 0);
  assert.equal(uploadPercent(1.4), 100);
});

test("the percentage is a whole number", () => {
  assert.equal(uploadPercent(0.336), 34);
  assert.equal(Number.isInteger(uploadPercent(0.5)), true);
});

/* ── What a screen reader hears ───────────────────────────────────────────── */

test("the accessible label names the stage as well as the file", () => {
  /* "Uploading photo.png" while it is still finishing would be the same wrong
     claim the visible row was making. */
  assert.equal(uploadAriaLabel("photo.png", "sending"), "Uploading photo.png");
  assert.equal(
    uploadAriaLabel("photo.png", "processing"),
    "Processing photo.png",
  );
});
