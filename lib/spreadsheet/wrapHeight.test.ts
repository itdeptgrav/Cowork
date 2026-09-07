import assert from "node:assert/strict";
import { test } from "node:test";
import {
  autoRowHeight,
  mergeRowHeights,
  wrapLineCount,
  wrappedCellHeight,
  WRAP_LINE_HEIGHT,
  CELL_PADDING_Y,
} from "./wrapHeight.ts";

/** Ten pixels a character — arithmetic, so the expectations are countable. */
const measure = (s: string) => s.length * 10;
const count = (text: string, available: number) =>
  wrapLineCount(text, available, measure);

test("text that fits is one line", () => {
  assert.equal(count("abc", 100), 1);
  assert.equal(count("", 100), 1);
});

test("words wrap onto the next line rather than being cut", () => {
  /* "aaaa " is 50 and does not fit in 45, so the space closes the line. */
  assert.equal(count("aaaa bbbb", 45), 2);
  assert.equal(count("aaaa bbbb cccc", 45), 3);
  /* Room for both means one line. */
  assert.equal(count("aaaa bbbb", 100), 1);
});

test("a word too long for the column is broken across lines", () => {
  /* Exactly what `word-break: break-word` does. Skipping this is how a pasted
     URL reports one line, gets a one-line row, and is clipped to a quarter of
     itself. */
  assert.equal(count("aaaaaaaaaa", 45), 3); /* 4 + 4 + 2 characters */
  assert.equal(count("aaaaaaaa", 40), 2);
});

test("explicit newlines always break", () => {
  assert.equal(count("a\nb", 500), 2);
  assert.equal(count("a\nb\nc", 500), 3);
  /* A blank line is a line — it occupies height on screen. */
  assert.equal(count("a\n\nb", 500), 3);
});

test("a column too narrow to reason about answers one line, not a hang", () => {
  /* The guard matters: without it the break loop cannot advance and spins. */
  assert.equal(count("anything", 0), 1);
  assert.equal(count("anything", -5), 1);
});

test("the height follows the pinned line height, not the browser's default", () => {
  /* The render sets the same constant, so the two agree by construction rather
     than by having been tuned against each other. */
  const one = wrappedCellHeight(1, 13);
  assert.equal(one, Math.ceil(13 * WRAP_LINE_HEIGHT + CELL_PADDING_Y * 2));
  /* Three lines is about three times the text, plus the one padding. */
  assert.equal(wrappedCellHeight(3, 13), Math.ceil(3 * 13 * WRAP_LINE_HEIGHT + 6));
  assert.ok(wrappedCellHeight(3, 13) > wrappedCellHeight(2, 13));
});

test("a row takes the height of its tallest wrapped cell", () => {
  assert.equal(autoRowHeight([30, 62, 45], 24), 62);
});

test("auto-fit never shrinks a row below the default", () => {
  /* Growing to fit is the feature; shrinking a row nobody asked to shrink
     would move everything below it for no visible reason. */
  assert.equal(autoRowHeight([10, 12], 24), 24);
  assert.equal(autoRowHeight([], 24), 24);
});

test("a stored height too short for wrapped text is grown, not obeyed", () => {
  /* The reported case: a file's rows arrive with heights sized for UNWRAPPED
     text, so every row carries one and auto-fit was locked out of all of them
     — the text wrapped and was then clipped by a row that would not grow. */
  const merged = mergeRowHeights({ 2: 76 }, { 2: 24 });
  assert.equal(merged[2], 76);
});

test("a row deliberately made taller than its content keeps the room", () => {
  assert.equal(mergeRowHeights({ 5: 40 }, { 5: 120 })[5], 120);
});

test("rows nothing knows about are left exactly as they were", () => {
  const merged = mergeRowHeights({ 1: 50 }, { 0: 24, 9: 30 });
  assert.deepEqual(merged, { 0: 24, 1: 50, 9: 30 });
});

test("neither side is mutated", () => {
  const auto = { 1: 50 };
  const stored = { 1: 24 };
  mergeRowHeights(auto, stored);
  assert.deepEqual(auto, { 1: 50 });
  assert.deepEqual(stored, { 1: 24 });
});
