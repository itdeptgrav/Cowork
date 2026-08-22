/**
 * Conditional-formatting audit — rule evaluation against Excel semantics.
 *
 * Number rules are strict at their bound (greater than 100 excludes 100),
 * between is inclusive, text matching is case-insensitive and works on the
 * DISPLAYED text (so numeric cells match text rules), a custom formula only
 * matches on a truthy boolean and never crashes on an error, and duplicate
 * detection compares text the way every other rule here does — ignoring case.
 *
 * Failing assertions are kept deliberately, tagged BUG(<id>).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { BLANK, type ScalarValue } from "@/lib/spreadsheet/formula/value";
import { VALUE } from "@/lib/spreadsheet/formula/errors";
import {
  conditionMatches,
  duplicateValueSet,
  rangeContains,
  type CondContext,
} from "@/lib/spreadsheet/conditional";
import type { Rect } from "@/lib/spreadsheet/coordinates";

function ctx(value: ScalarValue, opts: Partial<CondContext> = {}): CondContext {
  return {
    value,
    display: typeof value === "string" ? value : typeof value === "number" ? String(value) : "",
    isDuplicate: false,
    evalCustom: () => BLANK,
    ...opts,
  };
}

test("AUDIT: greaterThan/lessThan are strict at the bound; between is inclusive", () => {
  assert.equal(conditionMatches({ type: "greaterThan", value: 100 }, ctx(100)), false);
  assert.equal(conditionMatches({ type: "greaterThan", value: 100 }, ctx(100.0001)), true);
  assert.equal(conditionMatches({ type: "lessThan", value: 100 }, ctx(100)), false);
  assert.equal(conditionMatches({ type: "lessThan", value: 99.9999 }, ctx(99.999)), true);
  assert.equal(conditionMatches({ type: "between", a: 1, b: 10 }, ctx(1)), true);
  assert.equal(conditionMatches({ type: "between", a: 1, b: 10 }, ctx(10)), true);
  assert.equal(conditionMatches({ type: "between", a: 1, b: 10 }, ctx(0.999)), false);
  assert.equal(conditionMatches({ type: "between", a: 1, b: 10 }, ctx(10.001)), false);
});

test("AUDIT: a blank cell never matches a number rule", () => {
  assert.equal(conditionMatches({ type: "greaterThan", value: -1 }, ctx(BLANK)), false);
  assert.equal(conditionMatches({ type: "between", a: -1, b: 1 }, ctx(BLANK)), false);
});

test("AUDIT: equalTo compares numbers exactly, and text by display ignoring case", () => {
  assert.equal(conditionMatches({ type: "equalTo", value: 42 }, ctx(42)), true);
  assert.equal(conditionMatches({ type: "equalTo", value: 42 }, ctx(42.0001)), false);
  // A text-form value against a numeric cell matches through the display text.
  assert.equal(conditionMatches({ type: "equalTo", value: "150" }, ctx(150)), true);
  assert.equal(conditionMatches({ type: "equalTo", value: "YES" }, ctx("yes")), true);
});

test("AUDIT: textContains matches the displayed text of numeric cells, ignoring case", () => {
  assert.equal(conditionMatches({ type: "textContains", value: "50" }, ctx(1500)), true);
  assert.equal(conditionMatches({ type: "textContains", value: "err" }, ctx("CHERRY")), true);
  assert.equal(conditionMatches({ type: "textContains", value: "ERR" }, ctx("cherry")), true);
  assert.equal(conditionMatches({ type: "textContains", value: "zz" }, ctx("cherry")), false);
});

test("AUDIT: customFormula matches only a truthy result and survives errors", () => {
  const cf = { type: "customFormula" as const, formula: "=A1>0" };
  assert.equal(conditionMatches(cf, ctx(0, { evalCustom: () => 2 })), true, "a non-zero number is truthy");
  assert.equal(conditionMatches(cf, ctx(0, { evalCustom: () => 0 })), false);
  assert.equal(conditionMatches(cf, ctx(0, { evalCustom: () => "abc" })), false, "non-boolean text is not a match");
  assert.equal(conditionMatches(cf, ctx(0, { evalCustom: () => VALUE })), false, "an error never matches");
});

test("AUDIT: duplicateValueSet counts across the whole 2-D range", () => {
  const range: Rect = { top: 0, left: 0, bottom: 1, right: 1 };
  const grid = [
    ["x", "y"],
    ["y", "x"],
  ];
  const dups = duplicateValueSet(range, (r, c) => grid[r][c]);
  assert.deepEqual([...dups].sort(), ["x", "y"], "repeats across columns count");
});

test("AUDIT: blanks are never duplicates of each other", () => {
  const range: Rect = { top: 0, left: 0, bottom: 2, right: 0 };
  const col = ["", "", "a"];
  const dups = duplicateValueSet(range, (r) => col[r]);
  assert.equal(dups.size, 0);
});

test("AUDIT: duplicate detection ignores case, like every other text comparison", () => {
  // Excel's Duplicate Values rule is case-insensitive ("Apple" and "apple" are
  // flagged), and so is every other text comparison in this module (equalTo,
  // textContains). duplicateValueSet counts on the lowercased key and returns
  // every original casing, so a plain `set.has(display)` membership test flags
  // both cells without lowering anything itself.
  const range: Rect = { top: 0, left: 0, bottom: 1, right: 0 };
  const col = ["Apple", "apple"];
  const dups = duplicateValueSet(range, (r) => col[r]);
  assert.equal(dups.size > 0, true, "a cross-case repeat is a duplicate");
  assert.equal(dups.has("Apple") && dups.has("apple"), true, "both casings are flagged");
});

test("AUDIT: rangeContains includes all four corners and nothing beyond them", () => {
  const range: Rect = { top: 1, left: 1, bottom: 3, right: 2 };
  for (const [r, c] of [[1, 1], [1, 2], [3, 1], [3, 2]] as const) {
    assert.equal(rangeContains(range, r, c), true, `corner ${r},${c}`);
  }
  assert.equal(rangeContains(range, 0, 1), false);
  assert.equal(rangeContains(range, 4, 1), false);
  assert.equal(rangeContains(range, 2, 0), false);
  assert.equal(rangeContains(range, 2, 3), false);
});
