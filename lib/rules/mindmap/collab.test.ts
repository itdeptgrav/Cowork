import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { crdtOf, isEmpty, readNodes, writeNodes } from "./collab.ts";
import { addChild, deleteNode, newNode, updateNode } from "./tree.ts";
import type { MindMap } from "./tree.ts";
import type { MindNode } from "../../domain/mindmap.ts";

const node = (id: string, parentId: string | null, title = id): MindNode =>
  newNode(id, parentId, title);

const mapOf = (nodes: MindNode[]): MindMap => ({
  id: "m1",
  title: "Map",
  nodes,
  updatedAt: "2026-08-04",
});

/**
 * Two clients on one document, wired the way `y-socket.io` wires them.
 *
 * Updates are relayed both ways, so anything asserted here is a fact about how
 * the two REALLY converge rather than about a mock that agrees with me.
 */
function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "remote") Y.applyUpdate(b, u, "remote");
  });
  b.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "remote") Y.applyUpdate(a, u, "remote");
  });
  return { a: crdtOf(a), b: crdtOf(b) };
}

test("an empty document reports itself empty, so seeding runs once", () => {
  const doc = new Y.Doc();
  const crdt = crdtOf(doc);
  assert.equal(isEmpty(crdt), true);
  writeNodes(crdt, [node("root", null)]);
  assert.equal(isEmpty(crdt), false);
});

test("a tree round-trips through the CRDT unchanged", () => {
  const crdt = crdtOf(new Y.Doc());
  const nodes = [node("root", null), node("a", "root"), node("b", "root")];
  writeNodes(crdt, nodes);
  assert.deepEqual(readNodes(crdt), nodes);
});

test("sibling order survives, because the canvas draws in array order", () => {
  /* `childrenOf` filters the array by parentId, so this order IS what people
     see. A Y.Map alone has no order and two clients could iterate it
     differently — which is why there is a separate order array at all. */
  const crdt = crdtOf(new Y.Doc());
  writeNodes(crdt, [
    node("root", null),
    node("c", "root"),
    node("a", "root"),
    node("b", "root"),
  ]);
  assert.deepEqual(
    readNodes(crdt).map((n) => n.id),
    ["root", "c", "a", "b"],
  );
});

test("one person's new card reaches the other", () => {
  const { a, b } = pair();
  writeNodes(a, [node("root", null)]);
  const next = addChild(mapOf(readNodes(a)), "root", "kid");
  writeNodes(a, next.nodes);

  assert.deepEqual(
    readNodes(b).map((n) => n.id),
    ["root", "kid"],
  );
});

test("edits to DIFFERENT cards both survive — the case that must not conflict", () => {
  const { a, b } = pair();
  writeNodes(a, [node("root", null), node("x", "root"), node("y", "root")]);

  writeNodes(a, updateNode(mapOf(readNodes(a)), "x", { title: "from A" }).nodes);
  writeNodes(b, updateNode(mapOf(readNodes(b)), "y", { title: "from B" }).nodes);

  for (const side of [a, b]) {
    const byId = new Map(readNodes(side).map((n) => [n.id, n]));
    assert.equal(byId.get("x")?.title, "from A");
    assert.equal(byId.get("y")?.title, "from B");
  }
});

test("both clients converge on the same tree", () => {
  const { a, b } = pair();
  writeNodes(a, [node("root", null)]);
  writeNodes(a, addChild(mapOf(readNodes(a)), "root", "one").nodes);
  writeNodes(b, addChild(mapOf(readNodes(b)), "root", "two").nodes);

  assert.deepEqual(readNodes(a), readNodes(b));
});

test("a deleted card is gone on the other side", () => {
  const { a, b } = pair();
  writeNodes(a, [node("root", null), node("gone", "root")]);
  writeNodes(a, deleteNode(mapOf(readNodes(a)), "gone").nodes);

  assert.deepEqual(
    readNodes(b).map((n) => n.id),
    ["root"],
  );
});

test("deleting a branch takes its children with it", () => {
  const { a, b } = pair();
  writeNodes(a, [
    node("root", null),
    node("branch", "root"),
    node("leaf", "branch"),
  ]);
  writeNodes(a, deleteNode(mapOf(readNodes(a)), "branch").nodes);

  assert.deepEqual(
    readNodes(b).map((n) => n.id),
    ["root"],
  );
});

test("typing in a card does not rewrite the order array", () => {
  /* The order array is the one structure two clients contend over. If a
     keystroke touched it, every edit would collide with everybody's structural
     changes for no reason. */
  const crdt = crdtOf(new Y.Doc());
  writeNodes(crdt, [node("root", null), node("a", "root")]);

  let orderWrites = 0;
  crdt.order.observe(() => orderWrites++);
  writeNodes(crdt, updateNode(mapOf(readNodes(crdt)), "a", { title: "typed" }).nodes);

  assert.equal(orderWrites, 0);
  assert.equal(readNodes(crdt)[1].title, "typed");
});

test("an unchanged tree writes nothing at all", () => {
  const crdt = crdtOf(new Y.Doc());
  const nodes = [node("root", null), node("a", "root")];
  writeNodes(crdt, nodes);

  let writes = 0;
  crdt.nodes.observe(() => writes++);
  crdt.order.observe(() => writes++);
  writeNodes(crdt, readNodes(crdt));

  assert.equal(writes, 0);
});

test("an id in the order with no card is skipped, not drawn as undefined", () => {
  const crdt = crdtOf(new Y.Doc());
  writeNodes(crdt, [node("root", null)]);
  /* What a delete racing a concurrent write leaves behind. */
  crdt.order.push(["ghost"]);

  const read = readNodes(crdt);
  assert.deepEqual(
    read.map((n) => n.id),
    ["root"],
  );
  assert.ok(read.every(Boolean));
});

test("a card missing from the order is kept, not lost", () => {
  /* An unexpected position is recoverable; a vanished card is not. */
  const crdt = crdtOf(new Y.Doc());
  writeNodes(crdt, [node("root", null)]);
  crdt.nodes.set("orphan", node("orphan", "root"));

  assert.deepEqual(
    readNodes(crdt)
      .map((n) => n.id)
      .sort(),
    ["orphan", "root"],
  );
});

test("a card never appears twice, whatever the order array says", () => {
  /* The failure mode a Y.Array<MindNode> would have had: the same id twice
     produces a tree that cannot be laid out. */
  const crdt = crdtOf(new Y.Doc());
  writeNodes(crdt, [node("root", null), node("a", "root")]);
  crdt.order.push(["a"]);

  const ids = readNodes(crdt).map((n) => n.id);
  assert.deepEqual(ids, [...new Set(ids)]);
});
