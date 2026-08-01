import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addChild,
  childrenOf,
  connectorPath,
  deleteNode,
  layoutMap,
  newNode,
  nodeDetail,
  normaliseUrl,
  NODE_H,
  NODE_W,
  reparent,
  rootOf,
  subtreeIds,
  toggleCollapsed,
  updateNode,
  type MindMap,
} from "./tree.ts";

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

/* ── Layout ───────────────────────────────────────────────────────────────── */

test("depth decides the column", () => {
  const l = layoutMap(fixture());
  assert.equal(l.byId.get("root")!.x, 0);
  assert.equal(l.byId.get("a")!.x, l.byId.get("b")!.x);
  assert.ok(l.byId.get("a1")!.x > l.byId.get("a")!.x);
});

test("a parent is centred between its first and last child", () => {
  /* What stops a long branch dragging its parent to the top of its own
     subtree, which is what makes the connectors read as a ladder. */
  const l = layoutMap(fixture());
  const a = l.byId.get("a")!;
  const a1 = l.byId.get("a1")!;
  const a2 = l.byId.get("a2")!;
  assert.equal(a.y, (a1.y + a2.y) / 2);
});

test("siblings do not overlap", () => {
  const l = layoutMap(fixture());
  const ys = ["a1", "a2", "b"].map((id) => l.byId.get(id)!.y).sort((x, y) => x - y);
  for (let i = 1; i < ys.length; i++) {
    assert.ok(ys[i] - ys[i - 1] >= NODE_H, "two cards occupy the same row");
  }
});

test("collapsing reclaims the space rather than leaving a hole", () => {
  const open = layoutMap(fixture());
  const shut = layoutMap(toggleCollapsed(fixture(), "a"));
  assert.ok(shut.height < open.height);
  /* The collapsed node stays; only its children go. */
  assert.ok(shut.byId.has("a"));
  assert.ok(!shut.byId.has("a1"));
});

test("a leaf cannot be collapsed", () => {
  /* A chevron that hides nothing and reports "0 hidden". */
  const before = fixture();
  const after = toggleCollapsed(before, "b");
  assert.equal(after.nodes.find((n) => n.id === "b")!.collapsed, false);
});

test("an empty map lays out to nothing instead of throwing", () => {
  const l = layoutMap({ id: "m", title: "t", nodes: [], updatedAt: "" });
  assert.deepEqual(l.placed, []);
  assert.equal(l.width, 0);
});

test("a connector leaves the parent's right edge and meets the child's left", () => {
  const l = layoutMap(fixture());
  const parent = l.byId.get("a")!;
  const child = l.byId.get("a1")!;
  const d = connectorPath(parent, child);
  assert.ok(
    d.startsWith(`M ${parent.x + NODE_W} ${parent.y + NODE_H / 2} C `),
    d,
  );
  /* Ends on the child's LEFT edge, so the line meets the card rather than
     stopping in the gap or running under it. */
  assert.ok(d.endsWith(`${child.x} ${child.y + NODE_H / 2}`), d);
});

/* ── Structure ────────────────────────────────────────────────────────────── */

test("adding a child opens a collapsed parent", () => {
  /* Otherwise the node is created, the count changes, and nothing appears —
     which reads as a failure. */
  const collapsed = toggleCollapsed(fixture(), "a");
  const after = addChild(collapsed, "a", "a3");
  assert.equal(after.nodes.find((n) => n.id === "a")!.collapsed, false);
  assert.equal(childrenOf(after, "a").length, 3);
});

test("adding under a node that does not exist changes nothing", () => {
  const before = fixture();
  assert.equal(addChild(before, "ghost", "x").nodes.length, before.nodes.length);
});

test("deleting takes the whole subtree", () => {
  const after = deleteNode(fixture(), "a");
  assert.deepEqual(
    after.nodes.map((n) => n.id).sort(),
    ["b", "root"],
  );
});

test("the root cannot be deleted", () => {
  /* A map with no root cannot be laid out. */
  const after = deleteNode(fixture(), "root");
  assert.ok(rootOf(after));
  assert.equal(after.nodes.length, 5);
});

test("a node cannot be moved under its own descendant", () => {
  /* It would detach the subtree from the root: the nodes still exist and
     nothing renders them. */
  const after = reparent(fixture(), "a", "a1");
  assert.equal(after.nodes.find((n) => n.id === "a")!.parentId, "root");
  assert.ok(layoutMap(after).byId.has("a1"));
});

test("a node can be moved to a genuine new parent", () => {
  const after = reparent(fixture(), "a1", "b");
  assert.equal(after.nodes.find((n) => n.id === "a1")!.parentId, "b");
  assert.equal(childrenOf(after, "a").length, 1);
});

test("subtreeIds terminates on a cycle rather than hanging", () => {
  /* The map is read from localStorage, which anybody can edit by hand. A
     recursive walk would take the tab down instead of rendering oddly. */
  const cyclic: MindMap = {
    ...fixture(),
    nodes: [
      newNode("root", null),
      { ...newNode("x", "y"), id: "x", parentId: "y" },
      { ...newNode("y", "x"), id: "y", parentId: "x" },
    ],
  };
  assert.deepEqual([...subtreeIds(cyclic, "x")].sort(), ["x", "y"]);
});

test("updating one node leaves the others alone", () => {
  const after = updateNode(fixture(), "b", { description: "note" });
  assert.equal(after.nodes.find((n) => n.id === "b")!.description, "note");
  assert.equal(after.nodes.find((n) => n.id === "a")!.description, "");
});

/* ── Card content ─────────────────────────────────────────────────────────── */

test("a card with nothing but a title reads as empty", () => {
  const d = nodeDetail(newNode("x", "root", "Just a title"));
  assert.equal(d.isEmpty, true);
});

test("whitespace is not a description", () => {
  const d = nodeDetail({ ...newNode("x", "root"), description: "   \n " });
  assert.equal(d.hasDescription, false);
  assert.equal(d.isEmpty, true);
});

/* ── Links ────────────────────────────────────────────────────────────────── */

test("a bare domain gets a scheme", () => {
  /* Without one the browser reads it as a relative path and navigates inside
     the app. */
  assert.equal(normaliseUrl("grav.in"), "https://grav.in/");
});

test("an existing scheme is kept", () => {
  assert.equal(normaliseUrl("http://x.test/a"), "http://x.test/a");
});

test("a javascript URL is refused", () => {
  /* Pasted into a link, this is a script the app would run on click. */
  assert.equal(normaliseUrl("javascript:alert(1)"), null);
  assert.equal(normaliseUrl("data:text/html,<script>"), null);
});

test("empty and unparseable text is refused", () => {
  assert.equal(normaliseUrl("   "), null);
  assert.equal(normaliseUrl("http://"), null);
});
