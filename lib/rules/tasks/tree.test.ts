import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskTree, parentIdsIn } from "./tree.ts";

interface Row {
  id: string;
  parentId: string | null;
}
const read = (r: Row) => r;
const ids = (rows: { item: Row }[]) => rows.map((r) => r.item.id);

test("a flat list of roots is unchanged", () => {
  const rows = buildTaskTree(
    [
      { id: "a", parentId: null },
      { id: "b", parentId: null },
    ],
    read,
  );
  assert.deepEqual(ids(rows), ["a", "b"]);
  assert.deepEqual(
    rows.map((r) => r.depth),
    [0, 0],
  );
});

test("children follow their parent, whatever their position in the input", () => {
  /* The input order is the reported symptom: the subtask sorted between two
     unrelated tasks because its rank put it there. */
  const rows = buildTaskTree(
    [
      { id: "p1", parentId: null },
      { id: "p2", parentId: null },
      { id: "s1", parentId: "p1" },
    ],
    read,
  );
  assert.deepEqual(ids(rows), ["p1", "s1", "p2"]);
  assert.deepEqual(
    rows.map((r) => r.depth),
    [0, 1, 0],
  );
});

test("a parent reports its children and each child its position", () => {
  const rows = buildTaskTree(
    [
      { id: "p", parentId: null },
      { id: "s1", parentId: "p" },
      { id: "s2", parentId: "p" },
    ],
    read,
  );
  assert.equal(rows[0].hasChildren, true);
  assert.equal(rows[0].childCount, 2);
  assert.equal(rows[1].isLastChild, false);
  assert.equal(rows[2].isLastChild, true);
});

test("sibling order inside a parent is the caller's, not re-sorted", () => {
  const rows = buildTaskTree(
    [
      { id: "p", parentId: null },
      { id: "z", parentId: "p" },
      { id: "a", parentId: "p" },
    ],
    read,
  );
  /* Re-sorting here would override the sort control the person just used. */
  assert.deepEqual(ids(rows), ["p", "z", "a"]);
});

test("an orphan is rendered as a root rather than dropped", () => {
  /* The parent was filtered out by a status facet. Dropping the child is the
     original vanishing-subtask fault by another route. */
  const rows = buildTaskTree([{ id: "s", parentId: "missing" }], read);
  assert.deepEqual(ids(rows), ["s"]);
  assert.equal(rows[0].depth, 0);
});

test("a collapsed parent keeps its chevron and loses its children", () => {
  const rows = buildTaskTree(
    [
      { id: "p", parentId: null },
      { id: "s", parentId: "p" },
    ],
    read,
    new Set(["p"]),
  );
  assert.deepEqual(ids(rows), ["p"]);
  assert.equal(rows[0].hasChildren, true, "the chevron must survive collapsing");
  assert.equal(rows[0].childCount, 1);
});

test("collapsing an unrelated id changes nothing", () => {
  const rows = buildTaskTree(
    [
      { id: "p", parentId: null },
      { id: "s", parentId: "p" },
    ],
    read,
    new Set(["other"]),
  );
  assert.deepEqual(ids(rows), ["p", "s"]);
});

test("a subtask is never reported as having children of its own", () => {
  /* Depth of one is the rule `subtaskRefusal` enforces; a chevron on a child
     would offer a level nothing below here supports. */
  const rows = buildTaskTree(
    [
      { id: "p", parentId: null },
      { id: "s", parentId: "p" },
      { id: "g", parentId: "s" },
    ],
    read,
  );
  const child = rows.find((r) => r.item.id === "s")!;
  assert.equal(child.hasChildren, false);
});

test("parentIdsIn names only parents whose children are present", () => {
  const items: Row[] = [
    { id: "p", parentId: null },
    { id: "s", parentId: "p" },
    { id: "lonely", parentId: null },
    { id: "orphan", parentId: "gone" },
  ];
  assert.deepEqual(parentIdsIn(items, read), ["p"]);
});

test("an empty list produces no rows", () => {
  assert.deepEqual(buildTaskTree([], read), []);
});
