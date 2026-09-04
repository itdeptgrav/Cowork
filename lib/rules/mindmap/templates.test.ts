import assert from "node:assert/strict";
import { test } from "node:test";
import { MINDMAP_TEMPLATES, templateNodes } from "./templates.ts";
import { mindmapTreeRefusal } from "./validity.ts";

test("every template parses to a tree the engine would accept, with one root", () => {
  for (const t of MINDMAP_TEMPLATES) {
    let n = 0;
    const nodes = templateNodes(t, () => `${t.id}-${++n}`);
    assert.equal(mindmapTreeRefusal(nodes), null, t.id);
    assert.equal(nodes.filter((x) => x.parentId === null).length, 1, t.id);
    assert.ok(nodes.length >= 1, t.id);
  }
});

test("a title given at creation replaces the template's root title", () => {
  const swot = MINDMAP_TEMPLATES.find((t) => t.id === "swot")!;
  let n = 0;
  const nodes = templateNodes(swot, () => `s${++n}`, "Q4 SWOT");
  assert.equal(nodes[0].title, "Q4 SWOT");
  assert.equal(nodes.length, 5);
});

test("the blank template is exactly one root card", () => {
  const blank = MINDMAP_TEMPLATES.find((t) => t.id === "blank")!;
  assert.equal(templateNodes(blank, () => "r").length, 1);
});
