/**
 * Formula-assist and catalog audit — caret analysis at awkward positions,
 * nesting, strings with escapes, unknown calls, and the prefix matcher.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { activeArgIndex, formulaAssist } from "@/lib/spreadsheet/formula/assist";
import { FUNCTION_HELP, matchFunctions, renderSignature } from "@/lib/spreadsheet/formula/catalog";

/** Caret at the `|` marker, or at the end when absent. */
function at(text: string): { text: string; caret: number } {
  const caret = text.indexOf("|");
  return caret === -1
    ? { text, caret: text.length }
    : { text: text.replace("|", ""), caret };
}

function assist(marked: string) {
  const { text, caret } = at(marked);
  return formulaAssist(text, caret);
}

/* ── The list ─────────────────────────────────────────────────────────────── */

test("AUDIT: a lowercase prefix matches case-insensitively", () => {
  const a = assist("=su");
  assert.ok(a && a.kind === "list");
  assert.equal(a.token, "su");
  assert.ok(a.matches.some((m) => m.name === "SUM"));
});

test("AUDIT: an exact name sorts first among its extensions", () => {
  const a = assist("=SUM");
  assert.ok(a && a.kind === "list");
  assert.equal(a.matches[0].name, "SUM", "exact hit before SUMIF/SUMIFS");
});

test("AUDIT: a prefix with digits narrows correctly", () => {
  const a = assist("=SUMI");
  assert.ok(a && a.kind === "list");
  assert.deepEqual(
    a.matches.map((m) => m.name),
    ["SUMIF", "SUMIFS"],
  );
});

/* ── The signature ────────────────────────────────────────────────────────── */

test("AUDIT: commas inside a nested call do not advance the outer argument", () => {
  const a = assist("=VLOOKUP(A1,IF(B1,1,2),|");
  assert.ok(a && a.kind === "signature");
  assert.equal(a.help.name, "VLOOKUP");
  assert.equal(a.argIndex, 2);
});

test("AUDIT: a parenthesised group is not a call frame", () => {
  const a = assist("=SUM((1+2),|");
  assert.ok(a && a.kind === "signature");
  assert.equal(a.help.name, "SUM");
  assert.equal(a.argIndex, 1);
});

test("AUDIT: after an inner call closes, the outer frame resumes", () => {
  const a = assist("=IF(SUM(A1),|");
  assert.ok(a && a.kind === "signature");
  assert.equal(a.help.name, "IF");
  assert.equal(a.argIndex, 1);
});

test("AUDIT: a caret just before the closing paren still explains the call", () => {
  const a = assist("=SUM(A1|)");
  assert.ok(a && a.kind === "signature", "A1 matches no function, so the frame shows");
  assert.equal(a.help.name, "SUM");
  assert.equal(a.argIndex, 0);
});

test("AUDIT: a non-name argument prefix falls back to the innermost frame", () => {
  const a = assist("=IF(A1>2,SUM(B|");
  assert.ok(a && a.kind === "signature", "no function starts with B");
  assert.equal(a.help.name, "SUM");
  assert.equal(a.argIndex, 0);
});

test("AUDIT: a range colon does not disturb the argument index", () => {
  const a = assist("=SUM(A1:A5|");
  assert.ok(a && a.kind === "signature");
  assert.equal(a.argIndex, 0);
});

/* ── Strings and edge positions ───────────────────────────────────────────── */

test("AUDIT: a doubled-quote escape does not derail string tracking", () => {
  const a = assist('=IF("a""b", SU|');
  assert.ok(a && a.kind === "list", "the string closed; SU is being typed");
  assert.ok(a.matches.some((m) => m.name === "SUM"));
});

test("AUDIT: inside an open string, nothing is offered", () => {
  assert.equal(assist('=SUM("abc|'), null);
  assert.equal(assist('=IF(A1, "SU|'), null);
});

test("AUDIT: an unknown call offers nothing rather than junk", () => {
  assert.equal(assist("=FOOBAR(|"), null);
  assert.equal(assist("=FOOBAR(1,|"), null);
});

test("AUDIT: unbalanced closing parens do not crash the scanner", () => {
  assert.equal(assist("=SUM(1))|"), null);
  assert.equal(assist("=)|"), null);
});

test("AUDIT: degenerate carets", () => {
  const { text } = at("=SUM(");
  assert.equal(formulaAssist(text, 0), null, "caret before the =");
  assert.equal(formulaAssist(text, 1), null, "caret right after the =");
  assert.equal(formulaAssist("", 0), null);
  assert.equal(formulaAssist("SUM(", 4), null, "not a formula at all");
});

/* ── activeArgIndex and the catalog helpers ───────────────────────────────── */

test("AUDIT: activeArgIndex clamps to a repeatable tail and stops on fixed arity", () => {
  const sum = FUNCTION_HELP.SUM;
  assert.equal(activeArgIndex(sum, 1), 1);
  assert.equal(activeArgIndex(sum, 99), 1, "stays on the repeatable tail");
  const round = FUNCTION_HELP.ROUND;
  assert.equal(activeArgIndex(round, 2), -1, "past a fixed list → no highlight");
  assert.equal(activeArgIndex(FUNCTION_HELP.TODAY, 0), -1, "zero-arg function");
});

test("AUDIT: pair-repeating functions render their explicit signature", () => {
  assert.equal(renderSignature(FUNCTION_HELP.SWITCH), FUNCTION_HELP.SWITCH.signature);
  assert.equal(renderSignature(FUNCTION_HELP.IFS), FUNCTION_HELP.IFS.signature);
  assert.equal(
    renderSignature(FUNCTION_HELP.VLOOKUP),
    "VLOOKUP(search_key, range, index, [is_sorted])",
  );
});

test("AUDIT: matchFunctions caps its list and returns nothing for junk", () => {
  assert.ok(matchFunctions("S").length <= 8);
  assert.deepEqual(matchFunctions("QQQ"), []);
  assert.deepEqual(matchFunctions("").length, 0);
  assert.deepEqual(
    matchFunctions("conc").map((h) => h.name),
    ["CONCATENATE"],
  );
});
