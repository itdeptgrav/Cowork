import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCellRef } from "@/lib/spreadsheet/coordinates";
import { FormulaEngine } from "@/lib/spreadsheet/formula/engine";

/** A small harness so tests read in A1 terms. */
function sheet(cells: Record<string, string> = {}) {
  const e = new FormulaEngine();
  const S = "s"; // a single sheet's id, for these single-sheet tests
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

/** Evaluate a single formula in isolation. */
function value(formula: string): string {
  const s = sheet({ A1: formula });
  return s.show("A1");
}

test("=1+2 and =10*5", () => {
  assert.equal(value("=1+2"), "3");
  assert.equal(value("=10*5"), "50");
  assert.equal(value("=2+3*4"), "14");
  assert.equal(value("=(2+3)*4"), "20");
});

test("all arithmetic operators", () => {
  assert.equal(value("=7-2"), "5");
  assert.equal(value("=7/2"), "3.5");
  assert.equal(value("=2^10"), "1024");
  assert.equal(value("=-2^2"), "4", "spreadsheet: (-2)^2");
  assert.equal(value("=50%"), "0.5");
  assert.equal(value("=10%*3"), "0.3");
});

test("comparison operators return booleans", () => {
  assert.equal(value("=1<2"), "TRUE");
  assert.equal(value("=2<=2"), "TRUE");
  assert.equal(value("=3<>3"), "FALSE");
  assert.equal(value("=3=3"), "TRUE");
  assert.equal(value("=5>10"), "FALSE");
  assert.equal(value("=5>=5"), "TRUE");
});

test("string literals", () => {
  assert.equal(value('="Hello"'), "Hello");
  assert.equal(value('="a" = "a"'), "TRUE");
});

test("=A1+B1 across cells", () => {
  const s = sheet({ A1: "10", B1: "20", C1: "=A1+B1" });
  assert.equal(s.show("C1"), "30");
});

test("absolute references evaluate the same as relative", () => {
  const s = sheet({ A1: "7" });
  s.set("B1", "=$A$1");
  s.set("C1", "=A$1");
  s.set("D1", "=$A1");
  assert.equal(s.show("B1"), "7");
  assert.equal(s.show("C1"), "7");
  assert.equal(s.show("D1"), "7");
});

test("=SUM(A1:A5) over a range", () => {
  const s = sheet({ A1: "1", A2: "2", A3: "3", A4: "4", A5: "5" });
  s.set("A6", "=SUM(A1:A5)");
  assert.equal(s.show("A6"), "15");
});

test("=SUM(A1:C10) over a block, ignoring text", () => {
  const s = sheet({ A1: "1", B2: "2", C10: "3", A5: "text" });
  s.set("D1", "=SUM(A1:C10)");
  assert.equal(s.show("D1"), "6");
});

test("AVERAGE, MIN, MAX, COUNT, COUNTA", () => {
  const s = sheet({ A1: "2", A2: "4", A3: "6", A4: "hi", A5: "" });
  s.set("B1", "=AVERAGE(A1:A3)");
  s.set("B2", "=MIN(A1:A5)");
  s.set("B3", "=MAX(A1:A5)");
  s.set("B4", "=COUNT(A1:A5)");
  s.set("B5", "=COUNTA(A1:A5)");
  assert.equal(s.show("B1"), "4");
  assert.equal(s.show("B2"), "2");
  assert.equal(s.show("B3"), "6");
  assert.equal(s.show("B4"), "3", "COUNT counts the three numbers");
  assert.equal(s.show("B5"), "4", "COUNTA counts numbers and text, not blank");
});

test("IF and =IF(A1>10,\"Yes\",\"No\")", () => {
  const s = sheet({ A1: "15" });
  s.set("B1", '=IF(A1>10,"Yes","No")');
  assert.equal(s.show("B1"), "Yes");
  s.set("A1", "5");
  assert.equal(s.show("B1"), "No");
});

test("AND, OR, NOT", () => {
  assert.equal(value("=AND(TRUE,1,2)"), "TRUE");
  assert.equal(value("=AND(TRUE,FALSE)"), "FALSE");
  assert.equal(value("=OR(FALSE,0,1)"), "TRUE");
  assert.equal(value("=NOT(FALSE)"), "TRUE");
});

test("IFERROR catches an error and returns the fallback", () => {
  assert.equal(value("=IFERROR(1/0,\"oops\")"), "oops");
  assert.equal(value("=IFERROR(2+2,\"oops\")"), "4");
});

test("math functions ABS, ROUND family, MOD, POWER", () => {
  assert.equal(value("=ABS(-5)"), "5");
  assert.equal(value("=ROUND(2.567,2)"), "2.57");
  assert.equal(value("=ROUND(2.5,0)"), "3");
  assert.equal(value("=ROUNDUP(2.1,0)"), "3");
  assert.equal(value("=ROUNDDOWN(2.9,0)"), "2");
  assert.equal(value("=MOD(10,3)"), "1");
  assert.equal(value("=MOD(-1,3)"), "2", "sign follows the divisor");
  assert.equal(value("=POWER(2,10)"), "1024");
});

test("nested formulas", () => {
  const s = sheet({});
  for (let i = 1; i <= 10; i++) s.set(`A${i}`, "20");
  s.set("B1", '=IF(SUM(A1:A10)>100,"High","Low")');
  assert.equal(s.show("B1"), "High", "sum is 200 > 100");
  s.set("A1", "1");
  assert.equal(s.show("B1"), "High", "still 181 > 100");
  for (let i = 2; i <= 10; i++) s.set(`A${i}`, "1");
  assert.equal(s.show("B1"), "Low", "sum now 10");
});

test("spreadsheet errors", () => {
  assert.equal(value("=10/0"), "#DIV/0!");
  assert.equal(value('="a"+1'), "#VALUE!");
  assert.equal(value("=FOO()"), "#NAME?");
  assert.equal(value("=NOTAFUNC(1)"), "#NAME?");
  assert.equal(value("=1+"), "#NAME?", "a parse failure surfaces as an error");
});

test("errors propagate through operators and functions", () => {
  const s = sheet({ A1: "=1/0" });
  s.set("B1", "=A1+1");
  s.set("C1", "=SUM(A1,5)");
  assert.equal(s.show("B1"), "#DIV/0!");
  assert.equal(s.show("C1"), "#DIV/0!");
});

test("circular references resolve to #REF! without hanging", () => {
  const s = sheet({});
  s.set("A1", "=B1");
  s.set("B1", "=A1");
  assert.equal(s.show("A1"), "#REF!");
  assert.equal(s.show("B1"), "#REF!");

  const self = sheet({});
  self.set("A1", "=A1+1");
  assert.equal(self.show("A1"), "#REF!");
});

test("dependency recalculation: changing a precedent updates dependents", () => {
  const s = sheet({ A1: "10", B1: "20", C1: "=A1+B1", D1: "=C1*2" });
  assert.equal(s.show("C1"), "30");
  assert.equal(s.show("D1"), "60");

  s.set("A1", "100");
  assert.equal(s.show("C1"), "120", "C1 recalculated");
  assert.equal(s.show("D1"), "240", "D1 recalculated transitively");
});

test("a diamond dependency recalculates once, correctly", () => {
  const s = sheet({ A1: "1", B1: "=A1+1", C1: "=A1+10", D1: "=B1+C1" });
  assert.equal(s.show("D1"), "13"); // (1+1)+(1+10)
  s.set("A1", "5");
  assert.equal(s.show("D1"), "21"); // (5+1)+(5+10) = 6+15
});

test("filling a previously-empty precedent recalculates its dependents", () => {
  const s = sheet({ C1: "=A1+B1" });
  assert.equal(s.show("C1"), "0", "empty precedents are 0");
  s.set("A1", "3");
  s.set("B1", "4");
  assert.equal(s.show("C1"), "7");
});

test("clearing a cell recalculates its dependents", () => {
  const s = sheet({ A1: "10", B1: "=A1*2" });
  assert.equal(s.show("B1"), "20");
  s.set("A1", "");
  assert.equal(s.show("B1"), "0", "A1 blank counts as 0");
});

test("named ranges: a formula reads through a name, and follows it when it moves", () => {
  const engine = new FormulaEngine();
  engine.syncSheets([{ id: "s1", name: "Sheet1" }]);
  engine.setCell("s1", 0, 0, "10");
  engine.setCell("s1", 1, 0, "20");
  engine.setCell("s1", 2, 0, "30");
  engine.setCell("s1", 0, 2, "=SUM(Sales)");
  assert.equal(engine.display("s1", 0, 2).text, "#NAME?", "undefined until the name exists");

  engine.setNamedRanges([{ name: "Sales", sheetId: "s1", top: 0, left: 0, bottom: 1, right: 0 }]);
  assert.equal(engine.display("s1", 0, 2).text, "30", "defined: the formula recomputes untouched");

  engine.setCell("s1", 1, 0, "25");
  assert.equal(engine.display("s1", 0, 2).text, "35", "a cell inside the name is a precedent");

  engine.setNamedRanges([{ name: "sales", sheetId: "s1", top: 0, left: 0, bottom: 2, right: 0 }]);
  assert.equal(engine.display("s1", 0, 2).text, "65", "redefined, case-insensitively");

  engine.setCell("s1", 0, 3, "=Sales");
  assert.equal(engine.display("s1", 0, 3).text, "#VALUE!", "a range where a value is wanted");

  engine.setNamedRanges([]);
  assert.equal(engine.display("s1", 0, 2).text, "#NAME?", "removed: back to unknown");
});
