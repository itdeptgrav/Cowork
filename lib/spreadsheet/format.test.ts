import assert from "node:assert/strict";
import { test } from "node:test";
import { formatNumber } from "@/lib/spreadsheet/formula";
import { defaultAlign, formatValue, resolveAlign } from "@/lib/spreadsheet/format";

test("automatic defers to the engine's own number formatting", () => {
  assert.equal(formatValue(3.14), formatNumber(3.14));
  assert.equal(formatValue(1000, { kind: "automatic" }), formatNumber(1000));
});

test("number: grouped digits with fixed decimals (default 2)", () => {
  assert.equal(formatValue(1234.5, { kind: "number" }), "1,234.50");
  assert.equal(formatValue(1234567.891, { kind: "number", decimals: 2 }), "1,234,567.89");
  assert.equal(formatValue(1234.5, { kind: "number", decimals: 0 }), "1,235");
});

test("currency: symbol before the grouped amount, sign outside", () => {
  assert.equal(formatValue(1234.5, { kind: "currency" }), "$1,234.50");
  assert.equal(formatValue(1234.5, { kind: "currency", currency: "€" }), "€1,234.50");
  assert.equal(formatValue(-5, { kind: "currency" }), "-$5.00");
});

test("percent: scales by 100 and appends %", () => {
  assert.equal(formatValue(0.1234, { kind: "percent" }), "12.34%");
  assert.equal(formatValue(0.1234, { kind: "percent", decimals: 0 }), "12%");
  assert.equal(formatValue(1, { kind: "percent", decimals: 0 }), "100%");
});

test("scientific: exponential with an uppercase E", () => {
  assert.equal(formatValue(12345, { kind: "scientific" }), "1.23E+4");
  assert.equal(formatValue(0.0015, { kind: "scientific", decimals: 1 }), "1.5E-3");
});

test("date/time/datetime read a serial number as a UTC date", () => {
  // 25569 = 1970-01-01; the fraction is the time of day.
  assert.equal(formatValue(25569, { kind: "date" }), "1970-01-01");
  assert.equal(formatValue(25569.5, { kind: "time" }), "12:00:00");
  assert.equal(formatValue(25569.5, { kind: "datetime" }), "1970-01-01 12:00:00");
});

test("a number format leaves non-numbers alone", () => {
  assert.equal(formatValue("hello", { kind: "number" }), "hello");
  assert.equal(formatValue(true, { kind: "currency" }), "TRUE");
});

test("defaultAlign follows the value type", () => {
  assert.equal(defaultAlign(5), "right");
  assert.equal(defaultAlign("x"), "left");
  assert.equal(defaultAlign(true), "center");
});

test("resolveAlign: an explicit style wins, else the value default", () => {
  assert.equal(resolveAlign(5, {}), "right");
  assert.equal(resolveAlign(5, { align: "left" }), "left");
  assert.equal(resolveAlign("x", { align: "center" }), "center");
});

test("accounting puts the symbol left, brackets negatives and dashes zero", () => {
  const f = { kind: "accounting" as const, decimals: 2 };
  assert.equal(formatValue(1234.5, f), "$ 1,234.50");
  assert.equal(formatValue(-1234.5, f), "$ (1,234.50)");
  assert.equal(formatValue(0, f), "$ -");
});

test("fraction gives the nearest readable mixed number", () => {
  const f = { kind: "fraction" as const };
  assert.equal(formatValue(2.25, f), "2 1/4");
  assert.equal(formatValue(0.5, f), "1/2");
  assert.equal(formatValue(-1.75, f), "-1 3/4");
  assert.equal(formatValue(3, f), "3", "a whole number keeps no fraction");
});

test("long date spells the month out; short date does not", () => {
  // Serial 1 is the epoch this module counts from; compare the two shapes.
  const long = formatValue(45000, { kind: "longDate" as const });
  const short = formatValue(45000, { kind: "shortDate" as const });
  assert.match(long, /[A-Za-z]{3,}/, "long date names the month");
  assert.notEqual(long, short);
});

test("text shows the number as it reads, ungrouped", () => {
  assert.equal(formatValue(1234567, { kind: "text" as const }), "1234567");
});
