/**
 * Value formatting — a computed value plus a number format becomes display text.
 *
 * The engine computes a cell to a `ScalarValue` (a number, boolean, string,
 * blank or error). How that number READS on the sheet — plain, as currency, as a
 * percentage, as a date — is a style concern, not the engine's, so it lives here
 * where the value and the cell's `NumberFormat` meet. `automatic` defers to the
 * engine's own number formatting, so an unstyled sheet looks exactly as it did
 * before Phase 5.
 *
 * Dates follow the spreadsheet convention: a number is a serial day count, with
 * 25569 = 1970-01-01, and the fractional part is the time of day. Formatting
 * reads the date in UTC so it does not drift with the machine's timezone.
 *
 * Fixed-decimal display rounds the number's 15-significant-digit DECIMAL
 * reading — the value Excel and Sheets format from — not the raw binary double,
 * so 1.005 at two decimals shows 1.01 even though the stored double is
 * 1.00499…; asking for more decimals than that reading resolves falls back to
 * the double's own digits. Decimal counts are clamped to 0–30 (Excel's cap) so
 * a runaway count degrades instead of throwing, and a non-finite number shows
 * "#NUM!" under every format kind.
 *
 * Pure and DOM-free.
 */

import { Blank, formatNumber, isArray, type ScalarValue, isRich } from "./formula/value";
import { formatTextWithPattern, formatWithPattern } from "./numberPattern";
import { isError } from "./formula/errors";
import type { CellAlign } from "./values";
import type { CellStyle, NumberFormat } from "./style";

/** The alignment a value takes by default — numbers right, booleans and errors
    centred, text and blanks left. The spreadsheet convention. */
export function defaultAlign(value: ScalarValue): CellAlign {
  if (isArray(value)) return defaultAlign(value.first);
  if (typeof value === "number") return "right";
  if (typeof value === "boolean") return "center";
  if (isError(value)) return "center";
  return "left";
}

/** A cell's alignment: an explicit style wins, otherwise the value's default. */
export function resolveAlign(value: ScalarValue, style: CellStyle): CellAlign {
  return style.align ?? defaultAlign(value);
}

/** Excel's cap on fixed decimal places. `toFixed`/`toExponential` throw a
    RangeError past 100; clamping here keeps every count renderable. */
const MAX_DECIMALS = 30;

/** A decimal count as something the formatters accept — an integer in 0..30.
    Out-of-range and nonsense counts clamp rather than throw, so a cell with a
    runaway format still renders. */
function clampDecimals(d: number): number {
  if (!Number.isFinite(d)) return 0;
  return Math.min(MAX_DECIMALS, Math.max(0, Math.trunc(d)));
}

/**
 * |n| as fixed-decimal digits, rounded from its 15-significant-digit decimal
 * reading (half away from zero) rather than from the raw binary double — the
 * rounding Excel and Sheets display. 1.005 is stored as 1.00499…, but its
 * reading is "1.005", so two decimals show "1.01" where `toFixed` shows "1.00".
 * Falls back to `toFixed` when the reading is exponential (|n| ≥ 1e21 or
 * < 1e-6) or when more decimals are asked for than the reading resolves —
 * there the double's own digits are all there is to show.
 */
function fixedFromReading(abs: number, decimals: number): string {
  const reading = abs.toPrecision(15);
  if (reading.includes("e")) return abs.toFixed(decimals);
  const [intPart, fracPart = ""] = reading.split(".");
  if (decimals >= fracPart.length) return abs.toFixed(decimals);

  const digits = intPart + fracPart; // the decimal point sits after intPart.length
  const keep = intPart.length + decimals;
  let head = digits.slice(0, keep);
  if (digits.charCodeAt(keep) - 48 >= 5) {
    /* Round the kept digits up as a decimal string, carrying rightmost-first;
       an all-9s carry prepends a digit, which grows the integer part by one. */
    const chars = head.split("");
    let i = chars.length - 1;
    while (i >= 0 && chars[i] === "9") {
      chars[i] = "0";
      i -= 1;
    }
    if (i >= 0) chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
    head = (i >= 0 ? "" : "1") + chars.join("");
  }
  const intLen = head.length - decimals;
  const int = head.slice(0, intLen);
  return decimals > 0 ? `${int}.${head.slice(intLen)}` : int;
}

/** A signed number as grouped, fixed-decimal digits — sign and body split so a
    currency symbol can sit between them ("-$1,234.50"). */
