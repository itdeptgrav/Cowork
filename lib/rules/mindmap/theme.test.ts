import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accentOf,
  depthColour,
  fontSizeOf,
  parseColour,
  priorityMarker,
  radiusOf,
  textOn,
  THEME_IDS,
  THEMES,
  themeOf,
} from "./theme.ts";
import { newNode } from "./tree.ts";

test("every theme has a full palette, and an unknown theme falls back to field", () => {
  for (const id of THEME_IDS) {
    const t = THEMES[id];
    assert.equal(t.id, id);
    assert.ok(t.depths.length >= 6, `${id} needs six depth colours`);
    assert.ok(t.swatches.length >= 6);
    assert.ok(t.card && t.text && t.line);
  }
  assert.equal(themeOf(undefined).id, "field");
  assert.equal(themeOf("nope" as never).id, "field");
});

test("depth colours cycle rather than running out", () => {
  const t = themeOf("vivid");
  assert.equal(depthColour(t, 0), t.depths[0]);
  assert.equal(depthColour(t, t.depths.length), t.depths[0]);
  assert.equal(depthColour(t, -3), t.depths[0], "a negative depth is the root's");
});

test("a card's own fill wins over its depth colour", () => {
  const t = themeOf("field");
  const plain = newNode("a", "root", "A");
  assert.equal(accentOf(plain, 2, t), depthColour(t, 2));
  const filled = { ...plain, style: { fill: "#123456" } };
  assert.equal(accentOf(filled, 2, t), "#123456");
});

test("sizes and shapes map to numbers the canvas and export share", () => {
  assert.equal(fontSizeOf(undefined), 13);
  assert.equal(fontSizeOf({ size: "xl" }), 18);
  assert.ok(fontSizeOf({ size: "s" }) < fontSizeOf({ size: "m" }));
  assert.equal(radiusOf(undefined, 52), 10);
  assert.equal(radiusOf({ shape: "pill" }, 52), 26);
  assert.equal(radiusOf({ shape: "rect" }, 52), 3);
  assert.equal(radiusOf({ shape: "underline" }, 52), 0);
});

test("priority markers are numbered and coloured hot to cold", () => {
  assert.equal(priorityMarker(1).label, "1");
  assert.notEqual(priorityMarker(1).colour, priorityMarker(5).colour);
});

test("text colour flips to white on a dark fill and stays dark on a light one", () => {
  const t = themeOf("field");
  assert.equal(textOn("#111111", t), "#ffffff");
  assert.equal(textOn("#f2e6d2", t), "#0a0a0a");
  assert.equal(textOn(undefined, t), t.text);
  /* A colour the parser cannot read is not a reason to guess: the theme's. */
  assert.equal(textOn("mauve", t), t.text);
});

test("colour parsing accepts short hex, long hex and rgb(), and nothing else", () => {
  assert.deepEqual(parseColour("#fff"), [255, 255, 255]);
  assert.deepEqual(parseColour("#0a0b0c"), [10, 11, 12]);
  assert.deepEqual(parseColour("rgb(1, 2, 3)"), [1, 2, 3]);
  assert.deepEqual(parseColour("rgba(4,5,6,0.5)"), [4, 5, 6]);
  assert.equal(parseColour("var(--x)"), null);
  assert.equal(parseColour("url(x)"), null);
});
