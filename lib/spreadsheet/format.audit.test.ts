/**
 * Number-format audit — every `NumberFormatKind` the ribbon offers, exercised
 * at its boundaries against real-spreadsheet (Excel / Google Sheets) semantics.
 *
 * The ribbon (HomeTab.tsx NUMBER_FORMATS) exposes: automatic, number, currency,
 * accounting, percent, fraction, scientific, shortDate, longDate, time,
 * datetime, text — plus the $ / % / , buttons and the two decimal steppers.
 * These tests drive `formatValue` through all of them with zeros, negatives,
 * grouping magnitudes, extreme decimals, non-finite values and date serials.
 *
 * Assertions state CORRECT behaviour. Where the module knowingly diverges from
 * Excel (ISO dates, single-digit exponents, the Google-flavoured epoch) the
 * divergence is asserted as-is and documented. Where behaviour is WRONG, the
 * failing assertion is kept, marked `BUG(<id>)`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultAlign, formatValue, resolveAlign } from "@/lib/spreadsheet/format";
import { BLANK, ArrayValue, formatNumber } from "@/lib/spreadsheet/formula/value";
import { DIV0, NUM } from "@/lib/spreadsheet/formula/errors";
import { interpret } from "@/lib/spreadsheet/values";
import type { NumberFormat } from "@/lib/spreadsheet/style";

const nf = (kind: NumberFormat["kind"], decimals?: number, currency?: string): NumberFormat => ({
  kind,
  ...(decimals !== undefined ? { decimals } : {}),
  ...(currency !== undefined ? { currency } : {}),
});

/* ── Zero through every kind ──────────────────────────────────────────────── */

test("AUDIT: zero renders correctly in every format kind", () => {
  assert.equal(formatValue(0), "0");
  assert.equal(formatValue(0, nf("number")), "0.00");
  assert.equal(formatValue(0, nf("currency")), "$0.00");
  assert.equal(formatValue(0, nf("accounting")), "$ -", "accounting dashes zero");
  assert.equal(formatValue(0, nf("percent")), "0.00%");
  assert.equal(formatValue(0, nf("fraction")), "0");
  assert.equal(formatValue(0, nf("text")), "0");
  /* JS gives a single-digit exponent; Excel pads to two (0.00E+00). Documented
     divergence — the module's own convention, asserted as such. */
  assert.equal(formatValue(0, nf("scientific")), "0.00E+0");
  /* Negative zero must never grow a sign. */
  assert.equal(formatValue(-0, nf("number")), "0.00");
  assert.equal(formatValue(-0, nf("accounting")), "$ -");
});

/* ── Negatives: sign placement per kind ───────────────────────────────────── */

test("AUDIT: negatives — currency signs, accounting parenthesises", () => {
  assert.equal(formatValue(-1234.5, nf("number")), "-1,234.50");
  assert.equal(formatValue(-1234.5, nf("currency")), "-$1,234.50", "sign OUTSIDE the symbol");
  assert.equal(formatValue(-1234.5, nf("currency", 2, "€")), "-€1,234.50");
  assert.equal(formatValue(-1234.5, nf("accounting")), "$ (1,234.50)");
  assert.equal(formatValue(-1, nf("accounting", 2, "₹")), "₹ (1.00)");
  assert.equal(formatValue(-0.125, nf("percent")), "-12.50%");
  assert.equal(formatValue(-2.25, nf("fraction")), "-2 1/4");
  assert.equal(formatValue(-0.5, nf("fraction")), "-1/2", "no whole part, sign kept");
  /* A tiny negative that rounds to zero keeps its sign — matching Excel, which
     shows -0.00 for -0.004 at two decimals (the well-known ledger annoyance). */
  assert.equal(formatValue(-0.004, nf("number")), "-0.00");
  /* ...but accounting only dashes EXACT zero; a rounded-to-zero negative still
     brackets, as Excel's accounting format does. */
  assert.equal(formatValue(-0.004, nf("accounting")), "$ (0.00)");
});

/* ── Thousands separators ─────────────────────────────────────────────────── */

