import assert from "node:assert/strict";
import { test } from "node:test";
import {
  borderEdgesForPreset,
  deserializeStyle,
  DEFAULT_STYLE_ID,
  isEmptyStyle,
  mergeStyle,
  normalizeStyle,
  serializeStyle,
  StyleRegistry,
  type CellStyle,
} from "@/lib/spreadsheet/style";

test("normalizeStyle drops off/empty/default properties", () => {
  const s: CellStyle = {
    bold: false,
    italic: true,
    color: "",
    fontSize: 0,
    align: "left",
    wrap: false,
    numberFormat: { kind: "automatic" },
  };
  assert.deepEqual(normalizeStyle(s), { italic: true, align: "left" });
});

test("normalizeStyle keeps a real style and writes it in a fixed order", () => {
  const a = normalizeStyle({ italic: true, bold: true });
  const b = normalizeStyle({ bold: true, italic: true });
  // Same logical style → identical canonical string, whatever the input order.
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("serialize/deserialize round-trips a full style", () => {
  const s: CellStyle = {
    fontFamily: "Georgia, serif",
    fontSize: 14,
    bold: true,
    italic: true,
    underline: true,
    strikethrough: true,
    color: "#ff0000",
    background: "#00ff00",
    align: "center",
    valign: "middle",
    wrap: true,
    borders: { top: { style: "thin", color: "#111111" } },
    numberFormat: { kind: "currency", decimals: 2, currency: "$" },
  };
  const json = serializeStyle(s);
  assert.deepEqual(deserializeStyle(json), normalizeStyle(s));
});

test("the empty style is canonical and detected", () => {
  assert.equal(serializeStyle({}), "{}");
  assert.equal(serializeStyle({ bold: false, color: "" }), "{}");
  assert.equal(isEmptyStyle({ bold: false }), true);
  assert.equal(isEmptyStyle({ bold: true }), false);
});

test("StyleRegistry interns — equal styles share ONE id (the flyweight)", () => {
  const reg = new StyleRegistry();
  assert.equal(reg.size(), 1, "just the default style to start");

  const boldA = reg.intern({ bold: true });
  const boldB = reg.intern({ bold: true, italic: false }); // same after normalising
  assert.equal(boldA, boldB, "identical styles collapse to one id");
  assert.equal(reg.size(), 2, "one new record, not two");

  const italic = reg.intern({ italic: true });
  assert.notEqual(italic, boldA);
  assert.equal(reg.size(), 3);

  // A thousand bold cells would all resolve here — no duplication.
  for (let i = 0; i < 1000; i++) assert.equal(reg.intern({ bold: true }), boldA);
  assert.equal(reg.size(), 3);
});

test("the empty style is always id 0", () => {
  const reg = new StyleRegistry();
  assert.equal(reg.intern({}), DEFAULT_STYLE_ID);
  assert.equal(reg.intern({ bold: false }), DEFAULT_STYLE_ID);
});

test("toggling a mark off returns a cell to the default style (id 0)", () => {
  const reg = new StyleRegistry();
  const bold = reg.intern({ bold: true });
  const unbolded = reg.intern(mergeStyle(reg.get(bold), { bold: false }));
  assert.equal(unbolded, DEFAULT_STYLE_ID);
});

test("mergeStyle layers a patch and re-canonicalises", () => {
  const base: CellStyle = { bold: true, color: "#111111" };
  assert.deepEqual(mergeStyle(base, { italic: true }), {
    bold: true,
    italic: true,
    color: "#111111",
  });
  // A patch can also clear a property back to default.
  assert.deepEqual(mergeStyle(base, { color: undefined }), { bold: true });
});

test("the registry serialises and restores every id", () => {
  const reg = new StyleRegistry();
  const bold = reg.intern({ bold: true });
  const money = reg.intern({ numberFormat: { kind: "currency" } });

  const restored = StyleRegistry.deserialize(reg.serialize());
  assert.deepEqual(restored.get(bold), { bold: true });
  assert.deepEqual(restored.get(money), { numberFormat: { kind: "currency" } });
  // Interning the same styles into the restored registry keeps their ids.
  assert.equal(restored.intern({ bold: true }), bold);
  assert.equal(restored.intern({ numberFormat: { kind: "currency" } }), money);
});

test("borderEdgesForPreset: 'all' hits every edge of every cell", () => {
  const plan = borderEdgesForPreset({ top: 0, left: 0, bottom: 1, right: 1 }, "all");
  assert.equal(plan.length, 4);
  for (const cell of plan) assert.deepEqual([...cell.edges].sort(), ["bottom", "left", "right", "top"]);
});

test("borderEdgesForPreset: 'outer' hits only the perimeter edges", () => {
  const plan = borderEdgesForPreset({ top: 0, left: 0, bottom: 1, right: 1 }, "outer");
  const byCell = new Map(plan.map((p) => [`${p.row}:${p.col}`, p.edges.sort()]));
  assert.deepEqual(byCell.get("0:0"), ["left", "top"]);
  assert.deepEqual(byCell.get("1:1"), ["bottom", "right"]);
});

test("borderEdgesForPreset: a single side hits only that edge of the relevant line", () => {
  const plan = borderEdgesForPreset({ top: 2, left: 0, bottom: 4, right: 2 }, "top");
  // Only the top row's three cells, each with just the top edge.
  assert.equal(plan.length, 3);
  for (const cell of plan) {
    assert.equal(cell.row, 2);
    assert.deepEqual(cell.edges, ["top"]);
  }
});
