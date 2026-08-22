/**
 * FormulaEngine audit — dependency recalculation, circular references and their
 * recovery, error healing, blank/deleted cells, and cross-sheet resolution.
 *
 * Expected behaviour is Google Sheets' (a circular reference is #REF!, which the
 * engine's own errors.ts documents as the deliberate choice).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCellRef } from "@/lib/spreadsheet/coordinates";
import { FormulaEngine } from "@/lib/spreadsheet/formula/engine";

function book(sheets: { id: string; name: string; cells?: Record<string, string> }[]) {
  const engine = new FormulaEngine();
  engine.syncSheets(sheets.map(({ id, name }) => ({ id, name })));
  for (const s of sheets) {
    for (const [ref, raw] of Object.entries(s.cells ?? {})) {
      const p = parseCellRef(ref)!;
      engine.setCell(s.id, p.row, p.col, raw);
    }
  }
  return {
    engine,
    set(id: string, ref: string, raw: string) {
      const p = parseCellRef(ref)!;
      engine.setCell(id, p.row, p.col, raw);
    },
    show(id: string, ref: string): string {
      const p = parseCellRef(ref)!;
      return engine.display(id, p.row, p.col).text;
    },
    align(id: string, ref: string): string {
      const p = parseCellRef(ref)!;
      return engine.display(id, p.row, p.col).align;
    },
  };
}

const single = (cells: Record<string, string> = {}) =>
  book([{ id: "s", name: "Sheet1", cells }]);

/* ── Recalculation chains ─────────────────────────────────────────────────── */

test("AUDIT: a three-link chain recalculates end to end", () => {
  const b = single({ A1: "1", B1: "=A1+1", C1: "=B1+1", D1: "=C1+1" });
  assert.equal(b.show("s", "D1"), "4");
  b.set("s", "A1", "10");
  assert.equal(b.show("s", "B1"), "11");
  assert.equal(b.show("s", "C1"), "12");
  assert.equal(b.show("s", "D1"), "13");
});

test("AUDIT: a chain through a range recalculates", () => {
  const b = single({ A1: "1", A2: "2", A3: "3", B1: "=SUM(A1:A3)", C1: "=B1*2" });
  assert.equal(b.show("s", "C1"), "12");
  b.set("s", "A2", "20");
  assert.equal(b.show("s", "C1"), "48");
});

test("AUDIT: cross-sheet dependents recalculate without a rebuild", () => {
  const b = book([
    { id: "s1", name: "Summary" },
    { id: "s2", name: "Data", cells: { A1: "5" } },
  ]);
  b.set("s1", "A1", "=Data!A1*2");
  assert.equal(b.show("s1", "A1"), "10");
  b.set("s2", "A1", "7");
  assert.equal(b.show("s1", "A1"), "14", "the Summary formula follows the Data edit");
});

/* ── Circular references ──────────────────────────────────────────────────── */

test("AUDIT: a formula whose range contains itself is circular", () => {
  const b = single();
  b.set("s", "A1", "=SUM(A1:B1)");
  assert.equal(b.show("s", "A1"), "#REF!");
});

test("AUDIT: a three-cell cycle errors everywhere, then recovers when broken", () => {
  const b = single();
  b.set("s", "A1", "=B1");
  b.set("s", "B1", "=C1");
  b.set("s", "C1", "=A1");
  assert.equal(b.show("s", "A1"), "#REF!");
  assert.equal(b.show("s", "B1"), "#REF!");
  assert.equal(b.show("s", "C1"), "#REF!");

  b.set("s", "C1", "7"); // break the cycle
  assert.equal(b.show("s", "C1"), "7");
  assert.equal(b.show("s", "B1"), "7", "B1 recovers");
  assert.equal(b.show("s", "A1"), "7", "A1 recovers transitively");
});

test("AUDIT: a cycle spanning two sheets errors and recovers", () => {
  const b = book([
    { id: "s1", name: "Sheet1" },
    { id: "s2", name: "Sheet2" },
  ]);
  b.set("s1", "A1", "=Sheet2!A1");
  b.set("s2", "A1", "=Sheet1!A1");
  assert.equal(b.show("s1", "A1"), "#REF!");
  assert.equal(b.show("s2", "A1"), "#REF!");

  b.set("s2", "A1", "3");
  assert.equal(b.show("s1", "A1"), "3");
});

test("AUDIT: a cell outside the cycle sees the cycle's error, then heals", () => {
  const b = single();
  b.set("s", "A1", "=B1");
  b.set("s", "B1", "=A1");
  b.set("s", "C1", "=A1+1");
  assert.equal(b.show("s", "C1"), "#REF!");
  b.set("s", "B1", "4");
  assert.equal(b.show("s", "C1"), "5");
});

/* ── Error healing ────────────────────────────────────────────────────────── */

