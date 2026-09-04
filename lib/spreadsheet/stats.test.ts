import assert from "node:assert/strict";
import { test } from "node:test";
import { BLANK } from "./formula/value";
import { DIV0 } from "./formula/errors";
import { selectionStats, statsLine } from "./stats";

test("numbers are summed and averaged; text counts but does not add", () => {
  const s = selectionStats([10, 20, "x", BLANK, "", 30, DIV0, true]);
  assert.equal(s.count, 6, "text, numbers, an error and a boolean all count; blanks do not");
  assert.equal(s.numeric, 3);
  assert.equal(s.sum, 60);
  assert.equal(s.average, 20);
  assert.equal(s.min, 10);
  assert.equal(s.max, 30);
});

test("the status line is silent for a single cell and skips arithmetic for text-only selections", () => {
  assert.deepEqual(statsLine(selectionStats([5])), []);
  assert.deepEqual(statsLine(selectionStats(["a", "b"])), [{ label: "Count", value: "2" }]);
  assert.deepEqual(
    statsLine(selectionStats([0.1, 0.2])),
    [
      { label: "Sum", value: "0.3" },
      { label: "Average", value: "0.15" },
      { label: "Min", value: "0.1" },
      { label: "Max", value: "0.2" },
      { label: "Count", value: "2" },
    ],
    "floating-point noise is trimmed",
  );
});
