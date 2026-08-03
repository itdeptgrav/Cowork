import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { MAX_MINDMAP_NODES, mindmapTreeRefusal } from "./validity.ts";
import type { MindNode } from "../../domain/mindmap.ts";

/**
 * What a mindmap may not be.
 *
 * Every refusal here is a tree that would be STORED happily and then fail to
 * draw — for everybody on the map, not only the person who sent it. That is
 * why these are refusals rather than repairs: a map quietly "fixed" into a
 * shape its author did not draw is a worse answer than one that says which
 * card is wrong.
 */

const node = (over: Partial<MindNode> & { id: string }): MindNode => ({
  parentId: "root",
  title: over.id,
  description: "",
  links: [],
  images: [],
  collapsed: false,
  ...over,
});

const root = (): MindNode => node({ id: "root", parentId: null, title: "Root" });

const tree = (...rest: MindNode[]): MindNode[] => [root(), ...rest];

/* ── The shapes that cannot be drawn ──────────────────────────────────────── */

test("a tree with one root and valid parents is accepted", () => {
  assert.equal(mindmapTreeRefusal(tree(node({ id: "a" }), node({ id: "b" }))), null);
  /* Depth is fine; it is SHAPE that is checked, not size. */
  assert.equal(
    mindmapTreeRefusal(
      tree(node({ id: "a" }), node({ id: "b", parentId: "a" })),
    ),
    null,
  );
});

test("a map with no root cannot be drawn from anywhere", () => {
  /* Every layout starts at the root and walks down. With none, there is no
     first column, so nothing renders at all — an empty canvas over a map that
     has cards in it. */
  const orphans = [node({ id: "a", parentId: "b" }), node({ id: "b", parentId: "a" })];
  assert.match(mindmapTreeRefusal(orphans) ?? "", /no root card/);
});

test("two roots are refused rather than one being picked", () => {
  /* `rootOf` returns the FIRST match, so a second root and everything under it
     would silently vanish from the canvas while still being saved. Somebody
     would then delete a branch they could not see. */
  const two = tree(node({ id: "other", parentId: null }));
  assert.match(mindmapTreeRefusal(two) ?? "", /2 root cards/);
});

test("a parent that is not in the map is named, not dropped", () => {
  const dangling = tree(node({ id: "a", parentId: "ghost", title: "Q3 launch" }));
  const refusal = mindmapTreeRefusal(dangling) ?? "";
  assert.match(refusal, /hangs off a card that is not in this map/);
  /* The CARD is named, because that is the only part somebody can act on. */
  assert.match(refusal, /Q3 launch/);
});

test("a cycle is caught, including one detached from the root", () => {
  /* Walked upward per card rather than downward from the root once: a ring
     that never touches the root is never visited by a downward walk, so it
     would pass a check written the obvious way and then hang the layout. */
  const ring = [
    root(),
    node({ id: "a", parentId: "c" }),
    node({ id: "b", parentId: "a" }),
    node({ id: "c", parentId: "b" }),
  ];
  assert.match(mindmapTreeRefusal(ring) ?? "", /part of a loop/);
});

test("duplicate ids are refused before anything walks the tree", () => {
  /* Checked early on purpose. Two cards with one id make `byId` lose one of
     them, and a cycle walk over that map would not terminate. */
  const dupes = tree(node({ id: "a" }), node({ id: "a" }));
  assert.match(mindmapTreeRefusal(dupes) ?? "", /share the id/);
});

test("an empty map is refused, because a mindmap is drawn from its root", () => {
  assert.match(mindmapTreeRefusal([]) ?? "", /at least a root card/);
  assert.match(mindmapTreeRefusal(undefined) ?? "", /must be an array/);
});

test("the card ceiling is a number, not an opinion", () => {
  const many = [
    root(),
    ...Array.from({ length: MAX_MINDMAP_NODES }, (_, i) =>
      node({ id: `n${i}` }),
    ),
  ];
  assert.match(mindmapTreeRefusal(many) ?? "", /can hold 2000 cards/);
});

/* ── Pictures ─────────────────────────────────────────────────────────────── */

test("a picture stored as browser bytes is refused, and the refusal says what to do", () => {
  /* One base64 picture fills a Firestore document on its own, so a map carrying
     three would be unsaveable. Refused rather than silently stripped: a person
     who keeps working on a map they believe is saved is the worse outcome. */
  const withBytes = tree(
    node({
      id: "a",
      title: "Moodboard",
      images: [
        {
          id: "i1",
          name: "sketch.png",
          dataUrl: "data:image/png;base64,AAAA",
          sizeBytes: 4,
        },
      ],
    }),
  );
  const refusal = mindmapTreeRefusal(withBytes) ?? "";
  assert.match(refusal, /sketch\.png/);
  assert.match(refusal, /attach it again/);
});

test("an uploaded picture is fine — it is the bytes that are refused, not images", () => {
  const uploaded = tree(
    node({
      id: "a",
      images: [
        { id: "i1", name: "sketch.png", fileId: "drive-123", sizeBytes: 40_000 },
      ],
    }),
  );
  assert.equal(mindmapTreeRefusal(uploaded), null);
});

/* ── The two copies must refuse the same things ───────────────────────────── */

test("the engine refuses every case this file refuses", () => {
  /* The authority is `coworkMindmaps.js`; this file exists so the mock and the
     canvas refuse identically. Nothing mechanical can diff wording across two
     repositories, so this asserts the one thing that IS checkable from here:
     that the client has not grown a refusal the server does not have, which is
     the direction that produces a screen refusing what the backend accepts.
     The reverse — a server rule this file lacks — surfaces as a 400 the UI
     already shows. */
  const src = readFileSync("lib/rules/mindmap/validity.ts", "utf8");
  for (const phrase of [
    "no root card",
    "root cards",
    "hangs off a card that is not in this map",
    "part of a loop",
    "share the id",
    "at least a root card",
    "stored in this browser rather than uploaded",
  ]) {
    assert.ok(
      src.includes(phrase),
      `"${phrase}" is asserted by these tests but is no longer in validity.ts`,
    );
  }
});
