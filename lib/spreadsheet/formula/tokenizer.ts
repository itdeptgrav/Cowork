/**
 * The tokenizer — formula text to a flat list of tokens.
 *
 * The first real stage of a proper pipeline: it recognises numbers, quoted
 * strings, cell references, names (functions and TRUE/FALSE), operators and
 * punctuation, and rejects anything else. A reference is matched BEFORE a name
 * so `A1` is a ref and `A1B` (ref match fails its trailing-boundary check) falls
 * through to a name. A string that reaches the end of input without its closing
 * quote is an error, wherever the input stops — including right on a quote.
 *
 * `tokenizeSpanned` also reports each token's [start, end) slice of the source,
 * which is what lets the rewriters (`references.ts`, `rewrite.ts`, `sheets.ts`)
 * re-emit everything they do not change — spacing included — exactly as written.
 */

export type TokenType =
  | "number"
  | "string"
  | "ref"
  | "name"
  /** A sheet qualifier — the `Sheet2` of `Sheet2!A1`, or a quoted `'Sales Data'`.
      The trailing `!` is consumed; the value is the bare sheet name. */
  | "sheet"
  | "error"
  | "op"
  | "lparen"
  | "rparen"
  | "comma"
  | "colon";

export interface Token {
  type: TokenType;
  value: string;
}

/** A token plus the [start, end) span of source text it was lexed from. The
    span covers the whole source spelling (quotes, the sheet `!`, a `!=` written
    for `<>`), so `source.slice(start, end)` re-emits the token verbatim. */
export interface SpannedToken extends Token {
  start: number;
  end: number;
}

export class TokenizeError extends Error {}

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
/* The standard error literals, longest-first so `#N/A` is not cut short. */
const ERROR = /^#(DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A)/;
/* A ref must not butt up against more letters/digits, so `A1B` is not read as
   `A1` + `B` but as a single name the evaluator will reject. */
const REF = /^\$?[A-Za-z]+\$?\d+(?![A-Za-z0-9_.])/;
const NAME = /^[A-Za-z_][A-Za-z0-9_.]*/;

export function tokenizeSpanned(input: string): SpannedToken[] {
  const tokens: SpannedToken[] = [];
  let i = 0;

  const push = (type: TokenType, value: string, start: number): void => {
    tokens.push({ type, value, start, end: i });
  };

  while (i < input.length) {
    const ch = input[i];
    const start = i;

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }

    if (ch === '"') {
      let value = "";
      let closed = false;
      i += 1;
      while (i < input.length) {
        if (input[i] === '"') {
          /* A doubled quote inside is a literal quote. */
          if (input[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i += 1;
          closed = true;
          break;
        }
        value += input[i];
        i += 1;
      }
      if (!closed) throw new TokenizeError("Unterminated string");
      push("string", value, start);
      continue;
    }

    /* A single-quoted, `!`-terminated sheet name — how a name with spaces is
       written, `'Sales Data'!A1`. A doubled quote inside is a literal quote. */
    if (ch === "'") {
      let name = "";
      i += 1;
      for (;;) {
        if (i >= input.length) throw new TokenizeError("Unterminated sheet name");
        if (input[i] === "'") {
          if (input[i + 1] === "'") {
            name += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        name += input[i];
        i += 1;
      }
      if (input[i] !== "!") throw new TokenizeError("Expected '!' after sheet name");
      i += 1;
      push("sheet", name, start);
      continue;
    }

    const rest = input.slice(i);

    if (ch === "#") {
      const m = ERROR.exec(rest);
      if (m) {
        i += m[0].length;
        push("error", m[0], start);
        continue;
      }
    }

    if (ch >= "0" && ch <= "9") {
      const m = NUMBER.exec(rest);
      if (m) {
        i += m[0].length;
        push("number", m[0], start);
        continue;
      }
    }
    if (ch === "." && /[0-9]/.test(input[i + 1] ?? "")) {
      const m = NUMBER.exec(rest);
      if (m) {
        i += m[0].length;
        push("number", m[0], start);
        continue;
      }
    }

    if (/[A-Za-z_$]/.test(ch)) {
      const refMatch = REF.exec(rest);
      if (refMatch) {
        i += refMatch[0].length;
        /* `Sheet2!A1`: a ref-shaped token followed by `!` is an unquoted sheet
           name. A `!=` is the not-equal operator, not a qualifier. */
        if (input[i] === "!" && input[i + 1] !== "=") {
          i += 1;
          push("sheet", refMatch[0], start);
        } else {
          push("ref", refMatch[0], start);
        }
        continue;
      }
      const nameMatch = NAME.exec(rest);
      if (nameMatch) {
        i += nameMatch[0].length;
        if (input[i] === "!" && input[i + 1] !== "=") {
          i += 1;
          push("sheet", nameMatch[0], start);
        } else {
          push("name", nameMatch[0], start);
        }
        continue;
      }
    }

    const two = input.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") {
      i += 2;
      push("op", two, start);
      continue;
    }
    if (two === "!=") {
      i += 2;
      push("op", "<>", start); // normalise to the spreadsheet spelling
      continue;
    }

    if ("+-*/^%&".includes(ch) || ch === "<" || ch === ">" || ch === "=") {
      i += 1;
      push("op", ch, start);
      continue;
    }
    if (ch === "(") {
      i += 1;
      push("lparen", ch, start);
      continue;
    }
    if (ch === ")") {
      i += 1;
      push("rparen", ch, start);
      continue;
    }
    if (ch === ",") {
      i += 1;
      push("comma", ch, start);
      continue;
    }
    if (ch === ":") {
      i += 1;
      push("colon", ch, start);
      continue;
    }

    throw new TokenizeError(`Unexpected character '${ch}'`);
  }

  return tokens;
}

export function tokenize(input: string): Token[] {
  return tokenizeSpanned(input).map(({ type, value }) => ({ type, value }));
}