test("AUDIT: grouping at every magnitude boundary", () => {
  assert.equal(formatValue(999.99, nf("number")), "999.99", "no comma below 1000");
  assert.equal(formatValue(1000, nf("number")), "1,000.00");
  assert.equal(formatValue(1234567.891, nf("number")), "1,234,567.89");
  assert.equal(formatValue(1234567.891, nf("currency")), "$1,234,567.89");
  assert.equal(formatValue(1e9, nf("number", 0)), "1,000,000,000");
  /* Percent groups too. Excel's stock 0.00% does NOT group (123456.00%), so
     this is a (cosmetic, documented) divergence, asserted as current. */
  assert.equal(formatValue(50, nf("percent")), "5,000.00%");
});

/* ── Decimals stepping (the ribbon's more/fewer buttons) ──────────────────── */

test("AUDIT: decimal counts step the fixed places, rounding the display only", () => {
  assert.equal(formatValue(1234.5678, nf("number", 0)), "1,235");
  assert.equal(formatValue(1234.5678, nf("number", 1)), "1,234.6");
  assert.equal(formatValue(1234.5678, nf("number", 3)), "1,234.568");
  assert.equal(formatValue(1234.5678, nf("number", 5)), "1,234.56780", "pads with zeros");
  assert.equal(formatValue(1234.5, nf("currency", 0)), "$1,235");
  assert.equal(formatValue(0.123456, nf("percent", 4)), "12.3456%");
  assert.equal(formatValue(12345, nf("scientific", 0)), "1E+4");
  assert.equal(formatValue(12345, nf("scientific", 5)), "1.23450E+4");
  /* Display rounds; the stored value is untouched — the same number at more
     decimals still carries its full precision. */
  assert.equal(formatValue(0.1 + 0.2, nf("number", 1)), "0.3");
  assert.equal(formatValue(0.1 + 0.2, nf("number", 17)), "0.30000000000000004");
});

test("AUDIT: out-of-range decimal counts must not crash the renderer", () => {
  /* The ribbon's "More decimals" button has NO upper clamp (HomeTab.tsx
     stepDecimals: Math.max(0, d + 1) — a floor, no ceiling), so a persistent
     user reaches decimals=101, where a raw Number.toFixed/toExponential would
     throw RangeError. Excel caps decimal places at 30; formatValue clamps
     every count into 0..30 and never throws. */
  assert.doesNotThrow(() => formatValue(1, nf("number", 200)));
  assert.doesNotThrow(() => formatValue(1, nf("scientific", 200)));
  assert.doesNotThrow(() => formatValue(1, nf("number", -1)));
});

/* ── Rounding: display vs stored value ────────────────────────────────────── */

test("AUDIT: half-way cases round away from zero, as spreadsheets do", () => {
  assert.equal(formatValue(0.5, nf("number", 0)), "1");
  assert.equal(formatValue(2.5, nf("number", 0)), "3");
  assert.equal(formatValue(0.125, nf("number", 2)), "0.13");
  assert.equal(formatValue(1234.5, nf("number", 0)), "1,235");
});

test("AUDIT: values that READ as decimal halves round the way Excel shows them", () => {
  /* 1.005 is stored as 1.00499999…; Excel and Google Sheets format from the
     15-significant-digit decimal reading ("1.005") and show 1.01 — as this
     formatter does. A raw JS toFixed would round the exact binary value and
     show 1.00. Same for 2.675 → 2.68. */
  assert.equal(formatValue(1.005, nf("number", 2)), "1.01");
  assert.equal(formatValue(2.675, nf("number", 2)), "2.68");
});

/* ── Non-finite values ────────────────────────────────────────────────────── */

test("AUDIT: non-finite numbers show an error code in every kind, as automatic does", () => {
  /* formatValue guards non-finite input once, before the kind switch, so every
     kind shows "#NUM!" — an Infinity under a currency format must never read
     "$Infinity". (Low reachability: the evaluator turns overflow into #NUM! —
     evaluator.ts:125 — so this is formatValue's own contract holding, not a
     user-visible crash path.) */
  assert.equal(formatValue(Infinity), "#NUM!", "automatic guards");
  assert.equal(formatValue(Infinity, nf("fraction")), "#NUM!", "fraction guards");
  assert.equal(formatValue(Infinity, nf("shortDate")), "#NUM!", "dates guard");
  assert.equal(formatValue(Infinity, nf("text")), "#NUM!", "text guards via formatNumber");
  assert.equal(formatValue(Infinity, nf("number")), "#NUM!");
  assert.equal(formatValue(Infinity, nf("currency")), "#NUM!");
  assert.equal(formatValue(NaN, nf("number")), "#NUM!");
});

