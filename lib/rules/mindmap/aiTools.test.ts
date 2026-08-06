import assert from "node:assert/strict";
import { test } from "node:test";
import { mindmapActionRequiresConfirmation, validateMindmapToolCall } from "./aiTools.ts";
import { newNode, type MindMap } from "./tree.ts";

/** root → a(a1, a2), b. Same shape `tree.test.ts` uses. */
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

/* ── add_child_nodes ──────────────────────────────────────────────────── */

test("a valid add_child_nodes validates", () => {
  const r = validateMindmapToolCall(
    "add_child_nodes",
    { parentId: "a", children: [{ title: "Idea 1" }, { title: "Idea 2", description: "More detail." }] },
    fixture(),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.action, {
      tool: "add_child_nodes",
      parentId: "a",
      children: [{ title: "Idea 1" }, { title: "Idea 2", description: "More detail." }],
    });
  }
});

test("a parentId that doesn't exist in the map is rejected", () => {
  const r = validateMindmapToolCall(
    "add_child_nodes",
    { parentId: "does-not-exist", children: [{ title: "Idea" }] },
    fixture(),
  );
  assert.equal(r.ok, false);
});

test("add_child_nodes with no children is rejected", () => {
  const r = validateMindmapToolCall("add_child_nodes", { parentId: "a", children: [] }, fixture());
  assert.equal(r.ok, false);
});

test("add_child_nodes rejects a blank-titled child", () => {
  const r = validateMindmapToolCall(
    "add_child_nodes",
    { parentId: "a", children: [{ title: "   " }] },
    fixture(),
  );
  assert.equal(r.ok, false);
});

test("add_child_nodes is capped so an oversized list is rejected outright", () => {
  const children = Array.from({ length: 51 }, (_, i) => ({ title: `Idea ${i}` }));
  const r = validateMindmapToolCall("add_child_nodes", { parentId: "a", children }, fixture());
  assert.equal(r.ok, false);
});

test("add_child_nodes never requires confirmation — it's purely additive", () => {
  const r = validateMindmapToolCall(
    "add_child_nodes",
    { parentId: "a", children: [{ title: "Idea" }] },
    fixture(),
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(mindmapActionRequiresConfirmation(r.action), false);
});

/* ── reorganize_nodes ─────────────────────────────────────────────────── */

test("a valid reorganize_nodes move validates", () => {
  const r = validateMindmapToolCall(
    "reorganize_nodes",
    { moves: [{ nodeId: "a1", newParentId: "b" }] },
    fixture(),
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.action, { tool: "reorganize_nodes", moves: [{ nodeId: "a1", newParentId: "b" }] });
});

test("a move that would create a cycle (parent under its own descendant) is rejected", () => {
  const r = validateMindmapToolCall(
    "reorganize_nodes",
    { moves: [{ nodeId: "a", newParentId: "a1" }] },
    fixture(),
  );
  assert.equal(r.ok, false);
});

test("moving a node under itself is rejected", () => {
  const r = validateMindmapToolCall(
    "reorganize_nodes",
    { moves: [{ nodeId: "a1", newParentId: "a1" }] },
    fixture(),
  );
  assert.equal(r.ok, false);
});

test("moving the root card is rejected", () => {
  const r = validateMindmapToolCall(
    "reorganize_nodes",
    { moves: [{ nodeId: "root", newParentId: "b" }] },
    fixture(),
  );
  assert.equal(r.ok, false);
});

test("a move naming a card that doesn't exist is rejected", () => {
  const r = validateMindmapToolCall(
    "reorganize_nodes",
    { moves: [{ nodeId: "ghost", newParentId: "b" }] },
    fixture(),
  );
  assert.equal(r.ok, false);
});

test("a move naming a destination that doesn't exist is rejected", () => {
  const r = validateMindmapToolCall(
    "reorganize_nodes",
    { moves: [{ nodeId: "a1", newParentId: "ghost" }] },
    fixture(),
  );
  assert.equal(r.ok, false);
});

test("an over-the-cap move list is rejected", () => {
  const moves = Array.from({ length: 21 }, () => ({ nodeId: "a1", newParentId: "b" }));
  const r = validateMindmapToolCall("reorganize_nodes", { moves }, fixture());
  assert.equal(r.ok, false);
});

test("reorganize_nodes always requires confirmation", () => {
  const r = validateMindmapToolCall(
    "reorganize_nodes",
    { moves: [{ nodeId: "a1", newParentId: "b" }] },
    fixture(),
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(mindmapActionRequiresConfirmation(r.action), true);
});

/* ── Unknown tool ─────────────────────────────────────────────────────── */

test("an unknown tool name is refused rather than guessed at", () => {
  const r = validateMindmapToolCall("delete_everything", {}, fixture());
  assert.equal(r.ok, false);
});
