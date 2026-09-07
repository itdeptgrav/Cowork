import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FONT_SIZE,
  FONT_SIZES,
  fontSizeOptions,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  stepFontSize,
} from "./fontSizes.ts";

const up = (n: number) => stepFontSize(n, 1);
const down = (n: number) => stepFontSize(n, -1);

test("growing moves to the next rung, not to current + 1", () => {
  /* The whole defect: the ladder jumps 14 → 16, the buttons stepped by one, so
     a press produced 15 — a size the picker beside them had no option for. */
  assert.equal(up(14), 16);
  assert.equal(up(16), 18);
  assert.equal(up(18), 24);
  assert.equal(up(24), 32);
});

test("shrinking moves to the previous rung", () => {
  assert.equal(down(16), 14);
  assert.equal(down(32), 24);
  assert.equal(down(11), 10);
});

test("every step lands on something the picker can show", () => {
  /* Walk the whole ladder in both directions and assert the result is always
     offered. This is the property the old code broke. */
  let n: number = FONT_SIZES[0];
  for (let i = 0; i < FONT_SIZES.length - 1; i++) {
    n = up(n);
    assert.ok(
      fontSizeOptions(n).includes(n),
      `${n} is not offered after growing`,
    );
  }
  for (let i = 0; i < FONT_SIZES.length - 1; i++) {
    n = down(n);
    assert.ok(
      fontSizeOptions(n).includes(n),
      `${n} is not offered after shrinking`,
    );
  }
});

test("a size between rungs joins the ladder on the first press", () => {
  /* A workbook opened from a file carries whatever Excel had. Walking up from
     15 one point at a time would take three presses to reach a rung. */
  assert.equal(up(15), 16);
  assert.equal(down(15), 14);
  assert.equal(up(10.5), 11);
  assert.equal(down(10.5), 10);
});

test("past the ends it still moves, by one, and clamps", () => {
  /* 32 is the largest rung OFFERED, not the largest size allowed — refusing to
     grow would be a worse answer than growing by one. */
  assert.equal(up(32), 33);
  assert.equal(up(40), 41);
  assert.equal(down(10), 9);
  assert.equal(down(7), 6);
});

test("it never leaves Excel's bounds", () => {
  assert.equal(down(MIN_FONT_SIZE), MIN_FONT_SIZE);
  assert.equal(up(MAX_FONT_SIZE), MAX_FONT_SIZE);
  assert.equal(down(1), MIN_FONT_SIZE);
  assert.equal(up(1000), MAX_FONT_SIZE);
});

test("a size the ladder does not carry is still offered, in order", () => {
  /* A control that cannot display its own value is the same bug in a different
     costume. */
  assert.deepEqual(fontSizeOptions(15), [10, 11, 12, 13, 14, 15, 16, 18, 24, 32]);
  assert.deepEqual(fontSizeOptions(48), [...FONT_SIZES, 48]);
  assert.deepEqual(fontSizeOptions(8), [8, ...FONT_SIZES]);
});

test("a size already on the ladder is not duplicated", () => {
  assert.deepEqual(fontSizeOptions(14), [...FONT_SIZES]);
  assert.deepEqual(fontSizeOptions(DEFAULT_FONT_SIZE), [...FONT_SIZES]);
});

test("nonsense is treated as the default rather than propagated", () => {
  assert.equal(up(Number.NaN), 14);
  assert.equal(down(Number.NaN), 12);
  assert.deepEqual(fontSizeOptions(Number.NaN), [...FONT_SIZES]);
});

test("the default is a rung, so the picker opens on a real option", () => {
  assert.ok((FONT_SIZES as readonly number[]).includes(DEFAULT_FONT_SIZE));
});