function commaFixed(n: number, decimals: number): { neg: boolean; body: string } {
  const neg = n < 0;
  const fixed = fixedFromReading(Math.abs(n), clampDecimals(decimals));
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return { neg, body: grouped + (frac ? `.${frac}` : "") };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** A serial day number to a UTC date. 25569 = 1970-01-01, matching the serials
    spreadsheets exchange. */
function serialToDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86_400_000));
}

const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "14 March 2026" — the long date, spelled out rather than abbreviated. */
function formatLongDate(serial: number): string {
  const d = serialToDate(serial);
  return `${d.getUTCDate()} ${LONG_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The nearest simple fraction, as a mixed number ("2 1/4").
 *
 * Uses a Stern-Brocot search bounded to denominators under 100 — Excel's
 * "up to two digits" fraction — so the result is the closest readable fraction
 * rather than an exact but useless one like 3927/1250.
 */
function formatFraction(n: number): string {
  if (!Number.isFinite(n)) return formatNumber(n);
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const frac = abs - whole;
  if (frac < 1e-9) return (neg ? "-" : "") + String(whole);

  let bestNum = 1, bestDen = 1, bestErr = Infinity;
  for (let den = 1; den < 100; den++) {
    const num = Math.round(frac * den);
    const err = Math.abs(frac - num / den);
    if (err < bestErr - 1e-12) {
      bestErr = err;
      bestNum = num;
      bestDen = den;
    }
  }
  if (bestNum === 0) return (neg ? "-" : "") + String(whole);
  if (bestNum === bestDen) return (neg ? "-" : "") + String(whole + 1);
  const head = whole > 0 ? `${whole} ` : "";
  return `${neg ? "-" : ""}${head}${bestNum}/${bestDen}`;
}

function formatDate(serial: number, mode: "date" | "time" | "datetime"): string {
  if (!Number.isFinite(serial)) return formatNumber(serial);
  const d = serialToDate(serial);
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  if (mode === "date") return date;
  if (mode === "time") return time;
  return `${date} ${time}`;
}

/**
 * A computed value as the text a cell shows, under a number format.
 *
 * Only numbers are reshaped by the format; a boolean, string, blank or error
 * reads the same whatever format is set (a number format on a word is not an
 * error, it just does nothing). `automatic` and a missing format both defer to
 * the engine's default number formatting.
 */
export function formatValue(value: ScalarValue, fmt?: NumberFormat): string {
  if (isArray(value)) return formatValue(value.first, fmt);
  if (isRich(value)) return "";
  if (isError(value)) return value.code;
  if (value instanceof Blank) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") {
    return fmt?.kind === "custom" && fmt.pattern ? formatTextWithPattern(value, fmt.pattern) : value;
  }

  const n = value;
  /* A non-finite number shows the error code under EVERY kind — an Infinity
     under a currency format must not read "$Infinity". `formatNumber` supplies
     the same "#NUM!" the automatic path always showed. */
  if (!Number.isFinite(n)) return formatNumber(n);
  if (!fmt || fmt.kind === "automatic") return formatNumber(n);

  switch (fmt.kind) {
    case "number": {
      const { neg, body } = commaFixed(n, fmt.decimals ?? 2);
      return (neg ? "-" : "") + body;
    }
    case "currency": {
      const { neg, body } = commaFixed(n, fmt.decimals ?? 2);
      return `${neg ? "-" : ""}${fmt.currency ?? "$"}${body}`;
    }
    case "percent": {
      const { neg, body } = commaFixed(n * 100, fmt.decimals ?? 2);
      return `${neg ? "-" : ""}${body}%`;
    }
    case "scientific":
      return n.toExponential(clampDecimals(fmt.decimals ?? 2)).replace("e", "E");
    case "date":
      return formatDate(n, "date");
    case "time":
      return formatDate(n, "time");
    case "datetime":
      return formatDate(n, "datetime");
    case "accounting": {
      /* Accounting puts the symbol hard left, brackets negatives, and shows zero
         as a dash — the conventions a ledger column is read with. */
      const { neg, body } = commaFixed(n, fmt.decimals ?? 2);
      const sym = fmt.currency ?? "$";
      if (n === 0) return `${sym} -`;
      return neg ? `${sym} (${body})` : `${sym} ${body}`;
    }
    case "shortDate":
      return formatDate(n, "date");
    case "longDate":
      return formatLongDate(n);
    case "fraction":
      return formatFraction(n);
    case "text":
      /* Shown exactly as the number reads, never grouped or rounded. */
      return formatNumber(n);
    case "custom":
      return formatWithPattern(n, fmt.pattern ?? "General");
    default:
      return formatNumber(n);
  }
}
