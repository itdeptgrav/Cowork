/**
 * Tokenizer + parser audit — precedence, literals, escaping, malformed input.
 *
 * Adversarial cases asserted against real spreadsheet (Google Sheets / Excel)
 * semantics, not against what the implementation happens to do.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCellRef } from "@/lib/spreadsheet/coordinates";
import { FormulaEngine } from "@/lib/spreadsheet/formula/engine";
import { tokenize, TokenizeError } from "@/lib/spreadsheet/formula/tokenizer";

function sheet(cells: Record<string, string> = {}) {
  const e = new FormulaEngine();
  const S = "s";
  for (const [ref, raw] of Object.entries(cells)) {
    const p = parseCellRef(ref)!;
    e.setCell(S, p.row, p.col, raw);
  }
  return {
    set(ref: string, raw: string) {
      const p = parseCellRef(ref)!;
      e.setCell(S, p.row, p.col, raw);
    },
    show(ref: string): string {
      const p = parseCellRef(ref)!;
      return e.display(S, p.row, p.col).text;
    },
  };
}

function value(formula: string): string {
  return sheet({ A1: formula }).show("A1");
}

/* ── Precedence and associativity ─────────────────────────────────────────── */

test("AUDIT: arithmetic precedence and left-associativity", () => {
  assert.equal(value("=2+3*4"), "14");
  assert.equal(value("=2*3+4"), "10");
  assert.equal(value("=2+3*4^2"), "50", "^ above *, * above +");
  assert.equal(value("=2*3^2"), "18");
  assert.equal(value("=8/4/2"), "1", "/ is left-associative");
  assert.equal(value("=8-4-2"), "2", "- is left-associative");
  assert.equal(value("=2^3^2"), "64", "^ is left-associative in a spreadsheet");
});

test("AUDIT: unary minus vs subtraction vs exponent", () => {
  assert.equal(value("=-2^2"), "4", "unary minus binds tighter than ^: (-2)^2");
  assert.equal(value("=0-2^2"), "-4", "binary minus does not: 0-(2^2)");
  assert.equal(value("=2^-2"), "0.25");
  assert.equal(value("=-2^-2"), "0.25", "(-2)^(-2)");
  assert.equal(value("=--2"), "2");
  assert.equal(value("=3--2"), "5");
  assert.equal(value("=3-+2"), "1");
});

test("AUDIT: comparison binds loosest", () => {
  assert.equal(value("=1+1=2"), "TRUE");
  assert.equal(value("=2*3>5"), "TRUE");
  assert.equal(value("=1<2=TRUE"), "TRUE", "(1<2)=TRUE, left-associative");
});

/* ── The percent postfix ──────────────────────────────────────────────────── */

test("AUDIT: percent is a postfix, composable", () => {
  assert.equal(value("=50%"), "0.5");
  assert.equal(value("=50%%"), "0.005", "a double percent divides twice");
  assert.equal(value("=(2+3)%"), "0.05", "applies to a parenthesised expression");
  assert.equal(value("=1+50%"), "1.5");
  assert.equal(value("=-50%"), "-0.5");
  assert.equal(value("=2%^2"), "0.0004", "percent binds before ^");
  const s = sheet({ A1: "50", B1: "=A1%" });
  assert.equal(s.show("B1"), "0.5", "percent applies to a reference");
});

/* ── Literals ─────────────────────────────────────────────────────────────── */

test("AUDIT: scientific and decimal number literals", () => {
  assert.equal(value("=1e3+1"), "1001");
  assert.equal(value("=1.5E-2"), "0.015");
  assert.equal(value("=.5*4"), "2", "a leading-dot decimal");
  assert.equal(value("=5.+1"), "6", "a trailing-dot decimal");
});

test("AUDIT: TRUE/FALSE literals in any case", () => {
  assert.equal(value("=TRUE"), "TRUE");
  assert.equal(value("=true"), "TRUE");
  assert.equal(value("=False"), "FALSE");
  assert.equal(value("=FALSE+1"), "1", "FALSE coerces to 0 in arithmetic");
});

test("AUDIT: string literals and doubled-quote escaping", () => {
  assert.equal(value('="Hello World"'), "Hello World");
  assert.equal(value('="a""b"'), 'a"b');
  assert.equal(value('=""'), "");
  assert.equal(value('="""x"""'), '"x"', "escaped quotes at both ends");
  assert.equal(value('=LEN("a""b")'), "3", "the escape is one character");
});

