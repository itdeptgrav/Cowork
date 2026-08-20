/**
 * Finding phone numbers in message text — and refusing everything that merely
 * looks like one.
 *
 * A chat bubble turns a recognised number into a `tel:` link, so on a phone one
 * tap opens the dialler. The cost of a false positive is real: a task figure, a
 * date or an amount rendered as a call button teaches people the blue text
 * means nothing. So the detector is deliberately narrow, and every rule below
 * exists to reject a specific non-phone shape:
 *
 * · **Digit count is the gate.** With a `+` country code, 10–15 digits (the
 *   E.164 envelope); without one, exactly 10 — the local mobile format — or 11
 *   with a leading trunk `0`. Short figures ("call in 20"), pin codes, years
 *   and long identifiers all fail this before anything else is asked.
 * · **Dates are rejected by shape.** `20-08-2026` and `2026-08-20` are eight
 *   digits and fail the count, but a date RUNS INTO a time ("20-08-2026 17 30"
 *   is ten digits with separators), so any candidate containing a
 *   day-month-year or year-month-day shape is refused outright.
 * · **Decimals, IPs and versions never form a candidate.** `.` is not a
 *   separator here, so `192.168.1.100` and `1234.56` break into fragments too
 *   short to match. Newlines are not separators either — numbers on adjacent
 *   lines are judged apart, not glued into one long run.
 * · **Anything glued to a word or an identifier is refused by its
 *   neighbours.** `TASK-1234567890`, `#1234567890`, `id1234567890` and
 *   `1.9876543210` all fail the boundary checks — a phone number in prose has
 *   whitespace or punctuation around it, not letters, `#`, or a digit beyond a
 *   joining mark.
 *
 * Pure text-in, matches-out; the renderer (`lib/utils/linkify.tsx`) decides
 * what a match looks like.
 */

export interface PhoneMatch {
  /** Where the run starts in the text. */
  index: number;
  /** The run exactly as typed — what the bubble displays. */
  text: string;
  /** The dialler target: `tel:` plus the digits, keeping a leading `+`. */
  href: string;
}

/**
 * A candidate run: starts on `+`, `(` or a digit, continues through digits and
 * the separators phone numbers actually use (space, hyphen, parentheses), and
 * ends on a digit. Length caps keep a candidate from swallowing half a line;
 * `\s` is deliberately NOT used — a literal space only, so a line break ends
 * the run.
 */
const CANDIDATE = /[+(\d][\d ()-]{7,22}\d/g;

/** A day-month-year or year-month-day inside the run — a date, never a phone. */
const DATE_SHAPE = /(?:^|\D)\d{1,2}-\d{1,2}-\d{4}(?!\d)|(?:^|\D)\d{4}-\d{1,2}-\d{1,2}(?!\d)/;

/** Characters that glue a run to an identifier or a larger number. */
const JOINING = new Set([".", "-", ":", "/", ","]);

const isWordChar = (ch: string | undefined): boolean =>
  ch !== undefined && /[\p{L}\p{N}_#@]/u.test(ch);

/**
 * Whether the character beside a run disqualifies it.
 *
 * A letter, digit, `#` or `@` always does — the run is part of something
 * larger. A joining mark (`.`, `-`, `:`, `/`, `,`) disqualifies only when a
 * word character sits on its far side: `9876543210.` ends a sentence and is
 * fine, where `9876543210.5` is a decimal and `TASK-1234567890` is an
 * identifier, and neither is a phone. The cost is that a number glued to a
 * label with no space (`phone:9876543210`) stays plain text — the help
 * article says so, and a missed link is copyable where a wrong one teaches
 * people the blue text means nothing.
 */
function badNeighbour(near: string | undefined, beyond: string | undefined): boolean {
  if (near === undefined) return false;
  if (isWordChar(near)) return true;
  if (JOINING.has(near) && isWordChar(beyond)) return true;
  return false;
}

export function detectPhoneNumbers(text: string): PhoneMatch[] {
  const out: PhoneMatch[] = [];
  CANDIDATE.lastIndex = 0;
  for (let m = CANDIDATE.exec(text); m !== null; m = CANDIDATE.exec(text)) {
    let run = m[0];
    let start = m.index;

    /* "(9876543210" — a number that OPENS a bracket it never closes only
       borrowed the bracket from the prose around it. Shed it and judge the
       number; a bracket used as phone punctuation, "(408) 555-0100", has its
       partner inside the run and is left alone. */
    if (run.startsWith("(") && !run.includes(")")) {
      run = run.slice(1);
      start += 1;
    }
    const end = start + run.length;

    /* Neighbours first — the cheapest refusals. */
    if (badNeighbour(text[start - 1], text[start - 2])) continue;
    if (badNeighbour(text[end], text[end + 1])) continue;

    if (DATE_SHAPE.test(run)) continue;

    /* Parentheses come in pairs or not at all — "(408) 555-0100" is a phone,
       a stray bracket is prose that happened to touch a number. */
    const opens = (run.match(/\(/g) ?? []).length;
    const closes = (run.match(/\)/g) ?? []).length;
    if (opens !== closes) continue;

    const digits = run.replace(/\D/g, "");
    const international = run.startsWith("+");
    if (international) {
      if (digits.length < 10 || digits.length > 15) continue;
    } else if (
      digits.length !== 10 &&
      !(digits.length === 11 && digits.startsWith("0"))
    ) {
      continue;
    }

    out.push({
      index: start,
      text: run,
      href: `tel:${international ? "+" : ""}${digits}`,
    });
  }
  return out;
}
