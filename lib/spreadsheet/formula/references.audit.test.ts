/**
 * Copy/fill adjustment audit — relative references walk with the copy, anchors
 * hold, and everything else survives verbatim. Expected behaviour is Google
 * Sheets' / Excel's copy-paste and fill-handle semantics.
 *
 * (The documented deliberate divergence — clamping at the sheet edge instead of
 * producing #REF! — is not asserted against; see references.ts's own comment.)
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { adjustFormula, shiftReference } from "@/lib/spreadsheet/formula/references";

test("AUDIT: negative and mixed deltas move relative refs both ways", () => {
  assert.equal(adjustFormula("=B3", -1, 2), "=D2");
  assert.equal(adjustFormula("=C4+D4", 0, -1), "=B4+C4");
  assert.equal(adjustFormula("=A1", 3, 0), "=A4");
});

test("AUDIT: anchors hold their component under any delta", () => {
  assert.equal(adjustFormula("=$B$2+B$2+$B2+B2", 2, 3), "=$B$2+E$2+$B4+E4");
  assert.equal(shiftReference("$Z$9", 5, 5), "$Z$9");
});

test("AUDIT: a copied cross-sheet reference shifts its cell but keeps its sheet", () => {
  assert.equal(adjustFormula("=Sheet2!A1", 1, 0), "=Sheet2!A2");
  assert.equal(adjustFormula("='My Sheet'!A1+A1", 1, 1), "='My Sheet'!B2+B2");
  assert.equal(
    adjustFormula("=SUM('Sales Data'!A1:B2)", 2, 0),
    "=SUM('Sales Data'!A3:B4)",
    "a quoted qualifier survives and the range still walks",
  );
});

test("AUDIT: ranges walk both endpoints, anchors independently", () => {
  assert.equal(adjustFormula("=SUM($A$1:B2)", 1, 1), "=SUM($A$1:C3)");
  assert.equal(adjustFormula("=SUM(A1:$B$2)", 1, 1), "=SUM(B2:$B$2)");
});

test("AUDIT: strings that look like refs, and error literals, are untouched", () => {
  assert.equal(adjustFormula('=CONCATENATE("A1",A1)', 1, 0), '=CONCATENATE("A1",A2)');
  assert.equal(adjustFormula('=LEN("a""b")+A1', 1, 0), '=LEN("a""b")+A2', "doubled quotes re-emit");
  assert.equal(adjustFormula("=#REF!+A1", 1, 0), "=#REF!+A2");
});

test("AUDIT: number spellings and the percent postfix survive a shift", () => {
  assert.equal(adjustFormula("=1e3+A1", 1, 0), "=1e3+A2", "scientific spelling kept");
  assert.equal(adjustFormula("=A1%", 1, 0), "=A2%");
  assert.equal(adjustFormula("=A1<>B1", 0, 1), "=B1<>C1", "operators re-emit");
});

test("AUDIT: the fill delta crosses the Z/AA column boundary", () => {
  assert.equal(adjustFormula("=Z1", 0, 1), "=AA1");
  assert.equal(adjustFormula("=AA1", 0, -1), "=Z1");
  assert.equal(shiftReference("ZZ1", 0, 1), "AAA1");
});

test("AUDIT: only true references shift — names that fail the ref shape do not", () => {
  // A1B is a name, not a reference; a shift must not mangle it.
  assert.equal(adjustFormula("=A1B", 1, 1), "=A1B");
});