/* ── Percent semantics ────────────────────────────────────────────────────── */

test("AUDIT: percent multiplies the stored fraction by 100 for display only", () => {
  /* The spreadsheet convention: applying % to an existing 0.5 SHOWS 50%, the
     stored value stays 0.5. (Excel's type-time reinterpretation of "50" typed
     into a %-formatted cell is an entry feature, not a formatting one.) */
  assert.equal(formatValue(0.5, nf("percent")), "50.00%");
  assert.equal(formatValue(1, nf("percent")), "100.00%");
  assert.equal(formatValue(0.001, nf("percent", 0)), "0%");
  assert.equal(formatValue(2.5, nf("percent", 1)), "250.0%");
  assert.equal(formatValue(0.12345, nf("percent", 3)), "12.345%", "rounds at the shown place");
});

/* ── Fractions ────────────────────────────────────────────────────────────── */

test("AUDIT: fraction picks the closest denominator under 100 (Excel's two digits)", () => {
  assert.equal(formatValue(1 / 3, nf("fraction")), "1/3");
  assert.equal(formatValue(2 / 3, nf("fraction")), "2/3");
  assert.equal(formatValue(0.667, nf("fraction")), "2/3", "approximation, smallest den on ties");
  assert.equal(formatValue(0.24, nf("fraction")), "6/25", "exact when one exists");
  assert.equal(formatValue(0.1, nf("fraction")), "1/10");
  /* π: the best den<100 approximation is 14/99 (better than 22/7) — the same
     answer Excel's "Up to two digits" gives. */
  assert.equal(formatValue(Math.PI, nf("fraction")), "3 14/99");
  /* Residues too small to represent collapse toward the nearest whole. */
  assert.equal(formatValue(5.001, nf("fraction")), "5");
  assert.equal(formatValue(5.999, nf("fraction")), "6", "carries into the whole");
  assert.equal(formatValue(-5.999, nf("fraction")), "-6");
  assert.equal(formatValue(7, nf("fraction")), "7", "integers stay plain");
});

/* ── Date serials ─────────────────────────────────────────────────────────── */

test("AUDIT: the epoch — serial 0 is 1899-12-30, the Google Sheets base", () => {
  /* Sheets: serial 0 = 1899-12-30, 25569 = 1970-01-01. Excel differs by one
     below serial 61 (its phantom 1900-02-29); this module follows Sheets and
     the standard unix anchoring — a documented divergence from Excel only. */
  assert.equal(formatValue(0, nf("shortDate")), "1899-12-30");
  assert.equal(formatValue(1, nf("shortDate")), "1899-12-31");
  assert.equal(formatValue(25569, nf("shortDate")), "1970-01-01");
  assert.equal(formatValue(60, nf("shortDate")), "1900-02-28", "no phantom leap day");
  /* Negative serials render 19th-century dates rather than Excel's #####. A
     defensible choice (Sheets renders them too); asserted as current. */
  assert.equal(formatValue(-1, nf("shortDate")), "1899-12-29");
});

test("AUDIT: shortDate/longDate/time/datetime views of one serial", () => {
  // 45000 = 2023-03-15 in both Excel and Sheets.
  assert.equal(formatValue(45000, nf("shortDate")), "2023-03-15");
  assert.equal(formatValue(45000, nf("longDate")), "15 March 2023");
  assert.equal(formatValue(45000, nf("date")), "2023-03-15", "legacy 'date' = shortDate");
  assert.equal(formatValue(45000.25, nf("time")), "06:00:00");
  assert.equal(formatValue(45000.75, nf("time")), "18:00:00");
  assert.equal(formatValue(45000.25, nf("datetime")), "2023-03-15 06:00:00");
  /* A datetime serial under a DATE format shows only the date — the fraction
     is dropped from view, not rounded into a day. */
  assert.equal(formatValue(45000.9, nf("shortDate")), "2023-03-15");
  /* Sub-second fractions truncate ("23:59:59"), where Excel would round the
     display to 0:00:00. Documented divergence, asserted as current. */
  assert.equal(formatValue(45000 + 86399.6 / 86400, nf("time")), "23:59:59");
});

