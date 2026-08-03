import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readMindMapRecord,
  readMindNode,
  readMindNodes,
} from "./mindmaps.ts";

/**
 * Reading `/cowork/mindmaps` responses.
 *
 * The engine answers in the domain's own shape, so none of this translates.
 * What it does is refuse to TRUST it: a response is JSON from over a network,
 * and typing it as a record because the route is supposed to send one is how a
 * missing field becomes `undefined.length` three components later.
 */

const record = (over: Record<string, unknown> = {}) => ({
  id: "mm1",
  organisationId: "org-legacy-cowork",
  title: "Launch plan",
  createdById: "E1",
  lastEditedById: null,
  members: [{ employeeId: "E1", role: "owner", addedAt: "2026-01-01T00:00:00Z" }],
  memberIds: ["E1"],
  nodeCount: 3,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  deletedAt: null,
  ...over,
});

/* ── Records ──────────────────────────────────────────────────────────────── */

test("a well-formed record reads back whole", () => {
  const r = readMindMapRecord(record());
  assert.equal(r?.id, "mm1");
  assert.equal(r?.title, "Launch plan");
  assert.equal(r?.nodeCount, 3);
  assert.deepEqual(r?.memberIds, ["E1"]);
});

test("a record with no members is dropped rather than listed", () => {
  /* It is unopenable by anybody including its author, so surfacing it would put
     a row on screen that cannot be clicked. */
  assert.equal(readMindMapRecord(record({ members: [] })), null);
  assert.equal(readMindMapRecord(record({ members: undefined })), null);
});

test("a record with no id is dropped — there is nothing to address", () => {
  assert.equal(readMindMapRecord(record({ id: "" })), null);
  assert.equal(readMindMapRecord(null), null);
  assert.equal(readMindMapRecord("mm1"), null);
});

test("an unrecognised role reads as editor, never as owner", () => {
  /* Guessing upward would hand somebody rename and delete on a map because a
     field arrived misspelt. */
  const r = readMindMapRecord(
    record({ members: [{ employeeId: "E1", role: "administrator" }] }),
  );
  assert.equal(r?.members[0].role, "editor");
});

test("memberIds is derived from members, not trusted from the wire", () => {
  /* Firestore cannot query inside an array of objects, so `memberIds` is the
     index — and an index that disagrees with the list it indexes is how
     somebody holds a role on a map they cannot find. */
  const r = readMindMapRecord(
    record({
      members: [
        { employeeId: "E1", role: "owner" },
        { employeeId: "E2", role: "editor" },
      ],
      memberIds: ["E9"],
    }),
  );
  assert.deepEqual(r?.memberIds, ["E1", "E2"]);
});

test("a missing updatedAt falls back to createdAt, never to now", () => {
  /* A record written before the field existed has not just been touched, and
     saying it was would sort it to the top of a list ordered by recency. */
  const r = readMindMapRecord(record({ updatedAt: undefined }));
  assert.equal(r?.updatedAt, "2026-01-01T00:00:00Z");
});

/* ── Cards ────────────────────────────────────────────────────────────────── */

test("a card with no id is dropped rather than given one", () => {
  /* A generated id would not match the one the server holds, and the next save
     would write a card the server has never seen beside the one it has. */
  assert.equal(readMindNode({ title: "Orphan" }), null);
});

test("an empty parentId reads as the root, not as a card called empty string", () => {
  assert.equal(readMindNode({ id: "a", parentId: "" })?.parentId, null);
  assert.equal(readMindNode({ id: "a" })?.parentId, null);
  assert.equal(readMindNode({ id: "a", parentId: "root" })?.parentId, "root");
});

test("a picture with neither a file nor bytes has nothing to draw", () => {
  const n = readMindNode({
    id: "a",
    images: [
      { id: "i1", name: "gone.png" },
      { id: "i2", name: "here.png", fileId: "drive-1" },
    ],
  });
  /* Kept out rather than rendered as a broken frame on somebody's card. */
  assert.equal(n?.images.length, 1);
  assert.equal(n?.images[0].fileId, "drive-1");
});

/* ── Trees ────────────────────────────────────────────────────────────────── */

test("a tree that cannot be laid out reads as null, never as a partial tree", () => {
  /* **Half a map drawn as if it were the whole map is the failure a person
     cannot see**: they would edit it, save it, and the save would be the
     truncation. */
  assert.equal(readMindNodes([{ id: "a", parentId: "ghost" }]), null);
  assert.equal(
    readMindNodes([
      { id: "a", parentId: null },
      { id: "b", parentId: null },
    ]),
    null,
  );
  assert.equal(
    readMindNodes([
      { id: "a", parentId: null },
      { id: "a", parentId: "a" },
    ]),
    null,
  );
  /* One unreadable card makes the whole tree unreadable, for the same reason. */
  assert.equal(readMindNodes([{ id: "a", parentId: null }, { title: "no id" }]), null);
  assert.equal(readMindNodes("not an array"), null);
});

test("a valid tree comes back in full", () => {
  const nodes = readMindNodes([
    { id: "root", parentId: null, title: "Root" },
    { id: "a", parentId: "root", title: "A" },
  ]);
  assert.equal(nodes?.length, 2);
  assert.equal(nodes?.[1].parentId, "root");
});

test("an empty body is an empty tree, not a failure", () => {
  /* A record with no body yet is real and openable — the workbench says the map
     has no root and offers a reload, which is a different thing from a map
     whose cards could not be read. */
  assert.deepEqual(readMindNodes([]), []);
});
