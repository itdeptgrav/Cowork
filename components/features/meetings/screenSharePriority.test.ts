import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * A shared screen takes the large slot, and the per-tile menu is offered — in
 * BOTH rooms.
 *
 * The guest room used to draw its OWN bare grid: no promoted share worth reading
 * and no tile menu at all, while every employee in the same call could pin, hide
 * and silence. That read as a lesser product for exactly the people a guest link
 * exists to impress. The guest stage now renders the SAME `RoomStage` the
 * signed-in room does, with `directory={false}` as the only difference — the
 * directory-backed `TileContent` is withheld (a guest cannot fetch the employee
 * directory), and everything else, the menu included, is identical.
 *
 * Rewritten 2026-09-04 when guests gained the tile menu; this file used to pin
 * the opposite ("the guest stage offers no tile controls").
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const GUEST = "components/features/meetings/GuestRoom.tsx";
const STAGE = "components/features/meetings/RoomStage.tsx";

test("the guest stage renders the shared RoomStage, not a bare grid", () => {
  const src = code(GUEST);
  assert.match(src, /function GuestStage\(\)/);
  assert.match(src, /<RoomStage directory=\{false\} \/>/);
});

test("RoomStage promotes a screen share into the focus slot", () => {
  const src = code(STAGE);
  assert.match(src, /Track\.Source\.ScreenShare/);
  /* The large tile is our own ParticipantTile (keeping the on-tile menu), not
     LiveKit's bare FocusLayout. */
  assert.match(src, /<ParticipantTile trackRef=\{pinned\}>/);
});

test("the carousel is written before the focus (small side first)", () => {
  /* The container's contract, and the one ordering mistake that inverts the
     whole feature: it expects the small side component first and the large main
     one second. Reversed, the share lands in the thumbnail strip. */
  const src = code(STAGE);
  const at = src.indexOf("<FocusLayoutContainer");
  assert.ok(at >= 0, "RoomStage has no focus container");
  const block = src.slice(at, at + 700);
  assert.ok(
    block.indexOf("<CarouselLayout") < block.indexOf("<ParticipantTile trackRef="),
    "the focus is written before the carousel, which swaps them",
  );
});

const TILE = "components/features/meetings/TileContent.tsx";

test("the per-tile menu is ON the tile, driven by the stage's context", () => {
  /* The menu moved from a strip above the grid to a control on each tile — a
     hover button and a right-click. The stage still OWNS the pin/hide state and
     hands it down through TileActionsProvider; the tile reads it. */
  const stage = code(STAGE);
  assert.match(stage, /<TileActionsProvider value=\{tileActions\}>/);
  assert.match(stage, /setPinnedKey/);
  const tile = code(TILE);
  assert.match(tile, /useTileActions\(\)/);
  assert.match(tile, /<TileMenuList/);
  assert.match(tile, /onContextMenu=/); // right-click opens it
  assert.match(tile, /group-hover\/tile:opacity-100/); // hover reveals the button
});

test("BOTH rooms draw the same TileContent; `directory` is the only difference", () => {
  const stage = code(STAGE);
  /* One template for both, the directory flag threaded through — no bare
     guest grid any more. */
  assert.match(stage, /<TileContent directory=\{directory\} \/>/);
  /* `directory` gates ONLY the employee-directory read; a guest resolves empty
     and falls back to LiveKit's own name and initials. */
  assert.match(code(TILE), /directory \? r\.listEmployees\(\) : Promise\.resolve/);
  /* And the guest asks for exactly that: directory={false}. */
  assert.match(code(GUEST), /<RoomStage directory=\{false\} \/>/);
});

test("a reader who pinned a face is not overridden by a later share", () => {
  const src = code(STAGE);
  assert.match(src, /autoPinnedRef/);
});
