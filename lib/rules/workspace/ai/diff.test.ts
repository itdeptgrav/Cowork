import assert from "node:assert/strict";
import { test } from "node:test";
import { diffChangeRatio, wordDiff } from "./diff.ts";

test("identical text is all `same`, one run", () => {
  const ops = wordDiff("The team finished the report.", "The team finished the report.");
  assert.deepEqual(ops, [{ kind: "same", text: "The team finished the report." }]);
});

test("a single changed word shows as remove-then-add around unchanged runs", () => {
  const ops = wordDiff("The team have finished.", "The team has finished.");
  const kinds = ops.map((o) => o.kind);
  assert.deepEqual(kinds, ["same", "remove", "add", "same"]);
  assert.equal(
    ops.find((o) => o.kind === "remove")?.text.trim(),
    "have",
  );
  assert.equal(
    ops.find((o) => o.kind === "add")?.text.trim(),
    "has",
  );
});

test("a pure insertion has no `remove` op", () => {
  const ops = wordDiff("The report.", "The finished report.");
  assert.ok(!ops.some((o) => o.kind === "remove"));
  assert.ok(ops.some((o) => o.kind === "add"));
});

test("an empty before is entirely `add`; an empty after is entirely `remove`", () => {
  assert.deepEqual(
    wordDiff("", "New text").map((o) => o.kind),
    ["add"],
  );
  assert.deepEqual(
    wordDiff("Old text", "").map((o) => o.kind),
    ["remove"],
  );
});

test("change ratio is 0 for no change and 1 for a total rewrite", () => {
  assert.equal(diffChangeRatio("same text", "same text"), 0);
  assert.equal(diffChangeRatio("abc", "xyz"), 1);
});

test("change ratio is fractional for a partial change, not rounded to an extreme", () => {
  const ratio = diffChangeRatio(
    "The team have finished the quarterly report for the client.",
    "The team has finished the quarterly report for the client.",
  );
  assert.ok(ratio > 0 && ratio < 0.3, `expected a small ratio, got ${ratio}`);
});
