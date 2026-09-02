import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * A shared screen takes the large slot — in BOTH rooms.
 *
 * `RoomStage` has promoted a share for Cowork people all along. The guest room
 * is a separate component with its own stage, and it drew a plain `GridLayout`:
 * every track the same size, so the shared document everyone joined to read got
 * the same few hundred pixels as a face.
 *
 * The guest was the reader least able to do anything about it. A guest has no
 * tile menu at all — nothing is pinnable, hideable or silenceable by them — so
 * the layout has to be right on its own rather than offering a fix. That is
 * also why the promotion here is automatic and carries no control.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const GUEST = "components/features/meetings/GuestMeetingArea.tsx";
const STAGE = "components/features/meetings/RoomStage.tsx";

/* ────────────────────────── the share gets the room ─────────────────────── */

test("the guest stage promotes a screen share out of the grid", () => {
  const src = code(GUEST);
  assert.match(
    src,
    /const share =\s*tracks\.find\(\(t\) => t\.source === Track\.Source\.ScreenShare\) \?\? null;/,
  );
  assert.match(src, /<FocusLayout trackRef=\{share\} \/>/);
});

test("a room with no share is still a plain grid", () => {
  /* The focus layout with one track is a large tile and an empty strip beside
     it — worse than the grid it replaced. It must appear only for a share. */
  const src = code(GUEST);
  assert.match(src, /\{share \? \(/);
  assert.match(src, /\) : \(\s*<GridLayout tracks=\{tracks\} className="h-full">/);
});

test("the carousel is written before the focus, in both stages", () => {
  /**
   * The container's contract, and the one ordering mistake that inverts the
   * whole feature: it expects the small side component first and the large main
   * one second. Reversed, the share lands in the thumbnail strip and a face
   * fills the screen.
   *
   * Asserted on BOTH files because it is the kind of thing a tidy-up reorders.
   */
  for (const path of [GUEST, STAGE]) {
    const src = code(path);
    const at = src.indexOf("<FocusLayoutContainer");
    assert.ok(at >= 0, `${path} has no focus container`);
    const block = src.slice(at, at + 700);
    assert.ok(
      block.indexOf("<CarouselLayout") < block.indexOf("<FocusLayout trackRef"),
      `${path} puts the focus before the carousel, which swaps them`,
    );
  }
});

test("the sharer keeps their own tile in the strip", () => {
  /* Only the SHARE was promoted. Dropping every track belonging to that person
     would take their face out of the room while they present. */
  const src = code(GUEST);
  assert.match(
    src,
    /t\.participant\.identity !== share\.participant\.identity \|\|\s*t\.source !== share\.source,/,
  );
});

/* ──────────────────────── and guests still cannot pin ───────────────────── */

test("the guest stage offers no tile controls", () => {
  /**
   * A guest is outside the organisation: pinning, hiding and silencing are
   * controls for the people whose meeting it is. The guest tile is a bare
   * `ParticipantTile` with no `TileContent`, which is what carries the menu.
   */
  const src = code(GUEST);
  assert.doesNotMatch(src, /TileMenu/);
  assert.doesNotMatch(src, /TileContent/);
  assert.doesNotMatch(src, /setPinnedKey|Pin to the screen/);
});

test("the Cowork stage keeps the controls a guest does not get", () => {
  /* The asymmetry is the point, so it is pinned from both sides: losing the
     menu in `RoomStage` would be a silent removal, not a tidy-up. */
  const src = code(STAGE);
  assert.match(src, /<TileContent \/>/);
  assert.match(src, /setPinnedKey/);
});

test("a reader who pinned a face is not overridden by a later share", () => {
  /* Existing behaviour in the Cowork stage, recorded here because the guest
     side deliberately has no such state and the two must not be confused. */
  const src = code(STAGE);
  assert.match(src, /autoPinnedRef/);
});
