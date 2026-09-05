import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_IMPORT_HEIGHT,
  MAX_IMPORT_WIDTH,
  fitImportSize,
  importResizeNotice,
} from "./imageImport.ts";

/**
 * The import ceiling, and the fact that it is only a ceiling ON IMPORT.
 *
 * The rule the owner asked for: a picture sizes the cell it lands in, an
 * oversized one is scaled down keeping its ratio, and dragging the cell bigger
 * afterwards is not this function's business.
 */

test("a picture smaller than the box arrives at its own size", () => {
  /* Not enlarged to fill the box: upscaling a 40×40 icon produces a blurred
     one, and nobody asked for that by choosing a small file. */
  const fit = fitImportSize({ width: 40, height: 40 });
  assert.deepEqual(fit, { width: 40, height: 40, scaled: false });
});

test("a picture exactly the size of the box is not touched", () => {
  const fit = fitImportSize({
    width: MAX_IMPORT_WIDTH,
    height: MAX_IMPORT_HEIGHT,
  });
  assert.equal(fit.scaled, false);
  assert.equal(fit.width, MAX_IMPORT_WIDTH);
  assert.equal(fit.height, MAX_IMPORT_HEIGHT);
});

test("a wide picture is limited by width, and keeps its ratio", () => {
  /* 4000×2000 is 2:1. Width binds first, so it lands at 480×240. */
  const fit = fitImportSize({ width: 4000, height: 2000 });
  assert.deepEqual(fit, { width: 480, height: 240, scaled: true });
  assert.equal(fit.width / fit.height, 2);
});

test("a tall picture is limited by height, and keeps its ratio", () => {
  /* 2000×4000 is 1:2. Height binds first: 360 tall, so 180 wide. */
  const fit = fitImportSize({ width: 2000, height: 4000 });
  assert.deepEqual(fit, { width: 180, height: 360, scaled: true });
});

test("a big picture at the box's own ratio touches both edges", () => {
  const fit = fitImportSize({
    width: MAX_IMPORT_WIDTH * 3,
    height: MAX_IMPORT_HEIGHT * 3,
  });
  assert.deepEqual(fit, {
    width: MAX_IMPORT_WIDTH,
    height: MAX_IMPORT_HEIGHT,
    scaled: true,
  });
});

test("neither side ever rounds away to nothing", () => {
  /* A 4000×1 sliver scales to 0.12px tall. Rounded, that is a cell with no
     height — invisible, and unclickable to drag back. */
  const fit = fitImportSize({ width: 4000, height: 1 });
  assert.equal(fit.width, 480);
  assert.ok(fit.height >= 1, `height was ${fit.height}`);
});

test("whole pixels, because a row height is a whole pixel", () => {
  const fit = fitImportSize({ width: 1000, height: 333 });
  assert.equal(fit.width, Math.round(fit.width));
  assert.equal(fit.height, Math.round(fit.height));
});

test("an image that would not decode falls back to the box", () => {
  /* Never a zero-sized cell: it would be invisible and there would be nothing
     left to grab to fix it. */
  for (const bad of [
    { width: 0, height: 0 },
    { width: NaN, height: 100 },
    { width: 100, height: Infinity },
    { width: -50, height: 50 },
  ]) {
    const fit = fitImportSize(bad);
    assert.equal(fit.width, MAX_IMPORT_WIDTH, JSON.stringify(bad));
    assert.equal(fit.height, MAX_IMPORT_HEIGHT, JSON.stringify(bad));
    assert.equal(fit.scaled, true);
  }
});

test("the box is a parameter, so the editor can preview against another one", () => {
  const fit = fitImportSize({ width: 200, height: 200 }, { width: 50, height: 100 });
  assert.deepEqual(fit, { width: 50, height: 50, scaled: true });
});

test("nothing is said when nothing was resized", () => {
  const natural = { width: 40, height: 40 };
  assert.equal(importResizeNotice(natural, fitImportSize(natural)), null);
});

test("a resize says both sizes, and that the cell is free from here", () => {
  const natural = { width: 4000, height: 2000 };
  const notice = importResizeNotice(natural, fitImportSize(natural));
  assert.ok(notice);
  assert.match(notice, /4000 × 2000/);
  assert.match(notice, /480 × 240/);
  /* The point of the sentence: the limit does not follow the cell around. */
  assert.match(notice, /drag the cell larger/);
});
