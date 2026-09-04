import assert from "node:assert/strict";
import { test } from "node:test";
import type { MindNode } from "../../domain/mindmap.ts";
import { presentationOrder, slideFor, stepSlide } from "./present.ts";
import type { MindMap } from "./tree.ts";

const node = (id: string, parentId: string | null, title: string, extra: Partial<MindNode> = {}): MindNode => ({
  id,
  parentId,
  title,
  description: "",
  links: [],
  images: [],
  collapsed: false,
  ...extra,
});

const map: MindMap = {
  id: "m",
  title: "Launch",
  updatedAt: "2026-09-04T00:00:00.000Z",
  nodes: [
    node("root", null, "Launch"),
    node("a", "root", "Plan", { description: "Who does what." }),
    node("a1", "a", "Scope"),
    node("a2", "a", "Dates", { collapsed: true }),
    node("a2x", "a2", "Kick-off"),
    node("b", "root", "Build"),
    node("f", null, "Parking lot", { floating: { x: 400, y: 300 } }),
    node("f1", "f", "Later idea"),
  ],
};

test("slides run in reading order, main tree first, floating topics after, folded branches included", () => {
  assert.deepEqual(presentationOrder(map), ["root", "a", "a1", "a2", "a2x", "b", "f", "f1"]);
});

test("a slide carries its place, its notes and what lies beneath", () => {
  const s = slideFor(map, "a")!;
  assert.equal(s.title, "Plan");
  assert.equal(s.description, "Who does what.");
  assert.deepEqual(s.breadcrumb, ["Launch"]);
  assert.deepEqual(s.children.map((c) => [c.title, c.count]), [["Scope", 0], ["Dates", 1]]);
  assert.equal(s.index, 2);
  assert.equal(s.total, 8);
  assert.deepEqual(slideFor(map, "a2x")!.breadcrumb, ["Launch", "Plan", "Dates"]);
  assert.equal(slideFor(map, "nope"), null);
});

test("stepping stops at the ends and starts from the beginning", () => {
  const order = presentationOrder(map);
  assert.equal(stepSlide(order, null, 1), "root");
  assert.equal(stepSlide(order, null, -1), "f1");
  assert.equal(stepSlide(order, "root", -1), "root");
  assert.equal(stepSlide(order, "f1", 1), "f1");
  assert.equal(stepSlide(order, "a", 1), "a1");
  assert.equal(stepSlide([], null, 1), null);
});
