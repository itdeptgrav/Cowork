import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula, evalWith } from "./_harness";

test("case, repetition and comparison", () => {
  assert.equal(evalFormula('=PROPER("hello wORLD o\'neil")'), "Hello World O'Neil");
  assert.equal(evalFormula('=REPT("ab", 3)'), "ababab");
  assert.equal(evalFormula('=REPT("ab", -1)'), "#VALUE!");
  assert.equal(evalFormula('=EXACT("a", "a")'), "TRUE");
  assert.equal(evalFormula('=EXACT("a", "A")'), "FALSE");
});

test("character codes", () => {
  assert.equal(evalFormula("=CHAR(65)"), "A");
  assert.equal(evalFormula("=CHAR(0)"), "#VALUE!");
  assert.equal(evalFormula('=CODE("A")'), "65");
  assert.equal(evalFormula('=CODE("")'), "#VALUE!");
  assert.equal(evalFormula("=UNICHAR(8364)"), "€");
  assert.equal(evalFormula('=UNICODE("€")'), "8364");
  assert.equal(evalFormula('=CLEAN("a" & CHAR(10) & "b")'), "ab");
});

test("REPLACE by position, and the joining family", () => {
  assert.equal(evalFormula('=REPLACE("abcdef", 2, 3, "XY")'), "aXYef");
  assert.equal(evalWith('=TEXTJOIN(", ", TRUE, A1:A4)', { A1: "a", A3: "c", A4: "d" }), "a, c, d");
  assert.equal(evalWith('=TEXTJOIN("-", FALSE, A1:A3)', { A1: "a", A3: "c" }), "a--c");
  assert.equal(evalWith('=JOIN("/", A1:A2)', { A1: "x", A2: "y" }), "x/y");
  assert.equal(evalWith("=CONCAT(A1:A3)", { A1: "1", A2: "2", A3: "3" }), "123");
});

test("SPLIT returns an array whose pieces INDEX can pick", () => {
  assert.equal(evalFormula('=SPLIT("a,b,c", ",")'), "a");
  assert.equal(evalFormula('=INDEX(SPLIT("a,b,c", ","), 1, 3)'), "c");
  assert.equal(evalFormula('=INDEX(SPLIT("1;2", ";"), 1, 2) + 1'), "3", "numeric pieces come back as numbers");
  assert.equal(evalFormula('=COLUMNS(SPLIT("a,,b", ","))'), "2", "empties are dropped by default");
  assert.equal(evalFormula('=COLUMNS(SPLIT("a,,b", ",", TRUE, FALSE))'), "3");
  assert.equal(evalFormula('=INDEX(SPLIT("a-b|c", "-|"), 1, 3)'), "c", "each delimiter character splits");
  assert.equal(evalFormula('=INDEX(SPLIT("a-|b", "-|", FALSE), 1, 2)'), "b", "or the whole string does");
});

test("regular expressions", () => {
  assert.equal(evalFormula('=REGEXMATCH("order 123", "\\d+")'), "TRUE");
  assert.equal(evalFormula('=REGEXEXTRACT("order 123", "\\d+")'), "123");
  assert.equal(evalFormula('=REGEXEXTRACT("a@b.com", "@(.*)")'), "b.com", "a capture group wins");
  assert.equal(evalFormula('=REGEXEXTRACT("abc", "\\d")'), "#N/A");
  assert.equal(evalFormula('=REGEXREPLACE("a1b2", "\\d", "#")'), "a#b#");
  assert.equal(evalFormula('=REGEXMATCH("x", "(")'), "#VALUE!", "a bad pattern is a value error");
});

test("TEXTBEFORE and TEXTAFTER by instance", () => {
  assert.equal(evalFormula('=TEXTBEFORE("a.b.c", ".")'), "a");
  assert.equal(evalFormula('=TEXTBEFORE("a.b.c", ".", 2)'), "a.b");
  assert.equal(evalFormula('=TEXTAFTER("a.b.c", ".")'), "b.c");
  assert.equal(evalFormula('=TEXTAFTER("a.b.c", ".", -1)'), "c");
  assert.equal(evalFormula('=TEXTAFTER("abc", "-")'), "#N/A");
});

test("number-to-text and text-to-number", () => {
  assert.equal(evalFormula('=NUMBERVALUE("1.234,56", ",", ".")'), "1234.56");
  assert.equal(evalFormula('=NUMBERVALUE("12%")'), "0.12");
  assert.equal(evalFormula('=NUMBERVALUE("abc")'), "#VALUE!");
  assert.equal(evalFormula("=FIXED(1234.567)"), "1,234.57");
  assert.equal(evalFormula("=FIXED(1234.567, 1, TRUE)"), "1234.6");
  assert.equal(evalFormula("=FIXED(1234.567, -2)"), "1,200");
  assert.equal(evalFormula("=DOLLAR(1234.567)"), "$1,234.57");
  assert.equal(evalFormula("=DOLLAR(-5)"), "($5.00)");
  assert.equal(evalFormula('=ENCODEURL("a b&c")'), "a%20b%26c");
  assert.equal(evalFormula('=HYPERLINK("https://x.y", "Site")'), "Site");
  assert.equal(evalFormula('=HYPERLINK("https://x.y")'), "https://x.y");
});
