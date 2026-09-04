import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addRelation,
  boundaryFor,
  pruneExtras,
  removeRelation,
  summaryFor,
  toggleBoundary,
  toggleSummary,
  updateBoundary,
  updateRelation,
  updateSummary,
} from "./extras.ts";
import { deleteNode, extrasOf, newNode, type MindMap } from "./tree.ts";

/** root → a(a1, a2), b. */
function fixture(): MindMap {
  return {
    id: "m",
    title: "t",
    nodes: [
      newNode("root", null, "Root"),
      newNode("a", "root", "A"),
      newNode("a1", "a", "A1"),
      newNode("a2", "a", "A2"),
      newNode("b", "root", "B"),
    ],
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

test("a relationship joins two cards once, and never a parent to its child", () => {
  let m = addRelation(fixture(), "a1", "b", "depends on", "r1");
  assert.deepEqual(extrasOf(m).relations, [{ id: "r1", from: "a1", to: "b", label: "depends on" }]);
  /* The same pair again is a no-op — the same object back. */
  assert.equal(addRelation(m, "a1", "b", "again", "r2"), m);
  /* Parent–child already has a line. */
  assert.equal(addRelation(m, "a", "a1", "", "r3"), m);
  assert.equal(addRelation(m, "a1", "a", "", "r3"), m);
  /* A card to itself, or to a card not in the map, is refused. */
  assert.equal(addRelation(m, "a1", "a1", "", "r4"), m);
  assert.equal(addRelation(m, "a1", "ghost", "", "r5"), m);
  m = updateRelation(m, "r1", { label: "blocks", line: "straight" });
  assert.equal(extrasOf(m).relations[0].label, "blocks");
  assert.equal(extrasOf(m).relations[0].line, "straight");
  assert.equal(extrasOf(removeRelation(m, "r1")).relations.length, 0);
  assert.equal(removeRelation(m, "nope"), m);
});

test("a boundary toggles on and off one card, and takes a label", () => {
  let m = toggleBoundary(fixture(), "a", "b1");
  assert.equal(boundaryFor(m, "a")?.id, "b1");
  m = updateBoundary(m, "b1", { label: "Phase 1", color: "#fee" });
  assert.equal(boundaryFor(m, "a")?.label, "Phase 1");
  m = toggleBoundary(m, "a");
  assert.equal(boundaryFor(m, "a"), null);
  assert.equal(toggleBoundary(m, "ghost"), m);
});

test("a summary needs children to summarise, and toggles like a boundary", () => {
  const f = fixture();
  assert.equal(toggleSummary(f, "b", "s0"), f, "b has no children");
  let m = toggleSummary(f, "a", "s1");
  assert.equal(summaryFor(m, "a")?.id, "s1");
  m = updateSummary(m, "s1", "Both halves of A");
  assert.equal(summaryFor(m, "a")?.text, "Both halves of A");
  m = toggleSummary(m, "a");
  assert.equal(summaryFor(m, "a"), null);
});

test("pruning drops whatever names a deleted card, and is identity-stable otherwise", () => {
  let m = addRelation(fixture(), "a1", "b", "x", "r1");
  m = toggleBoundary(m, "a", "b1");
  m = toggleSummary(m, "a", "s1");
  const before = extrasOf(m);
  assert.equal(pruneExtras(before, m.nodes), before, "nothing to drop → same object");

  const after = deleteNode(m, "a");
  const pruned = pruneExtras(before, after.nodes);
  assert.notEqual(pruned, before);
  assert.equal(pruned.relations.length, 0, "a1 went with a");
  assert.equal(pruned.boundaries.length, 0);
  assert.equal(pruned.summaries.length, 0);
  assert.equal(pruned.settings, before.settings, "settings untouched");
});
