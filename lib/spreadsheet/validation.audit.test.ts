/**
 * Data-validation audit — boundaries, precision, coercion and consistency.
 *
 * These tests execute the real `validateValue` against the cases a production
 * audit demands: every operator at its boundary, floating-point equality, text
 * case handling, and what happens when a value arrives as the wrong type. They
 * are written to FAIL where behaviour is wrong, not to describe what the code
 * currently does.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { BLANK, type ScalarValue } from "@/lib/spreadsheet/formula/value";
import { validateValue, type CompareOp, type ValidationRule } from "@/lib/spreadsheet/validation";

/** The same interpretation the grid uses: a numeric string is a number. */
function interpret(raw: string): ScalarValue {
  const t = raw.trim();
  if (t === "") return BLANK;
  if (/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  const up = t.toUpperCase();
  if (up === "TRUE") return true;
  if (up === "FALSE") return false;
  return raw;
}

const ok = (rule: ValidationRule, raw: string, opts = {}) =>
  validateValue(rule, raw, interpret, () => true, opts);

const numRule = (op: CompareOp, a: number, b?: number): ValidationRule => ({
  kind: "number",
  op,
  a,
  b,
});

/* ── 4. BOUNDARY TESTING — every operator at its edge ─────────────────────── */

test("AUDIT: number operators at the boundary of 10", () => {
  const cases: [CompareOp, string, boolean][] = [
    // op,      input,        expected
    [">", "9", false], [">", "10", false], [">", "10.000001", true], [">", "11", true],
    [">=", "9", false], [">=", "10", true], [">=", "11", true],
    ["<", "9", true], ["<", "10", false], ["<", "9.999999", true],
    ["<=", "10", true], ["<=", "10.000001", false], ["<=", "9", true],
    ["=", "10", true], ["=", "10.000001", false], ["=", "9", false],
    ["<>", "10", false], ["<>", "9", true],
  ];
  for (const [op, input, expected] of cases) {
    assert.equal(ok(numRule(op, 10), input), expected, `${input} ${op} 10 should be ${expected}`);
  }
});

test("AUDIT: between/notBetween are inclusive and exactly complementary", () => {
  const between = numRule("between", 10, 20);
  const not = numRule("notBetween", 10, 20);
  const cases: [string, boolean][] = [
    ["9.999999", false], ["10", true], ["15", true], ["20", true], ["20.000001", false],
  ];
  for (const [input, expected] of cases) {
    assert.equal(ok(between, input), expected, `between: ${input}`);
    assert.equal(ok(not, input), !expected, `notBetween: ${input}`);
  }
});

test("AUDIT: zero, negatives, very large and very small values", () => {
  assert.equal(ok(numRule(">", 0), "0"), false);
  assert.equal(ok(numRule(">=", 0), "0"), true);
  assert.equal(ok(numRule("<", 0), "-1"), true);
  assert.equal(ok(numRule(">", 0), "1e-300"), true, "a tiny positive is still > 0");
  assert.equal(ok(numRule("<", 1e308), "1e307"), true);
  assert.equal(ok(numRule(">", 10), "1e309"), true, "Infinity compares, does not crash");
});

/* ── 5. DECIMAL PRECISION ─────────────────────────────────────────────────── */

test("AUDIT: equality tolerates floating-point representation error", () => {
  /* 0.1 + 0.2 is 0.30000000000000004 in IEEE-754. A person who computes it in a
     cell and validates "equal to 0.3" means yes. Strict === says no. */
  const sum = 0.1 + 0.2;
  assert.notEqual(sum, 0.3, "precondition: the sum really is not 0.3");
  assert.equal(ok(numRule("=", 0.3), String(sum)), true, "0.1+0.2 must satisfy = 0.3");
});

test("AUDIT: precision tolerance does not swallow genuinely different values", () => {
  assert.equal(ok(numRule("=", 0.3), "0.31"), false);
  assert.equal(ok(numRule("=", 1), "1.0000001"), false, "a real difference is still a difference");
  assert.equal(ok(numRule("=", 1000000), "1000001"), false);
});

test("AUDIT: <= and >= tolerate the same error at their boundary", () => {
  const sum = 0.1 + 0.2; // 0.30000000000000004
  assert.equal(ok(numRule("<=", 0.3), String(sum)), true, "<= 0.3 must accept 0.1+0.2");
  assert.equal(ok(numRule(">=", 0.3), String(sum)), true);
  assert.equal(ok(numRule("between", 0.1, 0.3), String(sum)), true, "between must include it");
});

/* ── 6/7. DATE AND TIME ───────────────────────────────────────────────────── */

test("AUDIT: date rules compare serials numerically, not as strings", () => {
  /* Serial 45000 < 45001. As STRINGS "45000" < "9" would be true, which is the
     bug this guards against. */
  const rule: ValidationRule = { kind: "date", op: ">", a: 9 };
  assert.equal(ok(rule, "45000"), true, "a large serial is after a small one");
});

test("AUDIT: a date rule rejects text that is not a serial", () => {
  const rule: ValidationRule = { kind: "date", op: ">", a: 0 };
  assert.equal(ok(rule, "2024-02-29"), false, "an unparsed date string is not a serial");
});

/* ── 8. TEXT ──────────────────────────────────────────────────────────────── */

test("AUDIT: text matching is case-INSENSITIVE, consistently across operators", () => {
  const contains = { kind: "text" as const, op: "contains" as const, value: "hello" };
  for (const v of ["hello", "Hello", "HELLO", "say HeLLo now"]) {
    assert.equal(ok(contains, v), true, `contains should match ${v}`);
  }
  const equals = { kind: "text" as const, op: "equals" as const, value: "hello" };
  assert.equal(ok(equals, "HELLO"), true, "equals is case-insensitive too");
});

test("AUDIT: text rules handle whitespace, unicode and emoji without crashing", () => {
  const contains = { kind: "text" as const, op: "contains" as const, value: "é" };
  assert.equal(ok(contains, "café"), true);
  const emoji = { kind: "text" as const, op: "contains" as const, value: "🚀" };
  assert.equal(ok(emoji, "to the 🚀 moon"), true);
  const spaces = { kind: "text" as const, op: "equals" as const, value: "hello" };
  assert.equal(ok(spaces, " hello "), false, "surrounding space is a difference");
});

test("AUDIT: a number typed into a text rule is judged as text, not skipped", () => {
  const rule = { kind: "text" as const, op: "contains" as const, value: "1" };
  assert.equal(ok(rule, "123"), true, "digits must be matchable by a text rule");
});

test("AUDIT: text length counts characters of the RAW entry", () => {
  const rule = { kind: "textLength" as const, op: "=" as const, a: 3 };
  assert.equal(ok(rule, "abc"), true);
  assert.equal(ok(rule, "123"), true, "a numeric entry has a length too");
  assert.equal(ok(rule, " a "), true, "whitespace counts");
});

/* ── 9. LIST ──────────────────────────────────────────────────────────────── */

test("AUDIT: list accepts a listed value and rejects an unlisted one", () => {
  const rule = { kind: "list" as const, values: ["Yes", "No"] };
  assert.equal(ok(rule, "Yes"), true);
  assert.equal(ok(rule, "Maybe"), false);
});

test("AUDIT: list matching ignores surrounding whitespace and case", () => {
  const rule = { kind: "list" as const, values: ["Yes", "No"] };
  assert.equal(ok(rule, " Yes "), true, "a pasted value with spaces must still match");
  assert.equal(ok(rule, "yes"), true, "consistent with text rules being case-insensitive");
});

test("AUDIT: list handles numeric and duplicate options", () => {
  const rule = { kind: "list" as const, values: ["1", "2", "2"] };
  assert.equal(ok(rule, "1"), true);
  assert.equal(ok(rule, "2"), true, "a duplicated option still matches");
  assert.equal(ok(rule, "3"), false);
});

/* ── 10. CHECKBOX ─────────────────────────────────────────────────────────── */

test("AUDIT: checkbox accepts both booleans in any case, rejects anything else", () => {
  const rule = { kind: "checkbox" as const };
  for (const v of ["TRUE", "true", "False", "FALSE"]) {
    assert.equal(ok(rule, v), true, `checkbox should accept ${v}`);
  }
  assert.equal(ok(rule, "yes"), false);
  assert.equal(ok(rule, "1"), false);
});

/* ── 16. TYPE COERCION AT THE BOUNDARY ────────────────────────────────────── */

test("AUDIT: a number rule rejects text, a boolean, and an error", () => {
  const rule = numRule(">", 5);
  assert.equal(ok(rule, "abc"), false, "text is not a number");
  assert.equal(ok(rule, "TRUE"), false, "a boolean is not a number");
});

test("AUDIT: blank handling is governed by allowBlank on every rule kind", () => {
  const kinds: ValidationRule[] = [
    numRule(">", 5),
    { kind: "text", op: "contains", value: "x" },
    { kind: "list", values: ["a"] },
    { kind: "shape", shape: "email" },
    { kind: "textLength", op: ">", a: 2 },
  ];
  for (const rule of kinds) {
    assert.equal(ok(rule, ""), true, `${rule.kind}: blank allowed by default`);
    assert.equal(ok(rule, "", { allowBlank: false }), false, `${rule.kind}: blank refused when off`);
    assert.equal(ok(rule, "   ", { allowBlank: false }), false, `${rule.kind}: whitespace is blank`);
  }
});
