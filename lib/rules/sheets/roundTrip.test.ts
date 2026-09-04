import assert from "node:assert/strict";
import { test } from "node:test";
import {
  roundTripIsLossy,
  roundTripLosses,
  roundTripWarning,
  type WorkbookProbe,
} from "./roundTrip.ts";

const clean: WorkbookProbe = {
  merges: 0,
  colWidths: 0,
  rowHeights: 0,
  decoratedCells: 0,
  formulas: 0,
};

test("a plain grid of data loses nothing, and is not warned about", () => {
  /* The common case, and the one the live link is best at. A warning here
     would train people to click through the one that matters. */
  assert.deepEqual(roundTripLosses(clean), []);
  assert.equal(roundTripIsLossy(clean), false);
  assert.equal(roundTripWarning(clean, "data.xlsx"), null);
});

test("each thing Cowork cannot carry is named on its own", () => {
  assert.deepEqual(roundTripLosses({ ...clean, merges: 3 }), ["3 merged cells"]);
  assert.deepEqual(roundTripLosses({ ...clean, merges: 1 }), ["1 merged cell"]);
  assert.deepEqual(roundTripLosses({ ...clean, colWidths: 8 }), ["column widths"]);
  assert.deepEqual(roundTripLosses({ ...clean, rowHeights: 2 }), ["row heights"]);
  assert.deepEqual(roundTripLosses({ ...clean, decoratedCells: 40 }), [
    "fills, colours and borders",
  ]);
});

test("formula results are named apart from formatting", () => {
  /* The formula text survives; its stored value does not, so the file reads
     blank elsewhere until something recalculates it. Calling that "formatting"
     would be wrong. */
  assert.deepEqual(roundTripLosses({ ...clean, formulas: 40 }), [
    "the saved results of its formulas",
  ]);
});

test("the warning names the file and reads as a sentence", () => {
  const w = roundTripWarning(
    { merges: 2, colWidths: 11, rowHeights: 0, decoratedCells: 90, formulas: 40 },
    "Cowork changes.xlsx",
  );
  assert.ok(w);
  assert.match(w, /“Cowork changes\.xlsx”/);
  /* Oxford-less list with "and" before the last — a sentence, not a dump. */
  assert.match(w, /2 merged cells, column widths, fills, colours and borders and the saved results of its formulas/);
  /* It says WHEN the damage happens, which is the part that makes it act-on-able. */
  assert.match(w, /the first time it saves/);
});

test("a single loss reads without a list", () => {
  const w = roundTripWarning({ ...clean, merges: 1 }, "x.xlsx");
  assert.ok(w);
  assert.match(w, /carries 1 merged cell\./);
  assert.doesNotMatch(w, / and /);
});
