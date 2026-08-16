/**
 * Performance regression guards.
 *
 * These are not micro-benchmarks and they do not assert "fast" — they assert
 * the COMPLEXITY CLASS of paths that were measured to be quadratic (or linear
 * where they should be constant) and were fixed. Each threshold sits far above
 * the measured time on a development machine and far below what the old
 * implementation took, so the test is stable on a slow CI box yet fails loudly
 * if the quadratic behaviour is reintroduced.
 *
 * Measured before/after, on the machine this was written on:
 *
 *   applyChanges 10,000 cells      ~11,000 ms  →   1.8 ms
 *   csvToWorksheet 20,000 rows     ~75,000 ms  →  24.3 ms
 *   rowY over 480 visible cells         59 ms  →   0.2 ms   (one hidden row)
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCellWrites, createWorksheet, getCellValue, type CellWrite } from "@/lib/spreadsheet/model";
import { applyChanges, buildCommand, revertChanges, type CellEdit } from "@/lib/spreadsheet/history";
import { csvToWorksheet } from "@/lib/spreadsheet/csvio";
import { colX, rowAtY, rowY, totalHeight, type GridMetrics } from "@/lib/spreadsheet/metrics";
import { FormulaEngine } from "@/lib/spreadsheet/formula";

/** Run `fn` and return how long it took, in milliseconds. */
function ms(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

/** A metrics object off the uniform fast path — one hidden row is enough, and
    is what a filter, a hidden row or a single drag-resize all produce. */
function nonUniformMetrics(rows: number): GridMetrics {
  return {
    rows,
    cols: 100,
    defaultRowHeight: 24,
    defaultColWidth: 100,
    rowHeights: {},
    colWidths: {},
    hiddenRows: { 5: true },
    hiddenCols: {},
  };
}

test("bulk cell writes are linear, not quadratic (paste/fill/sort path)", () => {
  const ws = createWorksheet("s", "S", 200_000, 100);
  const edits: CellEdit[] = [];
  for (let i = 0; i < 20_000; i++) edits.push({ row: Math.floor(i / 10), col: i % 10, raw: `v${i}` });
  const command = buildCommand("Bulk", ws, edits);

  const took = ms(() => {
    const next = applyChanges(ws, command.changes);
    assert.equal(getCellValue(next, 0, 0), "v0");
  });
  /* The per-cell `setCellValue` form took ~75 s for this size. */
  assert.ok(took < 2000, `applyChanges of 20k cells took ${took.toFixed(0)}ms`);
});

test("undo of a bulk change is linear too", () => {
  const ws = createWorksheet("s", "S", 200_000, 100);
  const edits: CellEdit[] = [];
  for (let i = 0; i < 20_000; i++) edits.push({ row: Math.floor(i / 10), col: i % 10, raw: `v${i}` });
  const command = buildCommand("Bulk", ws, edits);
  const applied = applyChanges(ws, command.changes);

  const took = ms(() => {
    const back = revertChanges(applied, command.changes);
    assert.equal(getCellValue(back, 0, 0), "");
  });
  assert.ok(took < 2000, `revertChanges of 20k cells took ${took.toFixed(0)}ms`);
});

test("applyCellWrites handles 50k writes without quadratic blowup", () => {
  const ws = createWorksheet("s", "S", 200_000, 100);
  const writes: CellWrite[] = [];
  for (let i = 0; i < 50_000; i++) writes.push({ row: Math.floor(i / 10), col: i % 10, value: `v${i}` });
  const took = ms(() => {
    const next = applyCellWrites(ws, writes);
    assert.equal(Object.keys(next.cells).length, 50_000);
  });
  assert.ok(took < 3000, `applyCellWrites of 50k took ${took.toFixed(0)}ms`);
});

test("CSV import of 20k rows is linear", () => {
  const lines: string[] = [];
  for (let i = 0; i < 20_000; i++) lines.push(`a${i},b${i},c${i}`);
  const text = lines.join("\n");
  const took = ms(() => {
    const ws = csvToWorksheet("s", "Imported", text);
    assert.equal(getCellValue(ws, 19_999, 2), "c19999");
  });
  assert.ok(took < 3000, `csvToWorksheet of 20k rows took ${took.toFixed(0)}ms`);
});

test("row geometry stays fast when a hidden row leaves the uniform fast path", () => {
  const m = nonUniformMetrics(100_000);
  /* A render asks for an offset per visible cell; this is ~10 screenfuls' worth. */
  const took = ms(() => {
    for (let r = 50_000; r < 55_000; r++) rowY(m, r);
  });
  assert.ok(took < 200, `5000 rowY lookups took ${took.toFixed(0)}ms`);
});

test("hit-testing and total size stay fast off the uniform path", () => {
  const m = nonUniformMetrics(100_000);
  const took = ms(() => {
    for (let i = 0; i < 2000; i++) {
      rowAtY(m, 1_200_000);
      totalHeight(m);
      colX(m, 99);
    }
  });
  assert.ok(took < 200, `2000 hit-tests took ${took.toFixed(0)}ms`);
});

test("the engine absorbs a bulk population of 20k cells", () => {
  const engine = new FormulaEngine();
  engine.syncSheets([{ id: "s", name: "Sheet1" }]);
  const took = ms(() => {
    for (let i = 0; i < 20_000; i++) engine.setCell("s", Math.floor(i / 10), i % 10, String(i));
  });
  assert.ok(took < 3000, `20k engine setCell took ${took.toFixed(0)}ms`);
});

test("editing a cell with many dependents recomputes only the dependents", () => {
  const engine = new FormulaEngine();
  engine.syncSheets([{ id: "s", name: "Sheet1" }]);
  for (let i = 0; i < 10_000; i++) engine.setCell("s", i, 0, String(i));
  for (let i = 0; i < 500; i++) engine.setCell("s", i, 5, "=A1*2");

  const took = ms(() => engine.setCell("s", 0, 0, "21"));
  assert.equal(engine.getValue("s", 0, 5), 42);
  /* 500 dependents out of 10,500 cells — the cost must track the dependents,
     not the sheet. */
  assert.ok(took < 500, `edit with 500 dependents took ${took.toFixed(0)}ms`);
});

test("empty cells are never stored, so a cleared sheet costs nothing", () => {
  const ws = createWorksheet("s", "S");
  const writes: CellWrite[] = [];
  for (let i = 0; i < 5000; i++) writes.push({ row: i, col: 0, value: "x" });
  const filled = applyCellWrites(ws, writes);
  assert.equal(Object.keys(filled.cells).length, 5000);

  const cleared = applyCellWrites(
    filled,
    writes.map((w) => ({ ...w, value: "" })),
  );
  assert.equal(Object.keys(cleared.cells).length, 0, "cleared cells leave no keys behind");
});
