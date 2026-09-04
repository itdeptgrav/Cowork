/**
 * Custom number formats — the pattern language of Excel and Sheets, the part
 * of it people actually write.
 *
 * A pattern has up to four sections separated by `;` — positive, negative,
 * zero, text. Within a number section: `0` is a digit that always shows, `#`
 * one that shows when needed, `?` one padded with a space; the first `,`
 * between digits groups thousands and a trailing `,` divides by a thousand;
 * `.` places the decimal point; `%` multiplies by 100; `E+00` writes an
 * exponent; `"…"` and `\x` are literal text and any other character — a
 * currency sign, a dash, a space — passes straight through. A section with
 * date tokens (`yyyy`, `mmm`, `dd`, `hh`, `ss`, `AM/PM`) formats the value as a
 * date serial. `[Red]` and the other colour tags are accepted and ignored.
 *
 * `General` is the automatic format, and an unreadable pattern falls back to
 * it rather than showing nothing: a wrong format must never hide a number.
 */

const EPOCH_OFFSET = 25569;
const DAY_MS = 86_400_000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Split on `;` outside quotes. */
function sections(pattern: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '"') inQuote = !inQuote;
    if (ch === "\\" && i + 1 < pattern.length) {
      cur += ch + pattern[i + 1];
      i++;
      continue;
    }
    if (ch === ";" && !inQuote) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Colour and condition tags, `[Red]`, `[>100]`, `[$₹-4009]`: the currency
    tag yields its symbol; the rest are dropped. */
function stripTags(section: string): string {
  return section.replace(/\[([^\]]*)\]/g, (m, inner: string) => {
    if (inner.startsWith("$")) return inner.slice(1).split("-")[0];
    /* Elapsed-time tags stay: [h], [mm], [s] are format tokens, not colours. */
    if (/^[hms]+$/i.test(inner)) return m;
    return "";
  });
}

