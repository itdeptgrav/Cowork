/**
 * The tokenizer — formula text to a flat list of tokens.
 *
 * The first real stage of a proper pipeline: it recognises numbers, quoted
 * strings, cell references, names (functions and TRUE/FALSE), operators and
 * punctuation, and rejects anything else. A reference is matched BEFORE a name
 * so `A1` is a ref and `A1B` (ref match fails its trailing-boundary check) falls
 * through to a name.
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

export class TokenizeError extends Error {}

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
/* The standard error literals, longest-first so `#N/A` is not cut short. */
const ERROR = /^#(DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A)/;
/* A ref must not butt up against more letters/digits, so `A1B` is not read as
   `A1` + `B` but as a single name the evaluator will reject. */
const REF = /^\$?[A-Za-z]+\$?\d+(?![A-Za-z0-9_.])/;
const NAME = /^[A-Za-z_][A-Za-z0-9_.]*/;

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }

    if (ch === '"') {
      let value = "";
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
          break;
        }
        value += input[i];
        i += 1;
        if (i >= input.length) throw new TokenizeError("Unterminated string");
      }
      tokens.push({ type: "string", value });
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
      tokens.push({ type: "sheet", value: name });
      continue;
    }

    const rest = input.slice(i);

    if (ch === "#") {
      const m = ERROR.exec(rest);
      if (m) {
        tokens.push({ type: "error", value: m[0] });
        i += m[0].length;
        continue;
      }
    }

    if (ch >= "0" && ch <= "9") {
      const m = NUMBER.exec(rest);
      if (m) {
        tokens.push({ type: "number", value: m[0] });
        i += m[0].length;
        continue;
      }
    }
    if (ch === "." && /[0-9]/.test(input[i + 1] ?? "")) {
      const m = NUMBER.exec(rest);
      if (m) {
        tokens.push({ type: "number", value: m[0] });
        i += m[0].length;
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
          tokens.push({ type: "sheet", value: refMatch[0] });
        } else {
          tokens.push({ type: "ref", value: refMatch[0] });
        }
        continue;
      }
      const nameMatch = NAME.exec(rest);
      if (nameMatch) {
        i += nameMatch[0].length;
        if (input[i] === "!" && input[i + 1] !== "=") {
          i += 1;
          tokens.push({ type: "sheet", value: nameMatch[0] });
        } else {
          tokens.push({ type: "name", value: nameMatch[0] });
        }
        continue;
      }
    }

    const two = input.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if (two === "!=") {
      tokens.push({ type: "op", value: "<>" }); // normalise to the spreadsheet spelling
      i += 2;
      continue;
    }

    if ("+-*/^%".includes(ch) || ch === "<" || ch === ">" || ch === "=") {
      tokens.push({ type: "op", value: ch });
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen", value: ch });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ch });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", value: ch });
      i += 1;
      continue;
    }
    if (ch === ":") {
      tokens.push({ type: "colon", value: ch });
      i += 1;
      continue;
    }

    throw new TokenizeError(`Unexpected character '${ch}'`);
  }

  return tokens;
}
