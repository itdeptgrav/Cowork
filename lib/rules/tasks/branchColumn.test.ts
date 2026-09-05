import assert from "node:assert/strict";
import { test } from "node:test";
import { branchColumnTop } from "./branchColumn.ts";

const top = (rowTop: number, columnHeight = 200, available = 800) =>
  branchColumnTop({ rowTop, columnHeight, available });

test("the column starts level with the row that opened it", () => {
  /* The whole point: a team opened from a name near the bottom of a long list
     appeared up at the top, level with people it has nothing to do with. */
  assert.equal(top(0), 0);
  assert.equal(top(120), 120);
  assert.equal(top(357), 357);
});

test("it slides up rather than running off the bottom", () => {
  /* Aligning naively makes a list you cannot reach the end of. */
  assert.equal(top(700, 200, 800), 588);
  assert.equal(top(999, 200, 800), 588);
});

test("it slides up only as far as it must", () => {
  /* Staying on screen wins, but the alignment is given up a pixel at a time
     rather than abandoned back to the top. */
  const fits = top(560, 200, 800);
  assert.equal(fits, 560, "a row that still fits is not moved");
  assert.equal(top(600, 200, 800), 588, "one that does not is moved the minimum");
});

test("it never rises above the panel's own top", () => {
  /* A team above the list it came out of reads as belonging to whatever is up
     there instead. */
  assert.equal(top(-40), 0);
  /* A column taller than the window has nowhere good to go; the top is the
     best answer rather than a negative one. */
  assert.equal(top(300, 900, 500), 0);
  assert.equal(top(300, 500, 500), 0);
});

test("the clearance below is honoured", () => {
  assert.equal(
    branchColumnTop({ rowTop: 999, columnHeight: 100, available: 500, margin: 0 }),
    400,
  );
  assert.equal(
    branchColumnTop({ rowTop: 999, columnHeight: 100, available: 500, margin: 40 }),
    360,
  );
});

test("a measurement that failed reads as zero, not as NaN", () => {
  /* getBoundingClientRect on a node that has gone yields nothing useful, and a
     NaN margin silently removes the column from the layout. */
  assert.equal(top(Number.NaN), 0);
  assert.equal(branchColumnTop({ rowTop: 100, columnHeight: Number.NaN, available: 800 }), 100);
  assert.equal(branchColumnTop({ rowTop: 100, columnHeight: 200, available: Number.NaN }), 0);
});
