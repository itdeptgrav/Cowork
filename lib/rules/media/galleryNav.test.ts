import assert from "node:assert/strict";
import { test } from "node:test";
import { clampIndex, stepIndex, canStep } from "./galleryNav.ts";

/** The gallery's whole "which image" logic — non-wrapping, ends are real. */

test("clampIndex keeps an index inside the list", () => {
  assert.equal(clampIndex(-3, 5), 0);
  assert.equal(clampIndex(0, 5), 0);
  assert.equal(clampIndex(4, 5), 4);
  assert.equal(clampIndex(9, 5), 4);
});

test("clampIndex on an empty list is 0", () => {
  assert.equal(clampIndex(2, 0), 0);
});

test("stepIndex moves one and stops at the ends — it does not wrap", () => {
  assert.equal(stepIndex(0, 1, 3), 1);
  assert.equal(stepIndex(1, 1, 3), 2);
  assert.equal(stepIndex(2, 1, 3), 2, "next at the last image stays put");
  assert.equal(stepIndex(0, -1, 3), 0, "previous at the first image stays put");
  assert.equal(stepIndex(2, -1, 3), 1);
});

test("canStep is false exactly at the end you cannot move past", () => {
  assert.equal(canStep(0, -1, 3), false);
  assert.equal(canStep(0, 1, 3), true);
  assert.equal(canStep(2, 1, 3), false);
  assert.equal(canStep(2, -1, 3), true);
});

test("a single image can step nowhere", () => {
  assert.equal(canStep(0, 1, 1), false);
  assert.equal(canStep(0, -1, 1), false);
});