/* ── Text format ──────────────────────────────────────────────────────────── */

test("AUDIT: text shows the full number, never grouped, rounded or exponent-ed", () => {
  assert.equal(formatValue(1234567.891, nf("text")), "1234567.891");
  assert.equal(formatValue(0.1 + 0.2, nf("text")), "0.3", "engine's noise-trimmed reading");
  assert.equal(formatValue(-42, nf("text")), "-42");
});

test("AUDIT: a Text-formatted cell preserves typed input, leading zeros included", () => {
  /* Real spreadsheets: format a cell as Text FIRST, type "007", and the cell
     shows the literal text "007", left-aligned. The grid does this by routing
     the RAW string around the interpreted value when the cell's format is Text
     (GridBody feeds `raw` — not the engine's number — to display and align for
     non-formula entries). This pins the lib half of that route: a raw string
     under a Text format passes through formatValue untouched and aligns left.
     The engine still interprets "007" as 7, so formulas READING the cell keep
     coercing it — Sheets' own arithmetic does the same. */
  const typed = "007";
  assert.equal(formatValue(typed, nf("text")), "007");
  assert.equal(resolveAlign(typed, { numberFormat: nf("text") }), "left");
  /* And the interpreted number is unchanged for the formula path. */
  const v = interpret(typed);
  assert.equal(v.kind === "number" && v.number, 7);
});

/* ── Automatic (General) guessing ─────────────────────────────────────────── */

test("AUDIT: automatic is the engine's General — ungrouped, noise-trimmed", () => {
  assert.equal(formatValue(1000), "1000", "General never groups");
  assert.equal(formatValue(1234567.891), "1234567.891");
  assert.equal(formatValue(0.30000000000000004), "0.3", "float noise trimmed");
  assert.equal(formatValue(1e21), "1e+21", "extreme magnitude falls back to exponent text");
  assert.equal(formatValue(3.14, nf("automatic")), formatNumber(3.14), "explicit = absent");
});

test("AUDIT: magnitudes past 1e21 degrade to exponent text inside number/currency", () => {
  /* toFixed itself goes exponential at 1e21, so grouping and decimals silently
     stop applying. Excel would show the full grouped digits. Extreme-magnitude
     judgement call, asserted as current so a change is noticed. */
  assert.equal(formatValue(1e21, nf("number")), "1e+21");
  assert.equal(formatValue(1e21, nf("currency")), "$1e+21");
});

/* ── Non-numbers under a number format ────────────────────────────────────── */

test("AUDIT: a number format leaves every non-number untouched", () => {
  assert.equal(formatValue("hello", nf("currency")), "hello");
  assert.equal(formatValue("007", nf("text")), "007", "an actual STRING keeps its zeros");
  assert.equal(formatValue(true, nf("percent")), "TRUE");
  assert.equal(formatValue(false, nf("accounting")), "FALSE");
  assert.equal(formatValue(BLANK, nf("currency")), "", "blank stays blank, not $0.00");
  assert.equal(formatValue(DIV0, nf("number")), "#DIV/0!");
  assert.equal(formatValue(NUM, nf("shortDate")), "#NUM!");
  /* An array formats via its top-left element, like every other read of one. */
  assert.equal(formatValue(new ArrayValue([[1234.5, 9]]), nf("currency")), "$1,234.50");
});

/* ── Alignment defaults under formats ─────────────────────────────────────── */

test("AUDIT: alignment — numbers right, explicit style always wins", () => {
  assert.equal(defaultAlign(1234.5), "right");
  assert.equal(defaultAlign(BLANK), "left");
  assert.equal(defaultAlign(new ArrayValue([[true]])), "center", "array aligns as its first");
  assert.equal(resolveAlign(5, { numberFormat: nf("currency") }), "right");
  assert.equal(resolveAlign(5, { align: "center" }), "center");
});