test("AUDIT: unterminated strings are rejected consistently", () => {
  // A string that reaches end of input without its closing quote is an error,
  // wherever the input stops — mid-string, on a lone opening quote, or right
  // after an escaped quote.
  assert.throws(() => tokenize('"a'), TokenizeError);
  assert.throws(() => tokenize('"'), TokenizeError);
  assert.throws(() => tokenize('"a""'), TokenizeError);
});

/* ── Malformed formulas ───────────────────────────────────────────────────── */

test("AUDIT: malformed formulas surface as errors, not values or hangs", () => {
  for (const bad of ["=1+", "=SUM(", "=A1:", "=(1+2", "=)", "=,", "=1 2", "=A1:B2:C3"]) {
    const shown = value(bad);
    assert.ok(shown.startsWith("#"), `${bad} must display an error, got "${shown}"`);
  }
});

test("AUDIT: an unknown function name is #NAME?", () => {
  assert.equal(value("=NOPE(1)"), "#NAME?");
  assert.equal(value("=nope(1)"), "#NAME?", "case-insensitive lookup, same error");
  assert.equal(value("=NOPE"), "#NAME?", "a bare unknown name too");
  assert.equal(value("=A1B+1"), "#NAME?", "an invalid ref shape is a name, hence #NAME?");
  assert.equal(value("=NOPE(1)+5"), "#NAME?", "#NAME? propagates through operators");
});

test("AUDIT: empty argument slots are legal in a spreadsheet", () => {
  // Sheets/Excel accept =IF(TRUE,5,) and =SUM(1,,2) — an omitted argument is a
  // blank, it is not a parse error.
  assert.equal(value("=IF(TRUE,5,)"), "5");
  assert.equal(value("=SUM(1,,2)"), "3");
});

test("AUDIT: TRUE()/FALSE() are callable, as in Sheets and Excel", () => {
  // A formula Sheets, Excel and exported XLSX files produce.
  assert.equal(value("=TRUE()"), "TRUE");
  assert.equal(value("=FALSE()"), "FALSE");
});

/* ── Operators, names, references ─────────────────────────────────────────── */

test("AUDIT: != normalises to <> and evaluates", () => {
  assert.equal(value("=1!=2"), "TRUE");
  const s = sheet({ A1: "1", B1: "2", C1: "=A1!=B1" });
  assert.equal(s.show("C1"), "TRUE", "a ref before != is a ref, not a sheet qualifier");
});

test("AUDIT: function names are case-insensitive", () => {
  assert.equal(value("=sum(1,2)"), "3");
  assert.equal(value("=Sum(1,2)"), "3");
  assert.equal(value("=iF(1=1,2,3)"), "2");
});

test("AUDIT: references are case-insensitive and anchor-tolerant", () => {
  const s = sheet({ A1: "7" });
  s.set("B1", "=a1+1");
  s.set("C1", "=$a$1+a$1+$a1");
  assert.equal(s.show("B1"), "8");
  assert.equal(s.show("C1"), "21");
});

test("AUDIT: whitespace anywhere between tokens is tolerated", () => {
  assert.equal(value("= 1 + 2 "), "3");
  const s = sheet({ A1: "1", A2: "2", B1: "=SUM( A1 , A2 )" });
  assert.equal(s.show("B1"), "3");
  assert.equal(value("=SUM (1,2)"), "3", "a space before the call parenthesis");
});

test("AUDIT: a reversed range spans the same block", () => {
  const s = sheet({ A1: "1", A2: "2", B1: "3", B2: "4" });
  s.set("C1", "=SUM(B2:A1)");
  s.set("C2", "=SUM(A1:B2)");
  assert.equal(s.show("C1"), s.show("C2"));
  assert.equal(s.show("C1"), "10");
});

test("AUDIT: deep nesting (3+ levels) evaluates inside-out", () => {
  assert.equal(value("=IF(AND(1,OR(0,1)),SUM(1,2,MAX(3,4)),0)"), "7");
  assert.equal(value('=IF(SUM(1,2)>2,IF(1=1,"in","mid"),"out")'), "in");
});
