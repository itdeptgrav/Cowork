import assert from "node:assert/strict";
import { test } from "node:test";
import {
  interpret,
  displayValue,
  displayAlign,
  isFormula,
} from "@/lib/spreadsheet/values";

test("interpret reads the type of a raw string", () => {
  assert.deepEqual(interpret(""), { kind: "empty" });
  assert.deepEqual(interpret("hello"), { kind: "text", text: "hello" });
  assert.deepEqual(interpret("42"), { kind: "number", number: 42 });
  assert.deepEqual(interpret("-3.5"), { kind: "number", number: -3.5 });
  assert.deepEqual(interpret("1e3"), { kind: "number", number: 1000 });
  assert.deepEqual(interpret("TRUE"), { kind: "boolean", boolean: true });
  assert.deepEqual(interpret("false"), { kind: "boolean", boolean: false });
  assert.deepEqual(interpret("=A1+B1"), { kind: "formula", source: "=A1+B1" });
});

test("interpret does not mistake near-numbers for numbers", () => {
  assert.equal(interpret("1a").kind, "text");
  assert.equal(interpret(".").kind, "text");
  assert.equal(interpret("- 5").kind, "text");
  assert.equal(interpret("007").kind, "number", "leading zeros still numeric");
});

test("a formula starting with = wins over a number", () => {
  assert.equal(isFormula("=1"), true);
  assert.equal(interpret("=1").kind, "formula");
  assert.equal(isFormula("1"), false);
});

test("displayValue is separate from raw but coincides in Phase 2", () => {
  // No calculation yet, so a formula shows its source verbatim.
  assert.equal(displayValue("=A1+B1"), "=A1+B1");
  assert.equal(displayValue("42"), "42");
  assert.equal(displayValue("hello"), "hello");
  assert.equal(displayValue(""), "");
});

test("displayAlign follows the value type", () => {
  assert.equal(displayAlign("42"), "right");
  assert.equal(displayAlign("TRUE"), "center");
  assert.equal(displayAlign("hello"), "left");
  assert.equal(displayAlign("=A1+B1"), "left");
  assert.equal(displayAlign(""), "left");
});
