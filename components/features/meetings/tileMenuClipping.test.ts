import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The per-tile "Pin to the screen" menu, on a tile too narrow to hold it.
 *
 * ## The reported fault
 *
 * The menu button sits in a tile's top-right corner; its dropdown was a fixed
 * `w-56` (224px) anchored to that corner, growing LEFT. A camera tile in the
 * main grid is easily wide enough — but `RoomStage`'s side strip, drawn while
 * somebody is sharing their screen, holds thumbnails well under 224px, and a
 * meeting room clips its own overflow (the floating window, the guest room,
 * full screen all set it). A menu that ran past a narrow tile's left edge was
 * not merely off the tile — it was cut away by that clip, and only the tail of
 * each line survived: "Pin to the screen" arrived on screen as "e screen",
 * "Show this one large. Only on your screen." as "ine large. Only on your".
 *
 * ## What holds instead
 *
 * The dropdown's width is now `min(14rem, calc(100cqw - 0.75rem))` — capped by
 * the TILE's own rendered width via a CSS container query, so on a wide tile it
 * is the same 14rem menu as before and on a narrow one it shrinks to fit rather
 * than overflowing.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const TILE = code("components/features/meetings/TileContent.tsx");

test("the tile establishes the size the menu is measured against", () => {
  /* On the FULL-TILE box, not the small button wrapper — see the next test for
     why the button wrapper must stay small. */
  const overlay = TILE.slice(
    TILE.indexOf('className="group/tile absolute inset-0'),
  );
  assert.match(
    overlay.slice(0, overlay.indexOf(">")),
    /\[container-type:inline-size\]/,
    "the tile no longer establishes a container-query context for its menu",
  );
});

test("the dropdown shrinks to the tile instead of overflowing it", () => {
  assert.match(
    TILE,
    /w-\[min\(14rem,calc\(100cqw-0\.75rem\)\)\]/,
    "the dropdown is fixed-width again, which is what overran a narrow tile",
  );
  assert.doesNotMatch(
    TILE,
    /\bw-56\b/,
    "a fixed w-56 is back on the per-tile menu",
  );
});

test("the outside-click region stays small, on purpose", () => {
  /* The tile-menu's own history: making `menuRef` span the whole tile (to get
     easy percentage math) was tried once already and is the exact bug its
     neighbouring comment warns against — every click on the tile's empty video
     area would again count as "inside the menu" and the menu would never
     close on an ordinary click elsewhere on the tile. The container query is
     what let the fix avoid reopening that. */
  const ref = TILE.slice(TILE.indexOf("const menuRef = useRef"));
  const wrapper = ref.slice(ref.indexOf("<div ref={menuRef}"));
  assert.match(
    wrapper.slice(0, wrapper.indexOf(">")),
    /absolute top-1\.5 right-1\.5 z-30/,
    "the outside-click wrapper grew past the button and its dropdown",
  );
});

test("the dropdown still opens from the same button and the same right-click", () => {
  /* The sizing fix must not have touched how the menu is reached. */
  assert.match(TILE, /aria-label="Tile options"/);
  assert.match(TILE, /onContextMenu=\{\(e\) => \{/);
  assert.match(TILE, /<TileMenuList/);
});
