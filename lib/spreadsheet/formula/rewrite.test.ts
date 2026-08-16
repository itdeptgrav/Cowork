import assert from "node:assert/strict";
import { test } from "node:test";
import { transformStructural, type StructuralOp } from "@/lib/spreadsheet/formula/rewrite";
import { FormulaEngine } from "@/lib/spreadsheet/formula";

const rowInsert = (at: number, count = 1): StructuralOp => ({ axis: "row", at, count, mode: "insert" });
const rowDelete = (at: number, count = 1): StructuralOp => ({ axis: "row", at, count, mode: "delete" });
const colInsert = (at: number, count = 1): StructuralOp => ({ axis: "col", at, count, mode: "insert" });
const colDelete = (at: number, count = 1): StructuralOp => ({ axis: "col", at, count, mode: "delete" });

test("inserting a row shifts references at/after it down (the spec example)", () => {
  // Insert above row 1 (index 0): =A1+A2 must still name the same two values.
  assert.equal(transformStructural("=A1+A2", rowInsert(0)), "=A2+A3");
  assert.equal(transformStructural("=SUM(A1:A3)", rowInsert(0)), "=SUM(A2:A4)");
});

test("a structural shift moves ABSOLUTE references too (unlike a copy)", () => {
  // The data moved, so a $-anchored reference follows it.
  assert.equal(transformStructural("=$A$1", rowInsert(0)), "=$A$2");
  assert.equal(transformStructural("=A$1", rowInsert(0)), "=A$2");
  assert.equal(transformStructural("=$A1", colInsert(0)), "=$B1");
});

test("references before the insertion point are untouched", () => {
  assert.equal(transformStructural("=A1", rowInsert(5)), "=A1");
  assert.equal(transformStructural("=A3", rowInsert(2)), "=A4");
});

test("deleting a row turns references INTO it to #REF!, and shifts those below up", () => {
  assert.equal(transformStructural("=A1", rowDelete(0)), "=#REF!");
  assert.equal(transformStructural("=A2", rowDelete(0)), "=A1");
  assert.equal(transformStructural("=A1+A2", rowDelete(0)), "=#REF!+A1");
});

test("deleting inside a range contracts it; deleting all of it is #REF!", () => {
  // A1:A3 lose row 1 → A1:A2 (the survivors renumber).
  assert.equal(transformStructural("=SUM(A1:A3)", rowDelete(0)), "=SUM(A1:A2)");
  // A1:A2 entirely deleted → the range is gone.
  assert.equal(transformStructural("=SUM(A1:A2)", rowDelete(0, 2)), "=SUM(#REF!)");
});

test("column insert/delete shift the column letters", () => {
  assert.equal(transformStructural("=A1", colInsert(0)), "=B1");
  assert.equal(transformStructural("=B1", colDelete(0)), "=A1");
  assert.equal(transformStructural("=A1", colDelete(0)), "=#REF!");
});

test("only references change — operators, numbers and functions pass through", () => {
  assert.equal(transformStructural('=IF(A1>0,"x",B2)', rowInsert(0)), '=IF(A2>0,"x",B3)');
  assert.equal(transformStructural("hello", rowInsert(0)), "hello");
});

test("#REF! is a real literal the engine parses and evaluates", () => {
  const engine = new FormulaEngine();
  engine.setCell("s", 0, 0, "=#REF!+1");
  assert.equal(engine.display("s", 0, 0).text, "#REF!");
});
