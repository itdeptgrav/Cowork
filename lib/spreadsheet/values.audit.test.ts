/**
 * Values audit — what a raw typed string is read as.
 *
 * The module's documented grammar is deliberately narrower than Excel's input
 * parsing: plain decimals (with sign/exponent), TRUE/FALSE, "=" formulas, and
 * everything else text. Within that grammar the classification must be exact —
 * a near-number read as a number would right-align and later sum as data.
 * Percent/currency/fraction/date coercion and the leading-apostrophe escape are
 * out of the documented scope (see the judgement calls in the audit report).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { displayAlign, displayValue, interpret, isFormula } from "@/lib/spreadsheet/values";

test("AUDIT: every plain-decimal spelling is a number, with its exact value", () => {
  const cases: [string, number][] = [
    ["1.5", 1.5],
    ["-3", -3],
    ["+5", 5],
    [".5", 0.5],
    ["-.5", -0.5],
    ["1.", 1],
    ["007", 7],       // leading zeros do not make text
    ["1e3", 1000],
    ["1E3", 1000],
    ["1.5e-2", 0.015],
    ["2e+2", 200],
    ["0", 0],
    ["-0", -0],
    [" 42 ", 42],     // surrounding whitespace is trimmed for typing
  ];
  for (const [raw, value] of cases) {
    assert.deepEqual(interpret(raw), { kind: "number", number: value }, JSON.stringify(raw));
  }
});

test("AUDIT: near-numbers stay text — never a silently wrong number", () => {
  const nearNumbers = [
    "1/2",     // fraction — text in this grammar (no date/fraction coercion)
    "50%",     // percent — not coerced
    "$5",      // currency — not coerced
    "1,000",   // thousands separator — not coerced
    "(5)",     // accounting negative — not coerced
    "1a",
    "a1",
    "- 5",     // interior space breaks the sign
    "--5",
    "1.2.3",
    ".",
    "..",
    "1e",      // dangling exponent
    "e3",
    "1e1.5",   // fractional exponent is not a decimal
    "0x10",    // hex is not spreadsheet input
    "Infinity",
    "NaN",
    "1e999",   // overflows the double — must not become Infinity
  ];
  for (const raw of nearNumbers) {
    assert.equal(interpret(raw).kind, "text", `interpret(${JSON.stringify(raw)})`);
  }
});

test("AUDIT: TRUE/FALSE in any case and padding are booleans; near-misses are not", () => {
  assert.deepEqual(interpret("TRUE"), { kind: "boolean", boolean: true });
  assert.deepEqual(interpret("false"), { kind: "boolean", boolean: false });
  assert.deepEqual(interpret("  True  "), { kind: "boolean", boolean: true });
  assert.equal(interpret("TRUEE").kind, "text");
  assert.equal(interpret("TRUE!").kind, "text");
  assert.equal(interpret("T").kind, "text");
});

test("AUDIT: '=' wins over everything — '=1' and even a lone '=' are formulas", () => {
  assert.deepEqual(interpret("=1"), { kind: "formula", source: "=1" });
  assert.deepEqual(interpret("=TRUE"), { kind: "formula", source: "=TRUE" });
  assert.equal(interpret("=").kind, "formula", "a lone '=' routes to the formula branch");
  assert.equal(isFormula(" =A1"), false, "a leading space makes text, as in Excel");
  assert.equal(interpret(" =A1").kind, "text");
});

test("AUDIT: empty is empty; whitespace-only is text, not empty", () => {
  assert.deepEqual(interpret(""), { kind: "empty" });
  // A cell holding only spaces was still typed into — it is content.
  assert.equal(interpret("   ").kind, "text");
});

test("AUDIT: the leading apostrophe is NOT an escape in this grammar", () => {
  /* Documented scope: raw strings are stored verbatim and there is no
     apostrophe-forces-text convention. "'123" is therefore text whose TEXT
     KEEPS the apostrophe (Excel would hide it). Recorded as a judgement call,
     asserted here so a future change to apostrophe handling shows up. */
  assert.deepEqual(interpret("'123"), { kind: "text", text: "'123" });
  assert.equal(displayValue("'123"), "'123");
});

test("AUDIT: displayValue is the raw string for every kind (pre-engine phase)", () => {
  for (const raw of ["42", "hello", "TRUE", "=A1+B1", "", "  "]) {
    assert.equal(displayValue(raw), raw);
  }
});

test("AUDIT: alignment follows the interpreted type exactly", () => {
  assert.equal(displayAlign("42"), "right");
  assert.equal(displayAlign("-0.5"), "right");
  assert.equal(displayAlign("1e3"), "right");
  assert.equal(displayAlign("TRUE"), "center");
  assert.equal(displayAlign("false"), "center");
  assert.equal(displayAlign("hello"), "left");
  assert.equal(displayAlign("50%"), "left", "unparsed percent aligns as text");
  assert.equal(displayAlign("=A1"), "left");
  assert.equal(displayAlign(""), "left");
});
