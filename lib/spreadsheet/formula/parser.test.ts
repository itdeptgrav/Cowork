import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, ParseError } from "@/lib/spreadsheet/formula/parser";

test("precedence: * binds tighter than +", () => {
  assert.deepEqual(parse("1+2*3"), {
    type: "binary",
    op: "+",
    left: { type: "number", value: 1 },
    right: {
      type: "binary",
      op: "*",
      left: { type: "number", value: 2 },
      right: { type: "number", value: 3 },
    },
  });
});

test("unary minus binds tighter than ^ (spreadsheet quirk)", () => {
  // -2^2 parses as (-2)^2
  const ast = parse("-2^2");
  assert.equal(ast.type, "binary");
  assert.deepEqual(ast, {
    type: "binary",
    op: "^",
    left: { type: "unary", op: "-", operand: { type: "number", value: 2 } },
    right: { type: "number", value: 2 },
  });
});

test("^ is left-associative", () => {
  // 2^3^2 parses as (2^3)^2
  const ast = parse("2^3^2");
  assert.equal(ast.type, "binary");
  if (ast.type === "binary") {
    assert.equal(ast.op, "^");
    assert.equal(ast.left.type, "binary");
  }
});

test("percent is a postfix", () => {
  assert.deepEqual(parse("50%"), {
    type: "percent",
    operand: { type: "number", value: 50 },
  });
});

test("absolute references carry their $ flags", () => {
  assert.deepEqual(parse("$A$1"), {
    type: "ref",
    absCol: true,
    col: 0,
    absRow: true,
    row: 0,
  });
  assert.deepEqual(parse("A$1"), {
    type: "ref",
    absCol: false,
    col: 0,
    absRow: true,
    row: 0,
  });
  assert.deepEqual(parse("$A1"), {
    type: "ref",
    absCol: true,
    col: 0,
    absRow: false,
    row: 0,
  });
});

test("ranges and nested calls parse into a tree", () => {
  const ast = parse("IF(SUM(A1:A10)>100,\"High\",\"Low\")");
  assert.equal(ast.type, "call");
  if (ast.type === "call") {
    assert.equal(ast.name, "IF");
    assert.equal(ast.args.length, 3);
    assert.equal(ast.args[0].type, "binary"); // SUM(...) > 100
  }
});

test("a bare word is a named range, resolved later by the engine", () => {
  assert.deepEqual(parse("FOO"), { type: "name", name: "FOO" });
  assert.deepEqual(parse("sum(Sales)"), { type: "call", name: "SUM", args: [{ type: "name", name: "SALES" }] });
});
