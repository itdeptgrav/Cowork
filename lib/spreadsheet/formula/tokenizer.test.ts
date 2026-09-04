import assert from "node:assert/strict";
import { test } from "node:test";
import { tokenize } from "@/lib/spreadsheet/formula/tokenizer";

const kinds = (s: string) => tokenize(s).map((t) => `${t.type}:${t.value}`);

test("tokenizes arithmetic", () => {
  assert.deepEqual(kinds("1+2*3"), [
    "number:1",
    "op:+",
    "number:2",
    "op:*",
    "number:3",
  ]);
});

test("distinguishes refs from names", () => {
  assert.deepEqual(kinds("A1"), ["ref:A1"]);
  assert.deepEqual(kinds("AA100"), ["ref:AA100"]);
  assert.deepEqual(kinds("$A$1"), ["ref:$A$1"]);
  assert.deepEqual(kinds("SUM"), ["name:SUM"]);
  assert.deepEqual(kinds("A1B"), ["name:A1B"], "not a valid ref, so a name");
});

test("tokenizes a range and a call", () => {
  assert.deepEqual(kinds("SUM(A1:A10)"), [
    "name:SUM",
    "lparen:(",
    "ref:A1",
    "colon::",
    "ref:A10",
    "rparen:)",
  ]);
});

test("tokenizes strings, including escaped quotes", () => {
  assert.deepEqual(kinds('"Hello"'), ['string:Hello']);
  assert.deepEqual(kinds('"a""b"'), ['string:a"b']);
});

test("normalizes != to <> and reads the comparison operators", () => {
  assert.deepEqual(kinds("A1<>B1"), ["ref:A1", "op:<>", "ref:B1"]);
  assert.deepEqual(kinds("A1!=B1"), ["ref:A1", "op:<>", "ref:B1"]);
  assert.deepEqual(kinds(">= <= <>"), ["op:>=", "op:<=", "op:<>"]);
});

test("a function whose name looks like a cell is a name when a bracket follows", () => {
  assert.deepEqual(
    tokenize("LOG10(1000)+ATAN2(1,1)").map((t) => t.type),
    ["name", "lparen", "number", "rparen", "op", "name", "lparen", "number", "comma", "number", "rparen"],
  );
  assert.deepEqual(tokenize("LOG10").map((t) => t.type), ["ref"], "on its own it is still the cell LOG10");
});
