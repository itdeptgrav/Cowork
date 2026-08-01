import assert from "node:assert/strict";
import { test } from "node:test";
import { activeHeading, outlineRows } from "./outline.ts";

test("the first heading sits at the left edge whatever its level", () => {
  const rows = outlineRows([{ pos: 1, level: 3, text: "Background" }]);
  assert.deepEqual(
    rows.map((r) => r.depth),
    [0],
  );
});

test("a skipped level indents by one step, not by the gap", () => {
  /* H1 then H3 throughout is what a document styled by eye looks like. Indenting
     by the raw level would draw it as a broken tree; it is a flat list under one
     title, and the outline says so. */
  const rows = outlineRows([
    { pos: 1, level: 1, text: "Report" },
    { pos: 10, level: 3, text: "One" },
    { pos: 20, level: 3, text: "Two" },
  ]);
  assert.deepEqual(
    rows.map((r) => r.depth),
    [0, 1, 1],
  );
});

test("returning to a shallower level returns to its column", () => {
  const rows = outlineRows([
    { pos: 1, level: 1, text: "A" },
    { pos: 2, level: 2, text: "A.1" },
    { pos: 3, level: 3, text: "A.1.a" },
    { pos: 4, level: 2, text: "A.2" },
    { pos: 5, level: 1, text: "B" },
  ]);
  assert.deepEqual(
    rows.map((r) => r.depth),
    [0, 1, 2, 1, 0],
  );
});

test("a heading nobody has typed into yet is not listed", () => {
  const rows = outlineRows([
    { pos: 1, level: 1, text: "Real" },
    { pos: 2, level: 2, text: "   " },
    { pos: 3, level: 2, text: "" },
  ]);
  assert.deepEqual(
    rows.map((r) => r.text),
    ["Real"],
  );
});

test("an empty heading does not consume the level its children hang from", () => {
  const rows = outlineRows([
    { pos: 1, level: 1, text: "Title" },
    { pos: 2, level: 2, text: "" },
    { pos: 3, level: 3, text: "Under the title" },
  ]);
  assert.deepEqual(
    rows.map((r) => r.depth),
    [0, 1],
  );
});

test("the active heading is the last one above the line, not the nearest", () => {
  const rows = outlineRows([
    { pos: 1, level: 1, text: "A" },
    { pos: 2, level: 1, text: "B" },
    { pos: 3, level: 1, text: "C" },
  ]);
  const offsets = new Map([
    [1, 0],
    [2, 400],
    [3, 900],
  ]);
  assert.equal(activeHeading(rows, offsets, 0), 1);
  assert.equal(activeHeading(rows, offsets, 450), 2);
  /* Scrolled ALMOST to C: still in B, because C's title has not reached the
     top of the view. The nearest heading would already have said C. */
  assert.equal(activeHeading(rows, offsets, 880), 2);
  assert.equal(activeHeading(rows, offsets, 900), 3);
});

test("nothing is active above the first heading", () => {
  const rows = outlineRows([{ pos: 5, level: 1, text: "A" }]);
  assert.equal(activeHeading(rows, new Map([[5, 300]]), 0), null);
});
