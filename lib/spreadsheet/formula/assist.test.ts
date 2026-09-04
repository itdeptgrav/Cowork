import assert from "node:assert/strict";
import { test } from "node:test";
import { formulaAssist, activeArgIndex } from "@/lib/spreadsheet/formula/assist";
import { FUNCTION_HELP } from "@/lib/spreadsheet/formula/catalog";

/** Caret at the end of the text unless a `|` marks it. */
function at(text: string): { text: string; caret: number } {
  const caret = text.indexOf("|");
  return caret === -1
    ? { text, caret: text.length }
    : { text: text.replace("|", ""), caret };
}

test("no assistance for a non-formula", () => {
  const { text, caret } = at("SUM");
  assert.equal(formulaAssist(text, caret), null);
});

test("a bare name prefix suggests matching functions", () => {
  const { text, caret } = at("=SU");
  const a = formulaAssist(text, caret);
  assert.ok(a && a.kind === "list");
  assert.equal(a.token, "SU");
  assert.equal(a.tokenStart, 1);
  const names = a.matches.map((m) => m.name);
  assert.ok(names.includes("SUM"));
  assert.ok(names.includes("SUMIF"));
});

test("a name matching nothing offers no list", () => {
  const { text, caret } = at("=ZZZ");
  assert.equal(formulaAssist(text, caret), null);
});

test("a cell reference is not a function suggestion", () => {
  const { text, caret } = at("=A1");
  assert.equal(formulaAssist(text, caret), null);
});

test("inside a call, the signature is shown", () => {
  const { text, caret } = at("=SUM(");
  const a = formulaAssist(text, caret);
  assert.ok(a && a.kind === "signature");
  assert.equal(a.help.name, "SUM");
  assert.equal(a.argIndex, 0);
});

test("commas advance the active argument", () => {
  const { text, caret } = at("=VLOOKUP(A1, B1:C9, ");
  const a = formulaAssist(text, caret);
  assert.ok(a && a.kind === "signature");
  assert.equal(a.help.name, "VLOOKUP");
  assert.equal(a.argIndex, 2);
});

test("a nested function prefix wins over the outer signature", () => {
  const { text, caret } = at("=IF(SU");
  const a = formulaAssist(text, caret);
  assert.ok(a && a.kind === "list");
  assert.ok(a.matches.some((m) => m.name === "SUM"));
});

test("a completed call after its close offers nothing", () => {
  const { text, caret } = at("=SUM(A1)");
  assert.equal(formulaAssist(text, caret), null);
});

test("no assistance while typing inside a string", () => {
  const { text, caret } = at('=IF(A1, "SU');
  assert.equal(formulaAssist(text, caret), null);
});

test("a closed string does not swallow the following call", () => {
  const { text, caret } = at('=IF(A1, "x", SU');
  const a = formulaAssist(text, caret);
  assert.ok(a && a.kind === "list");
  assert.ok(a.matches.some((m) => m.name === "SUM"));
});

test("active argument clamps onto a repeatable tail", () => {
  const sum = FUNCTION_HELP.SUM;
  assert.equal(activeArgIndex(sum, 0), 0);
  assert.equal(activeArgIndex(sum, 5), 1); // past the list → the repeatable value2
  const abs = FUNCTION_HELP.ABS;
  assert.equal(activeArgIndex(abs, 3), -1); // fixed arity → nothing to highlight
});

test("named ranges are offered beside functions, and inserted bare", () => {
  const a = formulaAssist("=1+Sum", 6, ["Sumy", "Sumx", "Costs"]);
  assert.ok(a && a.kind === "list");
  if (a && a.kind === "list") {
    assert.equal(a.matches[0].name, "SUM", "functions first, exact first");
    const names = a.matches.filter((m) => m.named).map((m) => m.name);
    assert.deepEqual(names, ["Sumx", "Sumy"], "then the names, in order");
  }
  const onlyName = formulaAssist("=Cos", 4, ["Costs"]);
  assert.ok(onlyName && onlyName.kind === "list");
  if (onlyName && onlyName.kind === "list") {
    assert.deepEqual(onlyName.matches.map((m) => m.name), ["COS", "COSH", "Costs"]);
  }
});
