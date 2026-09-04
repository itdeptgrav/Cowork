import assert from "node:assert/strict";
import { test } from "node:test";
import { defineName, findName, nameProblem, nameTargetLabel, parseNameBox, readNames, removeName, shiftNames, type NamedRange } from "./names";

const sales: NamedRange = { name: "Sales", sheetId: "s1", range: { top: 1, left: 1, bottom: 9, right: 3 } };

test("a name must look like a word, not a cell, and not a function", () => {
  assert.equal(nameProblem("Sales"), null);
  assert.equal(nameProblem("Q1_Sales"), null);
  assert.equal(nameProblem("Total.2026"), null);
  assert.match(nameProblem("") ?? "", /Type a name/);
  assert.match(nameProblem("Q1") ?? "", /cell address/);
  assert.match(nameProblem("SUM") ?? "", /is a function/);
  assert.match(nameProblem("1st") ?? "", /starts with a letter/);
  assert.match(nameProblem("my name") ?? "", /starts with a letter/);
  assert.match(nameProblem("true") ?? "", /values, not names/);
  assert.match(nameProblem("sales", [sales]) ?? "", /already a name/);
  assert.equal(nameProblem("sales", [sales], "Sales"), null, "renaming to itself is fine");
});

test("defining replaces by name without regard to case, and keeps the list sorted", () => {
  let names = defineName([], sales);
  names = defineName(names, { name: "costs", sheetId: "s1", range: { top: 3, left: 0, bottom: 1, right: 0 } });
  assert.deepEqual(names.map((n) => n.name), ["costs", "Sales"]);
  assert.deepEqual(names[0].range, { top: 1, left: 0, bottom: 3, right: 0 }, "a backwards rectangle is normalised");
  names = defineName(names, { name: "SALES", sheetId: "s2", range: { top: 0, left: 0, bottom: 0, right: 0 } });
  assert.equal(names.length, 2);
  assert.equal(findName(names, "sales")?.sheetId, "s2");
  names = removeName(names, "Costs");
  assert.deepEqual(names.map((n) => n.name), ["SALES"]);
});

test("the target label quotes a sheet name with spaces", () => {
  assert.equal(nameTargetLabel(sales, "Sheet1"), "Sheet1!B2:D10");
  assert.equal(nameTargetLabel(sales, "Sales Data"), "'Sales Data'!B2:D10");
});

test("the name box reads a range, a name, or a name to create", () => {
  assert.deepEqual(parseNameBox("b2:d10", [sales]), { kind: "range", range: { top: 1, left: 1, bottom: 9, right: 3 } });
  assert.deepEqual(parseNameBox("C5", []), { kind: "range", range: { top: 4, left: 2, bottom: 4, right: 2 } });
  assert.equal(parseNameBox("sales", [sales]).kind, "name");
  assert.deepEqual(parseNameBox("Totals", [sales]), { kind: "new", name: "Totals" });
  assert.equal(parseNameBox("SUM", [sales]).kind, "invalid");
  assert.equal(parseNameBox("", [sales]).kind, "invalid");
});

test("inserting and deleting rows moves, shrinks or drops names on that sheet only", () => {
  const other: NamedRange = { name: "Other", sheetId: "s2", range: { top: 5, left: 0, bottom: 5, right: 0 } };
  const insertedAbove = shiftNames([sales, other], "s1", { axis: "row", at: 0, count: 2, mode: "insert" });
  assert.deepEqual(insertedAbove[0].range, { top: 3, left: 1, bottom: 11, right: 3 });
  assert.deepEqual(insertedAbove[1].range, other.range, "another sheet is untouched");

  const insertedInside = shiftNames([sales], "s1", { axis: "row", at: 5, count: 1, mode: "insert" });
  assert.deepEqual(insertedInside[0].range, { top: 1, left: 1, bottom: 10, right: 3 }, "the name grows to keep its rows");

  const deletedInside = shiftNames([sales], "s1", { axis: "row", at: 2, count: 3, mode: "delete" });
  assert.deepEqual(deletedInside[0].range, { top: 1, left: 1, bottom: 6, right: 3 });

  const deletedBelow = shiftNames([sales], "s1", { axis: "row", at: 0, count: 1, mode: "delete" });
  assert.deepEqual(deletedBelow[0].range, { top: 0, left: 1, bottom: 8, right: 3 });

  const deletedAll = shiftNames([sales], "s1", { axis: "row", at: 1, count: 9, mode: "delete" });
  assert.equal(deletedAll.length, 0, "a name whose every row is gone is gone");

  const colsInserted = shiftNames([sales], "s1", { axis: "col", at: 2, count: 1, mode: "insert" });
  assert.deepEqual(colsInserted[0].range, { top: 1, left: 1, bottom: 9, right: 4 });
});

test("stored names are read defensively", () => {
  const raw = [
    { name: "Good", sheetId: "s1", range: { top: 0, left: 0, bottom: 2, right: 2 } },
    { name: "A1", sheetId: "s1", range: { top: 0, left: 0, bottom: 0, right: 0 } },
    { name: "Bad", sheetId: "s1", range: { top: "0", left: 0, bottom: 0, right: 0 } },
    { name: "good", sheetId: "s2", range: { top: 0, left: 0, bottom: 0, right: 0 } },
    "junk",
  ];
  const names = readNames(raw);
  assert.deepEqual(names.map((n) => n.name), ["Good"]);
  assert.deepEqual(readNames(undefined), []);
});
