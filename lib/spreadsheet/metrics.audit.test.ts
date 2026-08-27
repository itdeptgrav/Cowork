/**
 * Grid geometry audit — offsets, hit-testing and visible windows with hidden
 * and resized lines, and agreement between the uniform fast path and the
 * prefix-sum slow path.
 *
 * Assertions state CORRECT behaviour; failures are tagged `// BUG(...)`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  colAtX,

  colX,
  rowAtY,
  rowHeight,
  rowY,
  totalHeight,
  totalWidth,
  visibleCols,
  visibleRows,
  type GridMetrics,
} from "@/lib/spreadsheet/metrics";

function metrics(overrides: Partial<GridMetrics> = {}): GridMetrics {
  return {
    rows: 100,
    cols: 26,
    defaultRowHeight: 24,
    defaultColWidth: 100,
    rowHeights: {},
    colWidths: {},
    ...overrides,
  };
}

test("AUDIT: uniform and prefix paths agree exactly on an unmodified grid", () => {
  const uniform = metrics();
  // Force the slow path with a no-op override that changes nothing visible…
  // (an override EQUAL to the default still leaves the uniform fast path).
  const slow = metrics({ rowHeights: { 50: 24 }, colWidths: { 10: 100 } });
  for (const i of [0, 1, 25, 99]) {
    assert.equal(rowY(slow, i), rowY(uniform, i), `rowY(${i})`);
  }
  for (const c of [0, 1, 10, 25]) {
    assert.equal(colX(slow, c), colX(uniform, c), `colX(${c})`);
  }
  assert.equal(totalHeight(slow), totalHeight(uniform));
  assert.equal(totalWidth(slow), totalWidth(uniform));
  for (const y of [0, 23, 24, 1199, 2400 - 1]) {
    assert.equal(rowAtY(slow, y), rowAtY(uniform, y), `rowAtY(${y})`);
  }
});

test("AUDIT: a hidden row has zero height and every later offset shrinks by one row", () => {
  const m = metrics({ hiddenRows: { 2: true } });
  assert.equal(rowHeight(m, 2), 0);
  assert.equal(rowY(m, 2), 48, "the hidden row sits where it always did");
  assert.equal(rowY(m, 3), 48, "…and the next row starts at the same offset");
  assert.equal(totalHeight(m), 99 * 24, "the total lost exactly one row");
});

test("AUDIT: a hidden row with a RESIZE override still renders at zero", () => {
  const m = metrics({ hiddenRows: { 5: true }, rowHeights: { 5: 80 } });
  assert.equal(rowHeight(m, 5), 0, "hidden wins over a stored height");
  assert.equal(totalHeight(m), 99 * 24);
});

test("AUDIT: hit-testing lands on the visible line at a hidden boundary", () => {
  // Hide column 2; the pixel where it would have started belongs to column 3.
  const m = metrics({ hiddenCols: { 2: true } });
  assert.equal(colAtX(m, 199), 1, "just left of the seam");
  assert.equal(colAtX(m, 200), 3, "at the seam the HIDDEN column is skipped");
  assert.equal(colAtX(m, 299), 3);
  assert.equal(colAtX(m, 300), 4);
});

test("AUDIT: hit-testing is the exact inverse of offsets for visible lines", () => {
  const m = metrics({
    rowHeights: { 0: 40, 3: 10, 7: 100 },
    hiddenRows: { 4: true, 5: true },
  });
  for (let r = 0; r < 20; r++) {
    if (m.hiddenRows?.[r]) continue;
    const top = rowY(m, r);
    assert.equal(rowAtY(m, top), r, `top edge of row ${r}`);
    assert.equal(rowAtY(m, top + rowHeight(m, r) - 1), r, `bottom pixel of row ${r}`);
  }
});

test("AUDIT: out-of-range coordinates clamp instead of exploding", () => {
  const m = metrics({ rowHeights: { 1: 50 } });
  assert.equal(rowAtY(m, -100), 0);
  assert.equal(rowAtY(m, 10_000_000), 99, "far past the end clamps to the last row");
  assert.equal(colAtX(m, -1), 0);
  assert.equal(colAtX(m, 10_000_000), 25);
  assert.equal(rowY(m, 0), 0);
  assert.equal(rowY(m, -5), 0, "a negative index reads as the top");
});

test("AUDIT: total sizes equal the offset just past the last line, resizes included", () => {
  const m = metrics({ rowHeights: { 0: 100 }, colWidths: { 25: 300 } });
  assert.equal(totalHeight(m), 100 + 99 * 24);
  assert.equal(totalWidth(m), 25 * 100 + 300);
  assert.equal(rowY(m, m.rows), totalHeight(m), "rowY at rows == total");
  assert.equal(colX(m, m.cols), totalWidth(m), "colX at cols == total");
});

test("AUDIT: visible windows cover the viewport inclusively and clamp at the edges", () => {
  const m = metrics();
  // At the origin the buffer cannot go negative.
  assert.deepEqual(visibleRows(m, 0, 240, 0), { start: 0, end: 10 });
  const atOrigin = visibleRows(m, 0, 240);
  assert.equal(atOrigin.start, 0);
  // Scrolled to the very bottom the end clamps to the last row.
  const total = totalHeight(m);
  const atEnd = visibleRows(m, total - 240, 240);
  assert.equal(atEnd.end, 99);
  assert.ok(atEnd.start <= 99 - 10 + 1 + 4, "the window still spans the viewport");
  // Columns likewise.
  const cols = visibleCols(m, 0, 500, 0);
  assert.deepEqual(cols, { start: 0, end: 5 });
});

test("AUDIT: a window over hidden rows still spans the pixels asked for", () => {
  // Rows 0..9 hidden: scrollTop 0 must start rendering at the first VISIBLE row.
  const hiddenRows: Record<number, true> = {};
  for (let r = 0; r < 10; r++) hiddenRows[r] = true;
  const m = metrics({ hiddenRows });
  const win = visibleRows(m, 0, 240, 0);
  assert.equal(win.start, 10, "the window starts at the first VISIBLE row, skipping the hidden band");
  assert.ok(win.end >= 19, "enough real rows are included to fill 240px (10 visible rows)");
  assert.equal(rowAtY(m, 0), 10, "the pixel origin belongs to the first visible row");
});

test("AUDIT: an all-hidden axis yields zero total and does not crash hit-testing", () => {
  const hiddenRows: Record<number, true> = {};
  for (let r = 0; r < 100; r++) hiddenRows[r] = true;
  const m = metrics({ hiddenRows });
  assert.equal(totalHeight(m), 0);
  assert.doesNotThrow(() => rowAtY(m, 0));
  assert.doesNotThrow(() => visibleRows(m, 0, 240));
});
