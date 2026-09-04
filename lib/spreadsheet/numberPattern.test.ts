import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTextWithPattern, formatWithPattern, patternProblem } from "./numberPattern";

test("digits, grouping and decimals", () => {
  assert.equal(formatWithPattern(1234.5, "#,##0.00"), "1,234.50");
  assert.equal(formatWithPattern(1234.5, "0"), "1235");
  assert.equal(formatWithPattern(0.5, "#.##"), ".5");
  assert.equal(formatWithPattern(0.5, "0.##"), "0.5");
  assert.equal(formatWithPattern(7, "0000"), "0007");
  assert.equal(formatWithPattern(1234567, "#,##0"), "1,234,567");
  assert.equal(formatWithPattern(-1234.5, "#,##0.00"), "-1,234.50");
  assert.equal(formatWithPattern(12.345, "0.0"), "12.3");
});

test("sections: negatives in brackets, zero as a dash, text", () => {
  const p = "#,##0;(#,##0);\"-\"";
  assert.equal(formatWithPattern(1500, p), "1,500");
  assert.equal(formatWithPattern(-1500, p), "(1,500)");
  assert.equal(formatWithPattern(0, p), "-");
  assert.equal(formatTextWithPattern("Ada", "0;0;0;\"Hello \"@"), "Hello Ada");
  assert.equal(formatTextWithPattern("Ada", "0"), "Ada");
});

test("percent, scaling by thousands, scientific and literals", () => {
  assert.equal(formatWithPattern(0.256, "0.0%"), "25.6%");
  assert.equal(formatWithPattern(1234567, "#,##0,\"K\""), "1,235K");
  assert.equal(formatWithPattern(1234567, "0.00E+00"), "1.23E+06");
  assert.equal(formatWithPattern(0.00012, "0.0E+00"), "1.2E-04");
  assert.equal(formatWithPattern(42, "₹#,##0.00"), "₹42.00");
  assert.equal(formatWithPattern(42, "#,##0.00 €"), "42.00 €");
  assert.equal(formatWithPattern(5, "\"Qty: \"0 \"pcs\""), "Qty: 5 pcs");
  assert.equal(formatWithPattern(5, "[Red]0"), "5", "colour tags are ignored");
  assert.equal(formatWithPattern(5, "[$₹-4009]0"), "₹5", "a currency tag yields its symbol");
});

test("dates and times from serials", () => {
  const serial = 46269 + 0.5625; // 2026-09-04 13:30
  assert.equal(formatWithPattern(serial, "yyyy-mm-dd"), "2026-09-04");
  assert.equal(formatWithPattern(serial, "d mmm yyyy"), "4 Sep 2026");
  assert.equal(formatWithPattern(serial, "dddd, d mmmm yyyy"), "Friday, 4 September 2026");
  assert.equal(formatWithPattern(serial, "dd/mm/yy"), "04/09/26");
  assert.equal(formatWithPattern(serial, "hh:mm"), "13:30");
  assert.equal(formatWithPattern(serial, "h:mm AM/PM"), "1:30 PM");
  assert.equal(formatWithPattern(serial, "hh:mm:ss"), "13:30:00");
  assert.equal(formatWithPattern(1.5, "[h]:mm"), "36:00", "elapsed hours past a day");
  assert.equal(formatWithPattern(serial, "mmmmm"), "S");
});

test("General and bad patterns fall back rather than hide the number", () => {
  assert.equal(formatWithPattern(1234.5678, "General"), "1234.5678");
  assert.equal(formatWithPattern(3, ""), "3");
  assert.equal(formatWithPattern(3, "\"open"), "3");
  assert.equal(formatWithPattern(Infinity, "0"), "#NUM!");
  assert.equal(patternProblem(""), "Type a format, such as #,##0.00 or dd/mm/yyyy.");
  assert.equal(patternProblem("0;0;0;0;0"), "A format has at most four parts separated by semicolons.");
  assert.equal(patternProblem("#,##0.00"), null);
});