test("AUDIT: fixing a #NAME? heals its dependents", () => {
  const b = single();
  b.set("s", "A1", "=NOPE(1)");
  b.set("s", "B1", "=A1+1");
  assert.equal(b.show("s", "A1"), "#NAME?");
  assert.equal(b.show("s", "B1"), "#NAME?");
  b.set("s", "A1", "=SUM(1,1)");
  assert.equal(b.show("s", "B1"), "3");
});

test("AUDIT: fixing a parse failure heals its dependents", () => {
  const b = single();
  b.set("s", "A1", "=1+");
  b.set("s", "B1", "=A1*2");
  assert.equal(b.show("s", "A1"), "#NAME?");
  assert.equal(b.show("s", "B1"), "#NAME?");
  b.set("s", "A1", "=2");
  assert.equal(b.show("s", "B1"), "4");
});

test("AUDIT: referencing an error cell propagates; IFERROR catches it", () => {
  const b = single({ A1: "=1/0", B1: "=A1", C1: '=IFERROR(A1,"x")' });
  assert.equal(b.show("s", "B1"), "#DIV/0!");
  assert.equal(b.show("s", "C1"), "x");
});

/* ── Blank and deleted cells ──────────────────────────────────────────────── */

test("AUDIT: deleting a referenced cell recalculates arithmetic to 0", () => {
  const b = single({ A1: "5", B1: "=A1*2" });
  assert.equal(b.show("s", "B1"), "10");
  b.set("s", "A1", "");
  assert.equal(b.show("s", "B1"), "0");
});

test("AUDIT: a bare reference to an empty cell displays 0, as in Sheets", () => {
  // Sheets and Excel display 0 for =A1 when A1 is empty (the classic
  // =IF(A1="","",A1) workaround exists precisely because of it) — and the same
  // holds when a function returns the blank. An empty CELL still shows nothing.
  const b = single({ B2: "=A1" });
  assert.equal(b.show("s", "B2"), "0");
  const c = single({ B2: "=IF(TRUE,A1)" });
  assert.equal(c.show("s", "B2"), "0");
  assert.equal(b.show("s", "J9"), "", "an empty cell itself stays empty");
});

/* ── Cross-sheet resolution ───────────────────────────────────────────────── */

test("AUDIT: quoted sheet names resolve, case-insensitively", () => {
  const b = book([
    { id: "s1", name: "Summary" },
    { id: "s2", name: "Sales Data", cells: { B2: "41" } },
  ]);
  b.set("s1", "A1", "='Sales Data'!B2");
  b.set("s1", "A2", "='SALES DATA'!B2");
  b.set("s1", "A3", "='sales data'!B2");
  assert.equal(b.show("s1", "A1"), "41");
  assert.equal(b.show("s1", "A2"), "41");
  assert.equal(b.show("s1", "A3"), "41");
});

test("AUDIT: a reference to a sheet that does not exist is #REF!", () => {
  const b = single();
  b.set("s", "A1", "=Missing!A1");
  assert.equal(b.show("s", "A1"), "#REF!");
});

test("AUDIT: deleting a referenced sheet turns its references #REF! after resync", () => {
  const b = book([
    { id: "s1", name: "Sheet1" },
    { id: "s2", name: "Sheet2", cells: { A1: "7" } },
  ]);
  b.set("s1", "A1", "=Sheet2!A1");
  assert.equal(b.show("s1", "A1"), "7");

  // What the workbook layer does on sheet deletion: resync + rebuild.
  b.engine.syncSheets([{ id: "s1", name: "Sheet1" }]);
  b.engine.clear();
  b.set("s1", "A1", "=Sheet2!A1");
  assert.equal(b.show("s1", "A1"), "#REF!");
});

/* ── evaluateAdHoc ────────────────────────────────────────────────────────── */

test("AUDIT: evaluateAdHoc reads live values, honours overrides, writes nothing", () => {
  const b = single({ A1: "5" });
  assert.equal(b.engine.evaluateAdHoc("s", "=A1>3"), true);
  assert.equal(b.engine.evaluateAdHoc("s", "=A1>3", [{ row: 0, col: 0, value: 2 }]), false);
  assert.equal(b.show("s", "A1"), "5", "the override did not leak into the sheet");
});

/* ── Display ──────────────────────────────────────────────────────────────── */

test("AUDIT: display alignment by type", () => {
  const b = single({ A1: "12", A2: "=1=1", A3: "=1/0", A4: "hello" });
  assert.equal(b.align("s", "A1"), "right", "numbers right");
  assert.equal(b.align("s", "A2"), "center", "booleans centred");
  assert.equal(b.align("s", "A3"), "center", "errors centred");
  assert.equal(b.align("s", "A4"), "left", "text left");
  assert.equal(b.align("s", "J9"), "left", "a blank cell left");
});
