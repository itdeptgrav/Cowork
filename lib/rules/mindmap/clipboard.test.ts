import assert from "node:assert/strict";
import { test } from "node:test";
import type { MindNode } from "../../domain/mindmap.ts";
import { branchesToText, copyBranches, parseClipboard, pasteBranches, serializeClipboard } from "./clipboard.ts";
import { dimmedIds, matchCount, tagsInUse } from "./filter.ts";
import { childrenOf, setAllCollapsed, type MindMap } from "./tree.ts";

const node = (id: string, parentId: string | null, title: string, extra: Partial<MindNode> = {}): MindNode => ({
  id,
  parentId,
  title,
  description: "",
  links: [],
  images: [],
  collapsed: false,
  ...extra,
});

const map: MindMap = {
  id: "m",
  title: "T",
  updatedAt: "2026-09-04T00:00:00.000Z",
  nodes: [
    node("root", null, "Root"),
    node("a", "root", "A", { tags: ["Urgent"], priority: 1 }),
    node("a1", "a", "A1", { progress: 50 }),
    node("a2", "a", "A2"),
    node("b", "root", "B", { taskId: "t1" }),
  ],
};

test("copying takes whole branches and skips cards already under a selected ancestor", () => {
  const clip = copyBranches(map, ["a", "a1", "b"]);
  assert.deepEqual(clip.roots, ["a", "b"]);
  assert.deepEqual(clip.nodes.map((n) => n.id), ["a", "a1", "a2", "b"]);
  assert.equal(branchesToText(clip), "A\n  A1\n  A2\nB");
});

test("pasting mints fresh ids, under a card or as floating topics", () => {
  const clip = copyBranches(map, ["a"]);
  let n = 0;
  const mint = () => `new${++n}`;
  const under = pasteBranches(map, clip, { parentId: "b" }, mint);
  assert.deepEqual(under.newIds, ["new1"]);
  assert.deepEqual(childrenOf(under.map, "b").map((x) => x.title), ["A"]);
  assert.deepEqual(childrenOf(under.map, "new1").map((x) => x.title), ["A1", "A2"]);
  assert.equal(under.map.nodes.length, 8, "three cards were added; the originals stayed");

  const floating = pasteBranches(map, clip, { floatingAt: { x: 100, y: 50 } }, mint);
  const top = floating.map.nodes.find((x) => x.id === floating.newIds[0])!;
  assert.equal(top.parentId, null);
  assert.deepEqual(top.floating, { x: 100, y: 50 });
  assert.equal(pasteBranches(map, clip, { parentId: "nope" }, mint).newIds.length, 0, "a missing target pastes nothing");
});

test("the clipboard survives the system clipboard as JSON", () => {
  const clip = copyBranches(map, ["b"]);
  const back = parseClipboard(serializeClipboard(clip));
  assert.deepEqual(back, clip);
  assert.equal(parseClipboard("just text"), null);
  assert.equal(parseClipboard('{"cowork":"other"}'), null);
});

test("a filter dims what does not match and keeps the path to what does", () => {
  assert.deepEqual([...dimmedIds(map, { tag: "urgent" })].sort(), ["a1", "a2", "b"]);
  assert.deepEqual([...dimmedIds(map, { progress: 50 })].sort(), ["a2", "b"], "A1 matches; A and Root lead to it");
  assert.deepEqual([...dimmedIds(map, { hasTask: true })].sort(), ["a", "a1", "a2"]);
  assert.deepEqual([...dimmedIds(map, { text: "a2" })].sort(), ["a1", "b"]);
  assert.equal(dimmedIds(map, {}).size, 0, "an empty filter dims nothing");
  assert.deepEqual(tagsInUse(map), ["Urgent"]);
  assert.equal(matchCount(map, { priority: 1 }), 1);
});

test("fold and unfold everything at once, leaving the root open", () => {
  const folded = setAllCollapsed(map, true);
  assert.deepEqual(folded.nodes.filter((n) => n.collapsed).map((n) => n.id), ["a"], "only cards with children fold, never the root");
  const open = setAllCollapsed(folded, false);
  assert.equal(open.nodes.some((n) => n.collapsed), false);
});
