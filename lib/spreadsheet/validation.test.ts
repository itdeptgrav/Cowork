import assert from "node:assert/strict";
import { test } from "node:test";
import { BLANK, type ScalarValue } from "@/lib/spreadsheet/formula/value";
import { FormulaEngine } from "@/lib/spreadsheet/formula";
import {
  rejectsInvalid,
  validateValue,
  validationAt,
  type Validation,
  type ValidationRule,
} from "@/lib/spreadsheet/validation";

/** A plain interpreter of a typed value, matching how a cell reads raw text. */
function interpret(raw: string): ScalarValue {
  const t = raw.trim();
  if (t === "") return BLANK;
  if (/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  const u = t.toUpperCase();
  if (u === "TRUE") return true;
  if (u === "FALSE") return false;
  return raw;
}
const noCustom = () => BLANK;

test("a blank is always allowed", () => {
  assert.equal(validateValue({ kind: "number", op: ">", a: 0 }, "", interpret, noCustom), true);
});

test("list validation accepts only listed values", () => {
  const rule = { kind: "list" as const, values: ["red", "green", "blue"] };
  assert.equal(validateValue(rule, "green", interpret, noCustom), true);
  assert.equal(validateValue(rule, "purple", interpret, noCustom), false);
});

test("checkbox validation accepts only TRUE/FALSE", () => {
  const rule = { kind: "checkbox" } as const;
  assert.equal(validateValue(rule, "TRUE", interpret, noCustom), true);
  assert.equal(validateValue(rule, "false", interpret, noCustom), true);
  assert.equal(validateValue(rule, "maybe", interpret, noCustom), false);
});

test("number validation checks the value and its comparison", () => {
  const between = { kind: "number", op: "between", a: 1, b: 10 } as const;
  assert.equal(validateValue(between, "5", interpret, noCustom), true);
  assert.equal(validateValue(between, "50", interpret, noCustom), false);
  assert.equal(validateValue(between, "abc", interpret, noCustom), false); // not a number
});

test("date validation checks a serial in range", () => {
  const rule = { kind: "date", op: ">=", a: 25569 } as const; // on/after 1970-01-01
  assert.equal(validateValue(rule, "40000", interpret, noCustom), true);
  assert.equal(validateValue(rule, "100", interpret, noCustom), false);
});

test("text validation matches the text rule", () => {
  const rule = { kind: "text", op: "startsWith", value: "AB" } as const;
  assert.equal(validateValue(rule, "abcdef", interpret, noCustom), true);
  assert.equal(validateValue(rule, "xyz", interpret, noCustom), false);
  assert.equal(validateValue(rule, "42", interpret, noCustom), false); // a number is not text
});

test("custom formula validation evaluates against the candidate value", () => {
  const engine = new FormulaEngine();
  engine.setCell("s", 0, 0, "10"); // A1 = 10 (unrelated context cell)
  const rule = { kind: "custom", formula: "=B1>0" } as const;
  // Validating B1 (row 0, col 1): the candidate overrides B1 in the ad-hoc eval.
  const evalWith = (draft: number) => () =>
    engine.evaluateAdHoc("s", rule.formula, [{ row: 0, col: 1, value: draft }]);
  assert.equal(validateValue(rule, "5", interpret, evalWith(5)), true);
  assert.equal(validateValue(rule, "-2", interpret, evalWith(-2)), false);
});

test("validationAt finds the covering rule (last wins on overlap)", () => {
  const vals: Validation[] = [
    { range: { top: 0, left: 0, bottom: 9, right: 9 }, rule: { kind: "checkbox" } },
    { range: { top: 0, left: 0, bottom: 0, right: 0 }, rule: { kind: "number", op: "any" } },
  ];
  assert.equal(validationAt(vals, 0, 0)?.rule.kind, "number"); // more specific, later
  assert.equal(validationAt(vals, 5, 5)?.rule.kind, "checkbox");
  assert.equal(validationAt(vals, 20, 20), null);
});

/* ── Expanded rule set ────────────────────────────────────────────────────── */

const pass = (rule: ValidationRule, raw: string, opts = {}) =>
  validateValue(rule, raw, interpret, () => true, opts);

test("notBetween is the exact inverse of between", () => {
  const between = { kind: "number" as const, op: "between" as const, a: 10, b: 20 };
  const not = { kind: "number" as const, op: "notBetween" as const, a: 10, b: 20 };
  for (const v of ["5", "10", "15", "20", "25"]) {
    assert.notEqual(pass(between, v), pass(not, v), `${v} must differ`);
  }
});

test("text length compares the character count, not the value", () => {
  const rule = { kind: "textLength" as const, op: ">=" as const, a: 3 };
  assert.equal(pass(rule, "ab"), false);
  assert.equal(pass(rule, "abc"), true);
  assert.equal(pass(rule, "12"), false, "a number is judged on its digits");
});

test("not-startsWith and not-endsWith invert their positives", () => {
  const starts = { kind: "text" as const, op: "startsWith" as const, value: "ab" };
  const notStarts = { kind: "text" as const, op: "notStartsWith" as const, value: "ab" };
  assert.equal(pass(starts, "abc"), true);
  assert.equal(pass(notStarts, "abc"), false);
  assert.equal(pass(notStarts, "xyz"), true);
});

test("pattern matches, inverts, and survives an unparseable expression", () => {
  assert.equal(pass({ kind: "pattern", source: "^A[0-9]+$" }, "A42"), true);
  assert.equal(pass({ kind: "pattern", source: "^A[0-9]+$" }, "B42"), false);
  assert.equal(pass({ kind: "pattern", source: "^A", match: false }, "B42"), true);
  assert.equal(pass({ kind: "pattern", source: "([" }, "anything"), false, "a bad regex fails, never throws");
});

test("named text shapes accept the real thing and reject the near-miss", () => {
  const shape = (s: string) => ({ kind: "shape" as const, shape: s as never });
  assert.equal(pass(shape("email"), "a@b.com"), true);
  assert.equal(pass(shape("email"), "a@b"), false);
  assert.equal(pass(shape("url"), "https://x.com/a"), true);
  assert.equal(pass(shape("url"), "not a url"), false);
  assert.equal(pass(shape("phone"), "+44 20 7946 0958"), true);
  assert.equal(pass(shape("phone"), "abc"), false);
  assert.equal(pass(shape("ipv4"), "192.168.1.1"), true);
  assert.equal(pass(shape("ipv4"), "999.1.1.1"), false);
  assert.equal(pass(shape("ipv6"), "2001:0db8:85a3:0000:0000:8a2e:0370:7334"), true);
  assert.equal(pass(shape("alphanumeric"), "abc123"), true);
  assert.equal(pass(shape("alphanumeric"), "abc-123"), false);
  assert.equal(pass(shape("letters"), "abc"), true);
  assert.equal(pass(shape("letters"), "ab1"), false);
  assert.equal(pass(shape("digits"), "123"), true);
  assert.equal(pass(shape("digits"), "12a"), false);
});

test("number shapes constrain sign and integrality", () => {
  const s = (x: string) => ({ kind: "numberShape" as const, shape: x as never });
  assert.equal(pass(s("integer"), "5"), true);
  assert.equal(pass(s("integer"), "5.5"), false);
  assert.equal(pass(s("positive"), "1"), true);
  assert.equal(pass(s("positive"), "0"), false);
  assert.equal(pass(s("nonNegative"), "0"), true);
  assert.equal(pass(s("negative"), "-1"), true);
  assert.equal(pass(s("percentage"), "0.5"), true);
  assert.equal(pass(s("percentage"), "1.5"), false);
  assert.equal(pass(s("integer"), "abc"), false, "text is never a number shape");
});

test("blank rules assert emptiness rather than ignoring it", () => {
  const must = { kind: "blank" as const, mustHaveValue: true };
  const only = { kind: "blank" as const, mustHaveValue: false };
  assert.equal(pass(must, ""), false, "not-blank rejects an empty cell");
  assert.equal(pass(must, "x"), true);
  assert.equal(pass(only, ""), true);
  assert.equal(pass(only, "x"), false, "blank-only rejects a value");
});

test("allowBlank:false makes every other rule reject an empty cell", () => {
  const rule = { kind: "number" as const, op: ">" as const, a: 0 };
  assert.equal(pass(rule, ""), true, "blank passes by default");
  assert.equal(pass(rule, "", { allowBlank: false }), false);
});

test("unique judges against the range, and passes when it has no context", () => {
  const rule = { kind: "unique" as const };
  const others = () => ["a", "b"];
  assert.equal(pass(rule, "c", { others }), true);
  assert.equal(pass(rule, "a", { others }), false);
  assert.equal(pass(rule, "a"), true, "no accessor — the rule cannot judge, so it allows");
  assert.equal(pass({ kind: "unique", unique: false }, "a", { others }), true, "duplicate-only inverts");
  assert.equal(pass({ kind: "unique", unique: false }, "c", { others }), false);
});

test("rejectsInvalid follows the error style", () => {
  const base = { range: { top: 0, left: 0, bottom: 0, right: 0 }, rule: { kind: "blank" as const, mustHaveValue: true } };
  assert.equal(rejectsInvalid(base), true, "stop is the default");
  assert.equal(rejectsInvalid({ ...base, errorStyle: "stop" }), true);
  assert.equal(rejectsInvalid({ ...base, errorStyle: "warning" }), false);
  assert.equal(rejectsInvalid({ ...base, errorStyle: "information" }), false);
});
