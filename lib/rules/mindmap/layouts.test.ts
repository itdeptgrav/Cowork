import assert from "node:assert/strict";
import { test } from "node:test";
import { connectorPathFor, LAYOUT_KINDS, layoutMapAs } from "./layouts.ts";
import { addFloating, childrenOf, layoutMap, newNode, NODE_H, NODE_W, updateNode, type MindMap } from "./tree.ts";

/** root → a(a1, a2), b(b1), c. Enough asymmetry to exercise every layout. */
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
      newNode("b1", "b", "B1"),
      newNode("c", "root", "C"),
    ],
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

const at = (l: ReturnType<typeof layoutMapAs>, id: string) => l.byId.get(id)!;

test("every layout kind places every visible card exactly once, inside the stage", () => {
  for (const { id: kind } of LAYOUT_KINDS) {
    const l = layoutMapAs(fixture(), kind);
    assert.equal(l.placed.length, 7, `${kind} placed count`);
    assert.equal(new Set(l.placed.map((p) => p.node.id)).size, 7, `${kind} unique`);
    for (const p of l.placed) {
      assert.ok(p.x >= 0 && p.y >= 0, `${kind}: ${p.node.id} at ${p.x},${p.y} is negative`);
      assert.ok(p.x + NODE_W <= l.width + 0.001 && p.y + NODE_H <= l.height + 0.001, `${kind}: ${p.node.id} outside stage`);
    }
    assert.equal(l.kind, kind);
  }
});

test("collapsing hides a branch in every layout", () => {
  const m = updateNode(fixture(), "a", { collapsed: true });
  for (const { id: kind } of LAYOUT_KINDS) {
    const l = layoutMapAs(m, kind);
    assert.equal(l.byId.has("a1"), false, kind);
    assert.equal(l.byId.has("a"), true, kind);
    assert.equal(l.placed.length, 5, kind);
  }
});

test("right is pixel-identical to the original layout", () => {
  const original = layoutMap(fixture());
  const mine = layoutMapAs(fixture(), "right");
  for (const p of original.placed) {
    const q = at(mine, p.node.id);
    assert.equal(q.x, p.x, `${p.node.id}.x`);
    assert.equal(q.y, p.y, `${p.node.id}.y`);
    assert.equal(q.side, "right");
  }
  assert.equal(mine.width, original.width);
  assert.equal(mine.height, original.height);
});

test("left is the mirror of right: same rows, columns reversed", () => {
  const r = layoutMapAs(fixture(), "right");
  const l = layoutMapAs(fixture(), "left");
  assert.equal(l.width, r.width);
  for (const p of r.placed) {
    const q = at(l, p.node.id);
    assert.equal(q.y, p.y, `${p.node.id} keeps its row`);
    assert.equal(q.x, r.width - p.x - NODE_W, `${p.node.id} mirrors its column`);
    assert.equal(q.side, "left");
  }
});

test("both deals the root's children to alternate sides, balanced by size", () => {
  const l = layoutMapAs(fixture(), "both");
  const root = at(l, "root");
  const sides = childrenOf(fixture(), "root").map((c) => at(l, c.id).side);
  assert.ok(sides.includes("left") && sides.includes("right"), "children on both sides");
  /* A (3 cards) goes right first; B (2) then goes left; C (1) goes to the
     smaller side, which is left (2 < 3). */
  assert.equal(at(l, "a").side, "right");
  assert.equal(at(l, "b").side, "left");
  assert.equal(at(l, "c").side, "left");
  /* A branch's descendants follow their branch's side. */
  assert.equal(at(l, "a1").side, "right");
  assert.equal(at(l, "b1").side, "left");
  /* The root sits between the two halves. */
  assert.ok(at(l, "a").x > root.x && at(l, "b").x < root.x);
});

test("org puts depth in rows and centres a parent over its children", () => {
  const l = layoutMapAs(fixture(), "org");
  assert.equal(at(l, "root").y, 0);
  assert.ok(at(l, "a").y > at(l, "root").y && at(l, "a1").y > at(l, "a").y);
  assert.equal(at(l, "a").y, at(l, "b").y, "siblings share a row");
  const a = at(l, "a");
  const a1 = at(l, "a1");
  const a2 = at(l, "a2");
  assert.equal(a.x, (a1.x + a2.x) / 2);
  assert.equal(a.side, "down");
});

test("tree reads top to bottom with each level indented", () => {
  const l = layoutMapAs(fixture(), "tree");
  const order = [...l.placed].sort((p, q) => p.y - q.y).map((p) => p.node.id);
  assert.deepEqual(order, ["root", "a", "a1", "a2", "b", "b1", "c"]);
  assert.ok(at(l, "a1").x > at(l, "a").x && at(l, "a").x > at(l, "root").x);
});

