/**
 * Data-validation audit, part 2 — the ground validation.audit.test.ts does not
 * cover: degenerate operator forms (a missing second bound), date ranges at
 * their endpoints, custom-formula truthiness and error handling, trim/case
 * normalisation in list and unique rules, pattern flags, and which rule wins
 * when validations overlap.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { BLANK, type ScalarValue } from "@/lib/spreadsheet/formula/value";
import { VALUE } from "@/lib/spreadsheet/formula/errors";
import {
  validateValue,
  validationAt,
  type Validation,
  type ValidationRule,
} from "@/lib/spreadsheet/validation";

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

test("AUDIT2: between with no second bound degenerates to 'equal to a'", () => {
  const between: ValidationRule = { kind: "number", op: "between", a: 5 };
  assert.equal(ok(between, "5"), true);
  assert.equal(ok(between, "4"), false);
  assert.equal(ok(between, "6"), false);
  const not: ValidationRule = { kind: "number", op: "notBetween", a: 5 };
  assert.equal(ok(not, "5"), false);
  assert.equal(ok(not, "6"), true);
});

test("AUDIT2: a date between rule is inclusive at both serial endpoints", () => {
  const rule: ValidationRule = { kind: "date", op: "between", a: 45000, b: 45031 };
  assert.equal(ok(rule, "45000"), true, "the first day of the window is in");
  assert.equal(ok(rule, "45031"), true, "so is the last");
  assert.equal(ok(rule, "44999"), false);
  assert.equal(ok(rule, "45032"), false);
});

test("AUDIT2: a number rule with no bound compares against 0", () => {
  const rule: ValidationRule = { kind: "number", op: ">" };
  assert.equal(ok(rule, "1"), true);
  assert.equal(ok(rule, "0"), false);
  assert.equal(ok(rule, "-1"), false);
});

test("AUDIT2: custom formulas pass on truthy numbers and fail on text or errors", () => {
  const rule: ValidationRule = { kind: "custom", formula: "=whatever" };
  const withResult = (result: ScalarValue) =>
    validateValue(rule, "5", interpret, () => result);
  assert.equal(withResult(true), true);
  assert.equal(withResult(1), true, "a non-zero number coerces to TRUE");
  assert.equal(withResult(0), false);
  assert.equal(withResult(false), false);
  assert.equal(withResult("abc"), false, "text that is not TRUE/FALSE is a failure, not a crash");
  assert.equal(withResult(VALUE), false, "an error result rejects the entry");
});

test("AUDIT2: checkbox tolerates padding around TRUE/FALSE", () => {
  const rule: ValidationRule = { kind: "checkbox" };
  assert.equal(ok(rule, " true "), true);
  assert.equal(ok(rule, "  FALSE"), true);
  assert.equal(ok(rule, "TRUE FALSE"), false);
});

test("AUDIT2: list options are matched trimmed and case-insensitively on BOTH sides", () => {
  const padded: ValidationRule = { kind: "list", values: [" Yes ", "No"] };
  assert.equal(ok(padded, "yes"), true, "the stored option's padding is ignored too");
  assert.equal(ok(padded, " NO "), true);
  assert.equal(ok(padded, "maybe"), false);
});

test("AUDIT2: text length between counts characters inclusively", () => {
  const rule: ValidationRule = { kind: "textLength", op: "between", a: 2, b: 4 };
  assert.equal(ok(rule, "ab"), true);
  assert.equal(ok(rule, "abcd"), true);
  assert.equal(ok(rule, "a"), false);
  assert.equal(ok(rule, "abcde"), false);
});

test("AUDIT2: unique compares values trimmed", () => {
  const others = () => [" a ", "b"];
  assert.equal(ok({ kind: "unique" }, "a", { others }), false, "' a ' elsewhere is the same value");
  assert.equal(ok({ kind: "unique" }, "c", { others }), true);
  assert.equal(ok({ kind: "unique", unique: false }, "a", { others }), true, "must-duplicate inverts");
  assert.equal(ok({ kind: "unique", unique: false }, "c", { others }), false);
});

test("AUDIT2: pattern honours its flags", () => {
  const rule: ValidationRule = { kind: "pattern", source: "^abc$", flags: "i" };
  assert.equal(ok(rule, "ABC"), true);
  assert.equal(ok(rule, "abx"), false);
});

test("AUDIT2: validationAt — later rules win on overlap, none on a miss, empty list is none", () => {
  const vals: Validation[] = [
    { range: { top: 0, left: 0, bottom: 9, right: 9 }, rule: { kind: "checkbox" } },
    { range: { top: 5, left: 5, bottom: 9, right: 9 }, rule: { kind: "number", op: "any" } },
  ];
  assert.equal(validationAt(vals, 7, 7)?.rule.kind, "number", "the later, narrower rule wins");
  assert.equal(validationAt(vals, 1, 1)?.rule.kind, "checkbox");
  assert.equal(validationAt(vals, 20, 0), null);
  assert.equal(validationAt([], 0, 0), null);
  assert.equal(validationAt(undefined, 0, 0), null);
});
