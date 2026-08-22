/**
 * Evaluator audit — cross-type comparison, blank coercion, concatenation and
 * numeric edge behaviour, asserted against Google Sheets / Excel semantics.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula, evalWith } from "@/lib/spreadsheet/formula/functions/_harness";

/* ── Comparison across types ──────────────────────────────────────────────── */

test("AUDIT: cross-type ordering is number < text < boolean", () => {
  assert.equal(evalFormula('=2<"1"'), "TRUE", "any number is below any text");
  assert.equal(evalFormula('="a"<TRUE'), "TRUE", "any text is below any boolean");
  assert.equal(evalFormula("=FALSE>100"), "TRUE", "even FALSE outranks a number");
  assert.equal(evalFormula('="10"=10'), "FALSE", "text never equals a number under =");
  assert.equal(evalFormula("=TRUE=1"), "FALSE", "a boolean never equals a number under =");
  assert.equal(evalFormula("=TRUE>FALSE"), "TRUE");
});

test("AUDIT: text comparison is case-insensitive", () => {
  assert.equal(evalFormula('="a"="A"'), "TRUE");
  assert.equal(evalFormula('="A"<="a"'), "TRUE", "equal case-insensitively");
  assert.equal(evalFormula('="apple"<"banana"'), "TRUE");
  assert.equal(evalFormula('="2">"10"'), "TRUE", "text compares lexically, not numerically");
});

test("AUDIT: a blank takes the other side's type in a comparison", () => {
  // B9 is never set, so it is a true blank.
  assert.equal(evalFormula("=B9=0"), "TRUE");
  assert.equal(evalFormula('=B9=""'), "TRUE");
  assert.equal(evalFormula("=B9=FALSE"), "TRUE");
  assert.equal(evalFormula("=B9<1"), "TRUE");
  assert.equal(evalFormula("=B9=C9"), "TRUE", "blank equals blank");
});

/* ── Arithmetic coercion ──────────────────────────────────────────────────── */

test("AUDIT: numeric text and booleans coerce in arithmetic", () => {
  assert.equal(evalFormula('="5"+2'), "7");
  assert.equal(evalFormula('=" 5 "+1'), "6", "surrounding spaces are tolerated");
  assert.equal(evalFormula('="a"+1'), "#VALUE!");
  assert.equal(evalFormula("=TRUE+TRUE"), "2");
  assert.equal(evalWith("=A1+1", { A1: "TRUE" }), "2", "a boolean cell coerces too");
});

test("AUDIT: division and exponent error cases", () => {
  assert.equal(evalFormula("=1/0"), "#DIV/0!");
  assert.equal(evalFormula("=0/0"), "#DIV/0!");
  assert.equal(evalFormula("=2^1024"), "#NUM!", "an overflowing power is #NUM!");
});

test("AUDIT: overflow in + - * is a #NUM! error, not an Infinity value", () => {
  assert.equal(evalFormula("=1E308*10"), "#NUM!");
  // The VALUE is a real error, not a coincidence of display — so IFERROR can
  // catch it and a comparison propagates it, as in Sheets.
  assert.equal(evalFormula('=IFERROR(1E308*10,"caught")'), "caught");
  assert.equal(evalFormula("=(1E308*10)>0"), "#NUM!");
});

test("AUDIT: unary plus is an identity, not a numeric coercion", () => {
  assert.equal(evalFormula('=-"5"'), "-5", "unary minus does coerce numeric text");
  // Sheets/Excel define unary + as a no-op that returns its operand untouched.
  assert.equal(evalFormula('=+"abc"'), "abc");
  assert.equal(evalFormula("=+TRUE"), "TRUE");
});

/* ── Concatenation ────────────────────────────────────────────────────────── */

test("AUDIT: the & operator concatenates, as in every spreadsheet", () => {
  // Sheets/Excel: & is a core operator — blank → "", numbers/booleans via
  // their display text.
  assert.equal(evalFormula('="a"&"b"'), "ab");
  assert.equal(evalFormula("=1&2"), "12");
  assert.equal(evalFormula('=A9&"x"'), "x", "a blank concatenates as empty text");
  assert.equal(evalFormula("=TRUE&1"), "TRUE1");
  assert.equal(evalFormula('="Total: "&SUM(1,2)'), "Total: 3");
});

test("AUDIT: CONCATENATE coerces blanks, numbers and booleans like Sheets", () => {
  assert.equal(evalFormula('=CONCATENATE("a",B9,1,TRUE)'), "a1TRUE");
});

/* ── Error propagation ────────────────────────────────────────────────────── */

test("AUDIT: the left operand's error wins, and errors cross comparisons", () => {
  assert.equal(evalFormula("=1/0+#N/A"), "#DIV/0!", "left-to-right evaluation");
  assert.equal(evalFormula("=#N/A+1/0"), "#N/A");
  assert.equal(evalFormula("=1=1/0"), "#DIV/0!", "comparison propagates an operand error");
  assert.equal(evalFormula("=(1/0)%"), "#DIV/0!", "percent propagates");
  assert.equal(evalFormula("=-(1/0)"), "#DIV/0!", "unary propagates");
});

test("AUDIT: error literals are first-class values", () => {
  assert.equal(evalFormula("=#N/A"), "#N/A");
  assert.equal(evalFormula("=#DIV/0!"), "#DIV/0!");
  assert.equal(evalFormula("=IFERROR(#N/A,5)"), "5");
  assert.equal(evalFormula("=#REF!+1"), "#REF!");
});