test("radial puts the root at the centre and every depth on a wider ring", () => {
  const l = layoutMapAs(fixture(), "radial");
  const root = at(l, "root");
  const cx = root.x + NODE_W / 2;
  const cy = root.y + NODE_H / 2;
  const dist = (id: string) => {
    const p = at(l, id);
    return Math.hypot(p.x + NODE_W / 2 - cx, p.y + NODE_H / 2 - cy);
  };
  assert.ok(dist("a") > 0 && Math.abs(dist("a") - dist("b")) < 1, "depth 1 shares a ring");
  assert.ok(dist("a1") > dist("a"), "depth 2 is further out");
  /* Cards on the left half continue leftward. */
  const leftish = l.placed.filter((p) => p.node.id !== "root" && p.x + NODE_W / 2 < cx);
  for (const p of leftish) assert.equal(p.side, "left", p.node.id);
});

test("timeline runs the root's children along one line with branches below", () => {
  const l = layoutMapAs(fixture(), "timeline");
  assert.equal(at(l, "a").y, at(l, "b").y);
  assert.equal(at(l, "b").y, at(l, "c").y);
  assert.ok(at(l, "a").x < at(l, "b").x && at(l, "b").x < at(l, "c").x, "milestones in order");
  assert.ok(at(l, "a1").y > at(l, "a").y, "branches hang below");
  assert.ok(at(l, "a1").x >= at(l, "a").x && at(l, "a1").x < at(l, "b").x, "a branch stays under its milestone");
});

test("connectors leave the right edge for a right-side child and the bottom for a downward one", () => {
  const r = layoutMapAs(fixture(), "right");
  const rp = connectorPathFor("right", at(r, "root"), at(r, "a"));
  assert.ok(rp.startsWith(`M ${at(r, "root").x + NODE_W} `));
  const o = layoutMapAs(fixture(), "org");
  const op = connectorPathFor("org", at(o, "root"), at(o, "a"));
  assert.ok(op.startsWith(`M ${at(o, "root").x + NODE_W / 2} ${at(o, "root").y + NODE_H}`));
  const lft = layoutMapAs(fixture(), "left");
  const lp = connectorPathFor("left", at(lft, "root"), at(lft, "a"));
  assert.ok(lp.startsWith(`M ${at(lft, "root").x} `), "a left child leaves the parent's left edge");
});

test("an empty map lays out to nothing in every kind", () => {
  const empty: MindMap = { id: "m", title: "t", nodes: [], updatedAt: "" };
  for (const { id: kind } of LAYOUT_KINDS) {
    const l = layoutMapAs(empty, kind);
    assert.equal(l.placed.length, 0);
    assert.equal(l.width, 0);
  }
});

test("a floating topic is laid out as its own small tree where it was dropped", () => {
  let map = { id: "m", nodes: [newNode("root", null, "Root"), newNode("a", "root", "A")] } as MindMap;
  map = addFloating(map, "f", "Idea", 500, 40);
  map = { ...map, nodes: [...map.nodes, newNode("f1", "f", "Sub")] };
  for (const { id: kind } of LAYOUT_KINDS) {
    const l = layoutMapAs(map, kind);
    const f = l.byId.get("f")!;
    const f1 = l.byId.get("f1")!;
    assert.ok(f, `${kind}: the floating topic is placed`);
    assert.ok(f1, `${kind}: its child is placed`);
    assert.ok(l.byId.get("root"), `${kind}: the root is still placed`);
    assert.ok(l.width >= f.x + NODE_W && l.height >= f.y + NODE_H, `${kind}: the stage holds it`);
    assert.ok(f1.x !== f.x || f1.y !== f.y, `${kind}: the child sits beside it`);
  }
  const right = layoutMapAs(map, "right");
  assert.equal(right.byId.get("f")!.x, 500);
  assert.equal(right.byId.get("f")!.y, 40);
});

test("fishbone puts the effect at the head and the causes on alternating bones", () => {
  const nodes = [
    newNode("root", null, "Effect"),
    newNode("a", "root", "People"),
    newNode("a1", "a", "Training"),
    newNode("b", "root", "Process"),
    newNode("c", "root", "Tools"),
  ];
  const map: MindMap = { id: "m", title: "T", updatedAt: "2026-09-04T00:00:00.000Z", nodes };
  const layout = layoutMapAs(map, "fishbone");
  const at = (id: string) => layout.byId.get(id)!;
  const spine = at("root").y + NODE_H / 2;
  assert.ok(at("root").x > at("a").x && at("root").x > at("c").x, "the head sits to the right of every bone");
  assert.ok(at("a").y + NODE_H / 2 < spine, "the first bone rises above the spine");
  assert.ok(at("b").y + NODE_H / 2 > spine, "the second hangs below");
  assert.ok(at("c").y + NODE_H / 2 < spine, "the third rises again");
  assert.ok(at("a1").y < at("a").y && at("a1").x > at("a").x, "a cause sits further out along its bone");
  assert.ok(at("c").x > at("b").x, "bones progress along the spine");
  assert.equal(at("a").side, "up");
  assert.equal(at("b").side, "down");
  assert.ok(connectorPathFor("fishbone", at("root"), at("a")).startsWith("M "), "the head joins a bone with a straight path");
  assert.ok(connectorPathFor("fishbone", at("a"), at("a1")).includes(" L "), "causes join their bone with a straight line");
  assert.ok(LAYOUT_KINDS.some((k) => k.id === "fishbone"));
});
