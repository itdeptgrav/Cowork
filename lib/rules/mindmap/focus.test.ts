import assert from "node:assert/strict";
import { test } from "node:test";
import { focusMap, numberingOf, pathTo } from "./focus.ts";
import { childrenOf, newNode, rootOf, type MindMap } from "./tree.ts";

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
    updatedAt: "",
  };
}

test("focusing a card makes its branch the whole map, ids untouched", () => {
  const f = focusMap(fixture(), "a");
  assert.equal(rootOf(f)?.id, "a");
  assert.deepEqual(f.nodes.map((n) => n.id).sort(), ["a", "a1", "a2"]);
  assert.deepEqual(childrenOf(f, "a").map((n) => n.id), ["a1", "a2"]);
  /* The real map is not touched. */
  assert.equal(fixture().nodes.find((n) => n.id === "a")?.parentId, "root");
});

test("focusing the root, nothing, or a missing card is the map itself", () => {
  const f = fixture();
  assert.equal(focusMap(f, "root"), f);
  assert.equal(focusMap(f, null), f);
  assert.equal(focusMap(f, "ghost"), f);
});

test("the path to a card runs root first", () => {
  assert.deepEqual(pathTo(fixture(), "a2").map((n) => n.id), ["root", "a", "a2"]);
  assert.deepEqual(pathTo(fixture(), "root").map((n) => n.id), ["root"]);
});

test("numbering follows sibling position and is empty when off", () => {
  const n = numberingOf(fixture(), true);
  assert.equal(n.get("a"), "1");
  assert.equal(n.get("b"), "2");
  assert.equal(n.get("a1"), "1.1");
  assert.equal(n.get("a2"), "1.2");
  assert.equal(n.has("root"), false);
  assert.equal(numberingOf(fixture(), false).size, 0);
});
