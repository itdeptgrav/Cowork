import assert from "node:assert/strict";
import { test } from "node:test";
import { dragCarriesFiles, dragDepth, isDropActive } from "./fileDrop.ts";

test("a drag carrying files is recognised", () => {
  assert.equal(dragCarriesFiles(["Files"]), true);
  assert.equal(dragCarriesFiles(["text/plain", "Files"]), true);
});

test("dragged text and links are left alone", () => {
  /* Dropping a selected sentence or a link onto the thread must keep doing
     whatever it did before — the overlay is for files. */
  assert.equal(dragCarriesFiles(["text/plain"]), false);
  assert.equal(dragCarriesFiles(["text/uri-list", "text/plain"]), false);
  assert.equal(dragCarriesFiles([]), false);
  assert.equal(dragCarriesFiles(undefined), false);
  assert.equal(dragCarriesFiles(null), false);
});

test("a DOMStringList is accepted, not only a real array", () => {
  /* `dataTransfer.types` is a DOMStringList in some browsers — array-like but
     without `.includes`, which is why this copies before testing. */
  const domStringList = {
    length: 1,
    0: "Files",
    [Symbol.iterator]: function* () {
      yield "Files";
    },
  } as unknown as readonly string[];
  assert.equal(dragCarriesFiles(domStringList), true);
});

test("crossing a child does not turn the drop zone off", () => {
  /* The bug this counter exists for: `dragenter` on a message bubble arrives
     BEFORE `dragleave` on the thread around it. A boolean would flicker off
     mid-drag and usually be off at the moment of release. */
  let d = 0;
  d = dragDepth(d, "enter"); // onto the thread
  assert.equal(isDropActive(d), true);
  d = dragDepth(d, "enter"); // onto a bubble inside it
  d = dragDepth(d, "leave"); // the thread's own leave
  assert.equal(isDropActive(d), true, "still inside the drop zone");
  d = dragDepth(d, "leave"); // off the bubble, out of everything
  assert.equal(isDropActive(d), false);
});

test("leaving the zone entirely turns it off", () => {
  const d = dragDepth(dragDepth(0, "enter"), "leave");
  assert.equal(d, 0);
  assert.equal(isDropActive(d), false);
});

test("a drop ends the drag whatever the count reached", () => {
  /* No final `dragleave` is delivered to the element that received the drop,
     so an unbalanced count would leave the overlay stuck on screen. */
  let d = 0;
  d = dragDepth(d, "enter");
  d = dragDepth(d, "enter");
  d = dragDepth(d, "enter");
  assert.equal(dragDepth(d, "drop"), 0);
});

test("the depth never goes negative", () => {
  /* A drag beginning outside the window can deliver a `dragleave` with no
     matching `dragenter`. Left negative, the zone would need two real entries
     before it lit up again. */
  assert.equal(dragDepth(0, "leave"), 0);
  assert.equal(dragDepth(dragDepth(0, "leave"), "leave"), 0);
  assert.equal(isDropActive(dragDepth(dragDepth(0, "leave"), "enter")), true);
});
