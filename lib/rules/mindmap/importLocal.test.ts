import assert from "node:assert/strict";
import { test } from "node:test";
import { importSummary, readLocalMindMap } from "./importLocal.ts";

/**
 * Lifting the browser-only map onto the server.
 *
 * The map is still sitting in `localStorage` and nothing reads that key any
 * more, so this is somebody's thinking that an improvement would otherwise have
 * thrown away. The tests that matter are the ones about what is NOT silently
 * lost on the way across.
 */

const stored = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "default",
    title: "Launch plan",
    nodes: [
      { id: "root", parentId: null, title: "Root", description: "", links: [], images: [], collapsed: false },
      { id: "a", parentId: "root", title: "A", description: "", links: [], images: [], collapsed: false },
    ],
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  });

test("a stored map is read back whole", () => {
  const local = readLocalMindMap(stored());
  assert.equal(local?.title, "Launch plan");
  assert.equal(local?.nodes.length, 2);
  assert.equal(local?.droppedImages, 0);
});

test("nothing stored means nothing to offer", () => {
  assert.equal(readLocalMindMap(null), null);
  assert.equal(readLocalMindMap(""), null);
});

test("an unreadable value is not an error, it is nothing to offer", () => {
  /* This is `localStorage`: the contents are editable by hand, and a corrupt
     value must not surface as an error on a screen nobody asked anything of. */
  assert.equal(readLocalMindMap("{not json"), null);
  assert.equal(readLocalMindMap("[]"), null);
  assert.equal(readLocalMindMap('{"nodes":[]}'), null);
});

test("a map that could not be stored is never offered", () => {
  /* Being told "import" and then refused is worse than not being offered: the
     offer is the only evidence the old map still exists. */
  const twoRoots = stored({
    nodes: [
      { id: "root", parentId: null, title: "Root" },
      { id: "other", parentId: null, title: "Other" },
    ],
  });
  assert.equal(readLocalMindMap(twoRoots), null);

  const dangling = stored({
    nodes: [
      { id: "root", parentId: null, title: "Root" },
      { id: "a", parentId: "ghost", title: "A" },
    ],
  });
  assert.equal(readLocalMindMap(dangling), null);
});

test("an uploaded picture comes across; browser bytes are counted, not hidden", () => {
  /* The engine refuses byte pictures outright and is right to — one fills a
     Firestore document. Refusing the whole import over one would strand the map
     for exactly the people who used it most, so the bytes are dropped and the
     COUNT is returned for the screen to say out loud. */
  const withImages = stored({
    nodes: [
      { id: "root", parentId: null, title: "Root" },
      {
        id: "a",
        parentId: "root",
        title: "Moodboard",
        images: [
          { id: "i1", name: "kept.png", fileId: "drive-1", sizeBytes: 900 },
          { id: "i2", name: "lost.png", dataUrl: "data:image/png;base64,AA", sizeBytes: 2 },
          { id: "i3", name: "also-lost.png", dataUrl: "data:image/png;base64,BB", sizeBytes: 2 },
        ],
      },
    ],
  });
  const local = readLocalMindMap(withImages);
  assert.equal(local?.droppedImages, 2);
  const card = local?.nodes.find((n) => n.id === "a");
  assert.equal(card?.images.length, 1);
  assert.equal(card?.images[0].fileId, "drive-1");
});

test("a map with no title still has one", () => {
  /* It becomes a row in a list, and a row with no name cannot be told from the
     next one. */
  assert.equal(readLocalMindMap(stored({ title: "   " }))?.title, "Imported mindmap");
  assert.equal(readLocalMindMap(stored({ title: undefined }))?.title, "Imported mindmap");
});

test("the summary asks for the pictures back rather than reporting a number", () => {
  assert.match(importSummary(0), /imported and is now stored with your account/);
  assert.doesNotMatch(importSummary(0), /picture/);

  const one = importSummary(1);
  assert.match(one, /One picture could not come across/);
  assert.match(one, /attach it again/);

  const many = importSummary(3);
  assert.match(many, /3 pictures could not come across/);
  assert.match(many, /attach them again/);
});
