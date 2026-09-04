import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mindmapToSvg } from "./exportImage.ts";
import { layoutMap, type MindMap } from "./tree.ts";

/**
 * An export is the DOCUMENT, not the view of it.
 *
 * `layoutMap` places nothing beneath a collapsed node, which is right on screen
 * — a collapsed branch is not there to be drawn. The export reused that layout,
 * so folding a branch away before pressing Download silently dropped it from
 * the file, and nothing said so: the PDF looked complete because it matched the
 * screen it was taken from. A reader opening it has no chevron to press.
 */

const map: MindMap = {
  id: "m-1",
  title: "Mayfair property page",
  updatedAt: "2026-08-07T06:00:00.000Z",
  nodes: [
    { id: "root", parentId: null, title: "MAYFAIR PROPERTY PAGE", collapsed: false },
    { id: "hero", parentId: "root", title: "HERO", collapsed: true },
    { id: "name", parentId: "hero", title: "Property Name", collapsed: false },
    { id: "video", parentId: "hero", title: "Hero Video / Image", collapsed: false },
    { id: "deep", parentId: "video", title: "Buried two levels down", collapsed: false },
  ] as never,
};

test("a collapsed branch is still in the exported file", () => {
  const svg = mindmapToSvg(map);
  for (const title of ["Property Name", "Hero Video / Image", "Buried two levels down"]) {
    assert.ok(
      svg.includes(title),
      `"${title}" is folded away on screen and missing from the export`,
    );
  }
});

test("the export is sized for everything it contains, not for the visible part", () => {
  /* The second half of the same fault, and the worse one: with the drawing
     expanded but the canvas measured from the collapsed shape, the branches
     would be present and squashed into the smaller frame. */
  const collapsedLayout = layoutMap(map);
  const svg = mindmapToSvg(map);
  const height = Number(/height="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 0);

  assert.ok(height > 0, "the export has no height");
  assert.ok(
    height > collapsedLayout.height,
    `the export is ${height}px tall — the collapsed view's ${collapsedLayout.height}px — ` +
      "so the hidden branches have nowhere to go",
  );
});

test("exporting does not open the branches on screen", () => {
  /* The map is shared and live. Expanding it to export it would change what
     everybody else is looking at. */
  const before = map.nodes.map((n) => n.collapsed);
  mindmapToSvg(map);
  assert.deepEqual(
    map.nodes.map((n) => n.collapsed),
    before,
    "exporting mutated the live map",
  );
});

test("a map with nothing collapsed is unchanged", () => {
  const open: MindMap = {
    ...map,
    nodes: map.nodes.map((n) => ({ ...n, collapsed: false })),
  };
  assert.equal(mindmapToSvg(open), mindmapToSvg({ ...open }));
  /* And it agrees with the collapsed map's export, because the export ignores
     the fold either way. */
  assert.equal(mindmapToSvg(open), mindmapToSvg(map));
});

test("every connector is drawn, including into a folded branch", () => {
  /* The connectors were skipped by the same `collapsed` test, so a branch could
     have appeared with nothing joining it to its parent. */
  /* The arrowhead marker in `<defs>` is a path too, and not a connector — so
     the definitions block is set aside before counting. Relationships,
     boundaries and summaries also draw paths, but this fixture has none. */
  const svg = mindmapToSvg(map).replace(/<defs>[\s\S]*?<\/defs>/, "");
  const paths = svg.match(/<path /g) ?? [];
  assert.equal(
    paths.length,
    4,
    `expected one connector per parent-child pair; found ${paths.length}`,
  );
});

/* ── The raster path, which no assertion above can reach ──────────────────── */

test("PNG and PDF measure the SAME map they draw", () => {
  /* `rasterizeMindmap` builds the SVG from the expanded map and sizes the
     canvas from a layout. If that layout is the COLLAPSED one, the branches are
     present and squashed into the visible shape's frame — worse than the
     omission this replaced, and invisible to the SVG assertions above because
     the SVG itself is correct.

     Source-read: sizing a canvas needs a DOM. */
  const src = readFileSync("lib/rules/mindmap/exportImage.ts", "utf8");
  const from = src.indexOf("async function rasterizeMindmap");
  assert.ok(from > 0, "the rasterizer was renamed");
  const body = src.slice(from, src.indexOf("\nexport async function", from));

  /* `layoutMapAs(fullyExpanded(map), kind)` since the map gained layouts —
     the rule is the same: whatever lays it out is handed the EXPANDED map. */
  assert.match(
    body,
    /layoutMap(?:As)?\(fullyExpanded\(map\)/,
    "the canvas is measured from the collapsed map while the drawing is " +
      "expanded, so every export is scaled into the wrong frame",
  );
});

test("every format goes through the one expansion", () => {
  /* SVG, PNG and PDF all render from `mindmapToSvg`, so the fold is dropped in
     one place rather than three. A format that built its own would be the one
     that quietly kept exporting half the map. */
  const src = readFileSync("lib/rules/mindmap/exportImage.ts", "utf8");
  for (const fn of ["downloadMindmapSvg", "downloadMindmapPng", "downloadMindmapPdf"]) {
    assert.ok(src.includes(`export ${fn.startsWith("downloadMindmapSvg") ? "function" : "async function"} ${fn}`), `${fn} is gone`);
  }
  assert.match(src, /const svg = mindmapToSvg\(map\);/, "the rasterizer draws its own");
});
