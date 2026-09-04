import assert from "node:assert/strict";
import { test } from "node:test";
import {
  colWidthPx,
  colWidthToWch,
  rowHeightPx,
  rowHeightToHpt,
} from "./xlsxMetrics.ts";

test("a column with no stored width answers null, not a default", () => {
  /* "No stored width" and "exactly the default" are different facts. Returning
     a number for the first pins every column and stops the sheet's own default
     ever applying. */
  assert.equal(colWidthPx(undefined), null);
  assert.equal(colWidthPx(null), null);
  assert.equal(colWidthPx({}), null);
  assert.equal(colWidthPx({ wch: 0 }), null);
});

test("characters convert by Excel's own approximation", () => {
  /* px = wch * 7 + 5. The change log's 34-character column is what was being
     shown at the default width, and the text cut off. */
  assert.equal(colWidthPx({ wch: 34 }), 243);
  assert.equal(colWidthPx({ wch: 10 }), 75);
});

test("pixels in the file win over characters, because they are exact", () => {
  assert.equal(colWidthPx({ wch: 34, wpx: 200 }), 200);
});

test("`width` is accepted as an alias for `wch`", () => {
  /* SheetJS fills whichever the file carried. */
  assert.equal(colWidthPx({ width: 10 }), 75);
});

test("the round trip lands back where it started", () => {
  for (const wch of [8, 10, 22, 34, 56]) {
    const px = colWidthPx({ wch });
    assert.ok(px);
    assert.equal(Math.round(colWidthToWch(px)), wch, `wch ${wch}`);
  }
});

test("a column is never exported at zero width", () => {
  /* Zero reads as HIDDEN in Excel, which is a different thing from narrow. */
  assert.ok(colWidthToWch(0) >= 1);
  assert.ok(colWidthToWch(3) >= 1);
});

test("row heights convert through points at 96dpi", () => {
  assert.equal(rowHeightPx({ hpt: 15 }), 20);
  assert.equal(rowHeightPx({ hpx: 24 }), 24);
  assert.equal(rowHeightPx({}), null);
  assert.equal(rowHeightPx(undefined), null);
});

test("row heights round trip", () => {
  for (const px of [20, 24, 40, 62]) {
    assert.equal(Math.round(rowHeightPx({ hpt: rowHeightToHpt(px) }) ?? 0), px);
  }
});
