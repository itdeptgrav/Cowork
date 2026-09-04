import assert from "node:assert/strict";
import { test } from "node:test";
import { conditionMatches, isVisualCondition } from "./conditional";
import { colorScaleColor, dataBarFraction, fractionOf, mixHex, parseHex, rangeNumbers } from "./conditionalVisual";
import { BLANK } from "./formula/value";

test("hex colours mix linearly, in both short and long forms", () => {
  assert.deepEqual(parseHex("#fff"), [255, 255, 255]);
  assert.deepEqual(parseHex("57bb8a"), [87, 187, 138]);
  assert.deepEqual(parseHex("nope"), [128, 128, 128]);
  assert.equal(mixHex("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mixHex("#000000", "#ffffff", 2), "#ffffff", "clamped");
});

test("a colour scale places a value between its stops by the range's spread", () => {
  const range = { min: 0, max: 100 };
  assert.equal(fractionOf(25, range), 0.25);
  assert.equal(fractionOf(5, { min: 5, max: 5 }), 0.5, "a flat range is the middle");
  assert.equal(colorScaleColor(0, range, { min: "#ffffff", max: "#000000" }), "#ffffff");
  assert.equal(colorScaleColor(100, range, { min: "#ffffff", max: "#000000" }), "#000000");
  assert.equal(colorScaleColor(50, range, { min: "#ff0000", mid: "#ffffff", max: "#00ff00" }), "#ffffff");
  assert.equal(colorScaleColor(75, range, { min: "#ff0000", mid: "#ffffff", max: "#00ff00" }), "#80ff80");
});

test("a data bar is the value's share of the largest positive value", () => {
  assert.equal(dataBarFraction(50, { min: 0, max: 200 }), 0.25);
  assert.equal(dataBarFraction(-5, { min: -10, max: 200 }), 0, "negatives draw nothing");
  assert.equal(dataBarFraction(5, { min: -10, max: -1 }), 0, "no positive maximum, no bar");
  assert.equal(dataBarFraction(300, { min: 0, max: 200 }), 1);
});

test("range numbers ignore text, blanks and errors", () => {
  assert.deepEqual(rangeNumbers([3, "x", BLANK, -2, 10]), { min: -2, max: 10 });
  assert.equal(rangeNumbers(["a", BLANK]), null);
});

test("the newer boolean conditions match the way their labels read", () => {
  const ctx = (value: number | string, display = String(value)) => ({ value, display, isDuplicate: false, evalCustom: () => BLANK });
  assert.equal(conditionMatches({ type: "notEqualTo", value: 5 }, ctx(4)), true);
  assert.equal(conditionMatches({ type: "notEqualTo", value: "done" }, ctx("Done")), false);
  assert.equal(conditionMatches({ type: "greaterOrEqual", value: 5 }, ctx(5)), true);
  assert.equal(conditionMatches({ type: "lessOrEqual", value: 5 }, ctx(6)), false);
  assert.equal(conditionMatches({ type: "textStartsWith", value: "ab" }, ctx("Abc")), true);
  assert.equal(conditionMatches({ type: "textEndsWith", value: "bc" }, ctx("abc")), true);
  assert.equal(conditionMatches({ type: "textStartsWith", value: "" }, ctx("abc")), false, "an empty prefix matches nothing");
  assert.equal(conditionMatches({ type: "isEmpty" }, ctx("", "")), true);
  assert.equal(conditionMatches({ type: "isNotEmpty" }, ctx("x")), true);
  assert.equal(conditionMatches({ type: "colorScale", min: "#fff", max: "#000" }, ctx(3)), false, "visual rules never match as a style");
  assert.equal(isVisualCondition({ type: "dataBar", color: "#000" }), true);
  assert.equal(isVisualCondition({ type: "isEmpty" }), false);
});