function isDatePattern(section: string): boolean {
  const bare = section.replace(/"[^"]*"/g, "").replace(/\\./g, "");
  return /\b(y{2,4}|m{1,5}|d{1,4}|h{1,2}|s{1,2}|AM\/PM|am\/pm|A\/P)\b/.test(bare) && !/[#0?]/.test(bare);
}

/** The pieces of a numeric section, in order, with the literal text kept. */
interface NumericSection {
  prefix: string;
  suffix: string;
  intDigits: string; // the 0/#/? run left of the point
  fracDigits: string; // right of the point
  grouping: boolean;
  scale: number; // ×100 for %, ÷1000 per trailing comma
  exponent: string | null; // "E+00"
}

function parseNumeric(section: string): NumericSection {
  let prefix = "";
  let suffix = "";
  let core = "";
  let seenDigit = false;
  let doneDigits = false;
  let scale = 1;
  let grouping = false;
  let exponent: string | null = null;
  const pushLit = (t: string) => {
    if (!seenDigit) prefix += t;
    else suffix += t;
  };
  for (let i = 0; i < section.length; i++) {
    const ch = section[i];
    if (ch === '"') {
      const end = section.indexOf('"', i + 1);
      const lit = end === -1 ? section.slice(i + 1) : section.slice(i + 1, end);
      pushLit(lit);
      i = end === -1 ? section.length : end;
      continue;
    }
    if (ch === "\\") {
      pushLit(section[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === "_") {
      pushLit(" ");
      i++;
      continue;
    }
    if (ch === "*") {
      i++;
      continue;
    }
    if ((ch === "E" || ch === "e") && /[+-]/.test(section[i + 1] ?? "") && seenDigit) {
      let j = i + 2;
      let zeros = "";
      while (section[j] === "0") zeros += section[j++];
      exponent = "E" + section[i + 1] + zeros;
      i = j - 1;
      doneDigits = true;
      continue;
    }
    if (ch === "0" || ch === "#" || ch === "?" || ch === "." ) {
      if (doneDigits) {
        pushLit(ch);
        continue;
      }
      seenDigit = true;
      core += ch;
      continue;
    }
    if (ch === "," && seenDigit && !doneDigits) {
      const next = section[i + 1] ?? "";
      if (/[0#?]/.test(next)) grouping = true;
      else scale /= 1000; // trailing comma: thousands
      continue;
    }
    if (ch === "%") {
      scale *= 100;
      pushLit("%");
      if (seenDigit) doneDigits = true;
      continue;
    }
    if (seenDigit) doneDigits = true;
    pushLit(ch);
  }
  const dot = core.indexOf(".");
  const intDigits = dot === -1 ? core : core.slice(0, dot);
  const fracDigits = dot === -1 ? "" : core.slice(dot + 1).replace(/\./g, "");
  return { prefix, suffix, intDigits, fracDigits, grouping, scale, exponent };
}

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function applyNumeric(sec: NumericSection, value: number): string {
  let n = Math.abs(value) * sec.scale;
  let expText = "";
  if (sec.exponent) {
    let exp = 0;
    if (n !== 0) {
      exp = Math.floor(Math.log10(n));
      n = n / Math.pow(10, exp);
    }
    const sign = sec.exponent[1] === "+" ? (exp < 0 ? "-" : "+") : exp < 0 ? "-" : "";
    const width = sec.exponent.length - 2;
    expText = "E" + sign + String(Math.abs(exp)).padStart(width, "0");
  }
  /* A section with no digit placeholder at all is pure text ("-" for zero). */
  if (sec.intDigits === "" && sec.fracDigits === "" && !sec.exponent) return sec.prefix + sec.suffix;
  const decimals = sec.fracDigits.length;
  const fixed = n.toFixed(decimals);
  const parts = fixed.split(".");
  let intPart = parts[0];
  const fracPart = parts[1] ?? "";
  /* Integer digits: pad to the count of `0`s, `?` pads with spaces; `#` adds
     nothing. An integer of 0 with no forced digit shows nothing ("#.##" of 0.5
     is ".5"). */
  const forced = (sec.intDigits.match(/0/g) ?? []).length;
  const spaced = (sec.intDigits.match(/\?/g) ?? []).length;
  if (intPart === "0" && forced === 0 && sec.intDigits.length > 0) intPart = "";
  if (intPart.length < forced) intPart = intPart.padStart(forced, "0");
  if (sec.grouping && intPart) intPart = group(intPart);
  if (intPart.length < forced + spaced) intPart = intPart.padStart(forced + spaced, " ");
  /* Fraction: trailing `#` positions drop their zeros; `?` positions become spaces. */
  let frac = fracPart;
  for (let i = frac.length - 1; i >= 0; i--) {
    const spec = sec.fracDigits[i];
    if (frac[i] === "0" && spec === "#") frac = frac.slice(0, i);
    else if (frac[i] === "0" && spec === "?") frac = frac.slice(0, i) + " " + frac.slice(i + 1);
    else break;
  }
  const point = decimals > 0 && (frac.length > 0 || sec.fracDigits.includes("0")) ? "." : decimals > 0 && sec.fracDigits.length > 0 && frac.length > 0 ? "." : "";
  const body = intPart + (frac.length > 0 || point ? point + frac : "") + expText;
  return sec.prefix + body + sec.suffix;
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** A date section: tokens replaced from the serial's UTC date. */
function applyDate(section: string, serial: number): string {
  const ms = Math.round((serial - EPOCH_OFFSET) * DAY_MS);
  const d = new Date(ms);
  const has12h = /AM\/PM|am\/pm|A\/P/.test(section);
  let hours = d.getUTCHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  if (has12h) hours = hours % 12 === 0 ? 12 : hours % 12;
  const totalHours = Math.floor(serial * 24);
  const totalMinutes = Math.floor(serial * 1440);
  const totalSeconds = Math.floor(serial * 86400);
  let out = "";
  let i = 0;
  const src = section;
  let lastWasHour = false;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      out += end === -1 ? src.slice(i + 1) : src.slice(i + 1, end);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (ch === "\\") {
      out += src[i + 1] ?? "";
      i += 2;
      continue;
    }
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^(AM\/PM|am\/pm)/.exec(rest))) {
      out += m[1] === "AM/PM" ? ampm : ampm.toLowerCase();
      i += m[0].length;
      continue;
    }
    if ((m = /^A\/P/.exec(rest))) {
      out += ampm[0];
      i += 3;
      continue;
    }
    if ((m = /^\[h+\]/i.exec(rest))) {
      out += String(totalHours);
      i += m[0].length;
      lastWasHour = true;
      continue;
    }
    if ((m = /^\[m+\]/i.exec(rest))) {
      out += String(totalMinutes);
      i += m[0].length;
      continue;
    }
    if ((m = /^\[s+\]/i.exec(rest))) {
      out += String(totalSeconds);
      i += m[0].length;
      continue;
    }
    if ((m = /^y{4}|^y{2}/i.exec(rest))) {
      const y = d.getUTCFullYear();
      out += m[0].length === 4 ? String(y) : two(y % 100);
      i += m[0].length;
      lastWasHour = false;
      continue;
    }
    if ((m = /^m{1,5}/i.exec(rest))) {
      const len = m[0].length;
      /* `m` right after an hour, or right before seconds, means minutes. */
      const before = src.slice(i + len);
      const minutes = lastWasHour || /^[:\s]?s/i.test(before);
      if (minutes && len <= 2) out += len === 2 ? two(d.getUTCMinutes()) : String(d.getUTCMinutes());
      else if (len === 1) out += String(d.getUTCMonth() + 1);
      else if (len === 2) out += two(d.getUTCMonth() + 1);
      else if (len === 3) out += MONTHS[d.getUTCMonth()].slice(0, 3);
      else if (len === 4) out += MONTHS[d.getUTCMonth()];
      else out += MONTHS[d.getUTCMonth()][0];
      i += len;
      lastWasHour = false;
      continue;
    }
    if ((m = /^d{1,4}/i.exec(rest))) {
      const len = m[0].length;
      if (len === 1) out += String(d.getUTCDate());
      else if (len === 2) out += two(d.getUTCDate());
      else if (len === 3) out += DAYS[d.getUTCDay()].slice(0, 3);
      else out += DAYS[d.getUTCDay()];
      i += len;
      lastWasHour = false;
      continue;
    }
    if ((m = /^h{1,2}/i.exec(rest))) {
      out += m[0].length === 2 ? two(hours) : String(hours);
      i += m[0].length;
      lastWasHour = true;
      continue;
    }
    if ((m = /^s{1,2}/i.exec(rest))) {
      out += m[0].length === 2 ? two(d.getUTCSeconds()) : String(d.getUTCSeconds());
      i += m[0].length;
      lastWasHour = false;
      continue;
    }
    out += ch;
    if (ch !== ":" && ch !== " ") lastWasHour = false;
    i++;
  }
  return out;
}

/** Whether a pattern can be used at all. Empty and unbalanced-quote patterns
    are refused; anything else formats something. */
export function patternProblem(pattern: string): string | null {
  const t = pattern.trim();
  if (!t) return "Type a format, such as #,##0.00 or dd/mm/yyyy.";
  if ((t.match(/"/g) ?? []).length % 2 === 1) return "A quote mark is not closed.";
  if (sections(t).length > 4) return "A format has at most four parts separated by semicolons.";
  return null;
}

/** General: the automatic look, as `formatNumber` draws it. */
function general(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(15)));
}

/**
 * Format a number with a pattern. The section is chosen by sign — the second
 * section takes the negative WITHOUT its minus, as in the originals, so
 * `#,##0;(#,##0)` brackets negatives — and the third takes zero.
 */
export function formatWithPattern(value: number, pattern: string): string {
  if (!Number.isFinite(value)) return "#NUM!";
  if (patternProblem(pattern) !== null) return general(value);
  const secs = sections(pattern.trim()).map(stripTags);
  if (secs.length === 1 && /^general$/i.test(secs[0].trim())) return general(value);
  let section: string;
  let n = value;
  if (value < 0 && secs.length >= 2) {
    section = secs[1];
    n = Math.abs(value);
  } else if (value === 0 && secs.length >= 3) {
    section = secs[2];
  } else {
    section = secs[0];
  }
  if (/^general$/i.test(section.trim())) return general(n === value ? value : -Math.abs(value) === value ? value : n);
  if (isDatePattern(section)) return applyDate(section, value);
  const sec = parseNumeric(section);
  const text = applyNumeric(sec, n);
  /* The first section formats a negative with its sign when there is no
     dedicated negative section. */
  return value < 0 && secs.length < 2 ? "-" + text : text;
}

/** Format text with the fourth (text) section when there is one, else as is. */
export function formatTextWithPattern(text: string, pattern: string): string {
  const secs = sections(pattern);
  if (secs.length < 4) return text;
  const sec = stripTags(secs[3]);
  if (!sec.includes("@")) return text;
  return sec.replace(/"([^"]*)"/g, "$1").replace(/@/g, text);
}

/** A handful of starting points for the custom format dialog. */
export const PATTERN_EXAMPLES: { label: string; pattern: string }[] = [
  { label: "Thousands, two decimals", pattern: "#,##0.00" },
  { label: "Negatives in brackets", pattern: "#,##0;(#,##0)" },
  { label: "Rupees", pattern: "₹#,##0.00" },
  { label: "Euros after the number", pattern: "#,##0.00 €" },
  { label: "Thousands as K", pattern: "#,##0,\"K\"" },
  { label: "Percent, one decimal", pattern: "0.0%" },
  { label: "Scientific", pattern: "0.00E+00" },
  { label: "Day Month Year", pattern: "dd mmm yyyy" },
  { label: "Weekday and date", pattern: "dddd, d mmmm yyyy" },
  { label: "Time, 12-hour", pattern: "h:mm AM/PM" },
  { label: "Duration in hours", pattern: "[h]:mm" },
  { label: "Padded code", pattern: "0000" },
];
