import assert from "node:assert/strict";
import { test } from "node:test";
import { BLANK, type ScalarValue } from "@/lib/spreadsheet/formula/value";
import {
  conditionMatches,
  duplicateValueSet,
  rangeContains,
  type CondCondition,
  type CondContext,
} from "@/lib/spreadsheet/conditional";
import type { Rect } from "@/lib/spreadsheet/coordinates";

function ctx(value: ScalarValue, opts: Partial<CondContext> = {}): CondContext {
  return {
    value,
    display: typeof value === "string" ? value : String(value),
    isDuplicate: false,
    evalCustom: () => BLANK,
    ...opts,
  };
}

test("greaterThan / lessThan / between (numbers only)", () => {
  const gt: CondCondition = { type: "greaterThan", value: 100 };
  assert.equal(conditionMatches(gt, ctx(150)), true);
  assert.equal(conditionMatches(gt, ctx(50)), false);
  assert.equal(conditionMatches(gt, ctx("text")), false); // not a number
  assert.equal(conditionMatches({ type: "lessThan", value: 10 }, ctx(5)), true);
  assert.equal(conditionMatches({ type: "between", a: 1, b: 10 }, ctx(5)), true);
  assert.equal(conditionMatches({ type: "between", a: 1, b: 10 }, ctx(50)), false);
});

test("equalTo matches numbers or text", () => {
  assert.equal(conditionMatches({ type: "equalTo", value: 42 }, ctx(42)), true);
  assert.equal(conditionMatches({ type: "equalTo", value: "Yes" }, ctx("yes")), true); // case-insensitive
  assert.equal(conditionMatches({ type: "equalTo", value: "Yes" }, ctx("no")), false);
});

test("textContains", () => {
  assert.equal(conditionMatches({ type: "textContains", value: "err" }, ctx("cherry")), true);
  assert.equal(conditionMatches({ type: "textContains", value: "err" }, ctx("apple")), false);
});

test("duplicateValues uses the precomputed duplicate set", () => {
  const dup: CondCondition = { type: "duplicateValues" };
  assert.equal(conditionMatches(dup, ctx("x", { isDuplicate: true })), true);
  assert.equal(conditionMatches(dup, ctx("y", { isDuplicate: false })), false);
});

test("customFormula matches when the bound formula is truthy", () => {
  const cf: CondCondition = { type: "customFormula", formula: "=A1>0" };
  assert.equal(conditionMatches(cf, ctx(0, { evalCustom: () => true })), true);
  assert.equal(conditionMatches(cf, ctx(0, { evalCustom: () => false })), false);
});

test("duplicateValueSet finds repeated non-blank displayed values", () => {
  const range: Rect = { top: 0, left: 0, bottom: 3, right: 0 };
  const display = ["a", "b", "a", ""]; // row-indexed
  const dups = duplicateValueSet(range, (r) => display[r]);
  assert.deepEqual([...dups], ["a"]); // "a" twice; "b" once; blank ignored
});

test("rangeContains", () => {
  const range: Rect = { top: 0, left: 0, bottom: 99, right: 0 };
  assert.equal(rangeContains(range, 50, 0), true);
  assert.equal(rangeContains(range, 50, 1), false);
});
