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
  addFloating,
  moveFloating,
  floatingRoots,
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

/* ── Keyboard-shaped mutations ───────────────────────────────────────────── */

import {
  addSibling,
  ancestorsOf,
  duplicateSubtree,
  findNodes,
  indentNode,
  moveSibling,
  navigateFrom,
  outdentNode,
  revealNodes,
  siblingsOf,
} from "./tree.ts";

const order = (m: MindMap, parent: string | null) =>
  childrenOf(m, parent).map((n) => n.id);

test("Enter adds a sibling directly after the card, not at the end", () => {
  const m = addSibling(fixture(), "a1", "x");
  assert.deepEqual(order(m, "a"), ["a1", "x", "a2"]);
  assert.equal(m.nodes.find((n) => n.id === "x")?.parentId, "a");
});

test("Enter on the root adds a child, because the root has no siblings", () => {
  const m = addSibling(fixture(), "root", "x");
  assert.equal(m.nodes.find((n) => n.id === "x")?.parentId, "root");
});

test("Alt+Down swaps a card with the sibling below and stops at the end", () => {
  let m = moveSibling(fixture(), "a1", 1);
  assert.deepEqual(order(m, "a"), ["a2", "a1"]);
  m = moveSibling(m, "a1", 1);
  assert.deepEqual(order(m, "a"), ["a2", "a1"], "the last sibling stays put");
  /* Siblings elsewhere in the array are untouched. */
  assert.deepEqual(order(m, "root"), ["a", "b"]);
});

test("Tab makes a card a child of the sibling above it and opens that sibling", () => {
  const collapsed = updateNode(fixture(), "a", { collapsed: true });
  const m = indentNode(collapsed, "b");
  assert.equal(m.nodes.find((n) => n.id === "b")?.parentId, "a");
  assert.deepEqual(order(m, "a"), ["a1", "a2", "b"]);
  assert.equal(m.nodes.find((n) => n.id === "a")?.collapsed, false);
});

test("Tab on the first sibling and on the root does nothing", () => {
  const f = fixture();
  assert.equal(indentNode(f, "a"), f);
  assert.equal(indentNode(f, "root"), f);
});

test("Shift+Tab lifts a card out to sit after its parent", () => {
  const m = outdentNode(fixture(), "a1");
  assert.equal(m.nodes.find((n) => n.id === "a1")?.parentId, "root");
  assert.deepEqual(order(m, "root"), ["a", "a1", "b"]);
});

test("Shift+Tab is refused where the parent has no siblings to join", () => {
  const f = fixture();
  assert.equal(outdentNode(f, "a"), f, "a direct child of the root");
  assert.equal(outdentNode(f, "root"), f);
});

test("arrows move to parent, first child and neighbouring siblings without wrapping", () => {
  const f = fixture();
  assert.equal(navigateFrom(f, "a1", "left"), "a");
  assert.equal(navigateFrom(f, "a", "right"), "a1");
  assert.equal(navigateFrom(f, "a1", "down"), "a2");
  assert.equal(navigateFrom(f, "a2", "down"), null);
  assert.equal(navigateFrom(f, "a1", "up"), null);
  assert.equal(navigateFrom(f, "root", "left"), null);
  assert.equal(navigateFrom(f, "b", "right"), null);
});

test("siblings are listed in draw order and include the card itself", () => {
  assert.deepEqual(
    siblingsOf(fixture(), "a2").map((n) => n.id),
    ["a1", "a2"],
  );
});

test("a search finds titles and descriptions, case-insensitively, in draw order", () => {
  const m = updateNode(fixture(), "b", { description: "mentions a1 too" });
  assert.deepEqual(findNodes(m, "A1"), ["a1", "b"]);
  assert.deepEqual(findNodes(m, "   "), []);
});

test("revealing a card opens every collapsed ancestor and only those", () => {
  let m = updateNode(fixture(), "a", { collapsed: true });
  m = updateNode(m, "root", { collapsed: true });
  assert.deepEqual(ancestorsOf(m, "a1"), ["a", "root"]);
  const shown = revealNodes(m, ["a1"]);
  assert.equal(shown.nodes.find((n) => n.id === "a")?.collapsed, false);
  assert.equal(shown.nodes.find((n) => n.id === "root")?.collapsed, false);
  /* Nothing to open returns the same object, so callers can skip a save. */
  assert.equal(revealNodes(shown, ["a1"]), shown);
});

test("duplicating a branch copies every card with fresh ids, after the original", () => {
  let n = 0;
  const { map: m, newId } = duplicateSubtree(fixture(), "a", () => `c${++n}`);
  assert.equal(newId, "c1");
  assert.deepEqual(order(m, "root"), ["a", "c1", "b"]);
  assert.deepEqual(order(m, "c1").length, 2);
  /* The copies hang off the COPIED parent, not the original. */
  for (const child of childrenOf(m, "c1")) assert.equal(child.parentId, "c1");
  assert.equal(m.nodes.length, 5 + 3);
  /* The root cannot be duplicated. */
  assert.equal(duplicateSubtree(fixture(), "root", () => "z").newId, null);
});

test("floating topics: parentless but not the root, movable, attachable, deletable", () => {
  let map = { id: "m", nodes: [newNode("root", null, "Root")] } as MindMap;
  map = addFloating(map, "f", "Idea", 300, 120);
  assert.equal(rootOf(map)?.id, "root", "the root is still the root");
  assert.deepEqual(floatingRoots(map).map((n) => n.id), ["f"]);
  map = moveFloating(map, "f", 350.4, 99.6);
  assert.deepEqual(map.nodes.find((n) => n.id === "f")?.floating, { x: 350, y: 100 });
  assert.equal(moveFloating(map, "root", 1, 1), map, "only a floating topic moves");
  const attached = reparent(map, "f", "root");
  const f = attached.nodes.find((n) => n.id === "f")!;
  assert.equal(f.parentId, "root");
  assert.equal(f.floating, undefined, "attached, it stops floating");
  const dup = duplicateSubtree(map, "f", () => "f2");
  assert.deepEqual(dup.map.nodes.find((n) => n.id === "f2")?.floating, { x: 390, y: 140 });
  const gone = deleteNode(map, "f");
  assert.deepEqual(gone.nodes.map((n) => n.id), ["root"]);
  assert.equal(deleteNode(map, "root"), map, "the root cannot be deleted");
});
