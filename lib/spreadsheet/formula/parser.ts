/**
 * The parser — tokens to an AST, by precedence climbing.
 *
 * Precedence and associativity follow the spreadsheet, including its quirks:
 * comparison binds loosest, then `+ -`, then `* /`, then `^`; `%` is a postfix
 * (`50%` is 0.5); and unary minus binds TIGHTER than `^`, so `-2^2` is `(-2)^2`
 * = 4, as Excel computes it. A range `A1:B2` is two refs joined by `:`.
 */

import type { BinaryOp, Node, RefNode } from "./ast";
import type { ErrorCode } from "./errors";
import { tokenize, type Token } from "./tokenizer";

export class ParseError extends Error {}

const BINARY_PRECEDENCE: Record<string, number> = {
  "=": 1,
  "<>": 1,
  "<": 1,
  ">": 1,
  "<=": 1,
  ">=": 1,
  "+": 2,
  "-": 2,
  "*": 3,
  "/": 3,
  "^": 4,
};

const REF_SHAPE = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/;

function columnIndex(label: string): number {
  let n = 0;
  for (const ch of label.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function refNode(text: string): RefNode {
  const m = REF_SHAPE.exec(text);
  if (!m) throw new ParseError(`Bad reference ${text}`);
  return {
    type: "ref",
    absCol: m[1] === "$",
    col: columnIndex(m[2]),
    absRow: m[3] === "$",
    row: Number.parseInt(m[4], 10) - 1,
  };
}

class Parser {
  private pos = 0;
  private readonly tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new ParseError("Unexpected end of formula");
    this.pos += 1;
    return t;
  }

  private expect(type: Token["type"]): Token {
    const t = this.next();
    if (t.type !== type) throw new ParseError(`Expected ${type}, got ${t.value}`);
    return t;
  }

  parse(): Node {
    const node = this.parseExpression(0);
    if (this.pos !== this.tokens.length) {
      throw new ParseError(`Unexpected ${this.peek()?.value}`);
    }
    return node;
  }

  private parseExpression(minPrec: number): Node {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (!t || t.type !== "op") break;
      const prec = BINARY_PRECEDENCE[t.value];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      /* prec + 1 → left-associative, including `^` (Excel: 2^3^2 = 64). */
      const right = this.parseExpression(prec + 1);
      left = { type: "binary", op: t.value as BinaryOp, left, right };
    }
    return left;
  }

  private parseUnary(): Node {
    const t = this.peek();
    if (t && t.type === "op" && (t.value === "-" || t.value === "+")) {
      this.next();
      return { type: "unary", op: t.value, operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary();
    while (this.peek()?.type === "op" && this.peek()?.value === "%") {
      this.next();
      node = { type: "percent", operand: node };
    }
    return node;
  }

  private parsePrimary(): Node {
    const t = this.next();
    switch (t.type) {
      case "number":
        return { type: "number", value: Number(t.value) };
      case "string":
        return { type: "string", value: t.value };
      case "error":
        return { type: "error", code: t.value as ErrorCode };
      case "lparen": {
        const inner = this.parseExpression(0);
        this.expect("rparen");
        return inner;
      }
      case "ref": {
        const start = refNode(t.value);
        if (this.peek()?.type === "colon") {
          this.next();
          const end = refNode(this.expect("ref").value);
          return { type: "range", start, end };
        }
        return start;
      }
      case "sheet": {
        /* A sheet qualifier binds to the ref (or range) that follows it. The
           whole range takes one sheet: `Sheet2!A1:B2`, not `Sheet2!A1:Sheet2!B2`. */
        const sheet = t.value;
        const start = refNode(this.expect("ref").value);
        start.sheet = sheet;
        if (this.peek()?.type === "colon") {
          this.next();
          const end = refNode(this.expect("ref").value);
          end.sheet = sheet;
          return { type: "range", start, end, sheet };
        }
        return start;
      }
      case "name": {
        const upper = t.value.toUpperCase();
        if (upper === "TRUE") return { type: "boolean", value: true };
        if (upper === "FALSE") return { type: "boolean", value: false };
        if (this.peek()?.type === "lparen") return this.parseCall(upper);
        /* A bare word that is neither a function nor a boolean is #NAME? — a
           parse failure the engine surfaces as that error. */
        throw new ParseError(`Unknown name ${t.value}`);
      }
      default:
        throw new ParseError(`Unexpected ${t.value}`);
    }
  }

  private parseCall(name: string): Node {
    this.expect("lparen");
    const args: Node[] = [];
    if (this.peek()?.type !== "rparen") {
      args.push(this.parseExpression(0));
      while (this.peek()?.type === "comma") {
        this.next();
        args.push(this.parseExpression(0));
      }
    }
    this.expect("rparen");
    return { type: "call", name, args };
  }
}

/** Parse a formula's BODY — the text after the leading "=". */
export function parse(body: string): Node {
  const tokens = tokenize(body);
  if (tokens.length === 0) throw new ParseError("Empty formula");
  return new Parser(tokens).parse();
}
