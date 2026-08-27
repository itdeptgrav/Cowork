/**
 * Style-model audit — merge/patch semantics, border presets over real
 * selections, registry interning and restore, conditional-format layering, and
 * the CSS adapter — against the contracts the toolbar and renderer rely on.
 *
 * The reference behaviours are the ones `useSpreadsheet` builds on:
 *  · applyFormat  = mergeStyle(current, patch) — explicit-undefined CLEARS,
 *    an absent key INHERITS;
 *  · applyBorders = borderEdgesForPreset + per-edge rebuild + mergeStyle;
 *  · effectiveStyle = cell style with each matching CF rule's style layered
 *    on top, later rules winning, the stored style untouched;
 *  · clearFormatting = style id 0.
 *
 * Failing assertions are kept, marked `BUG(<id>)`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  borderEdgesForPreset,
  deserializeStyle,
  DEFAULT_STYLE_ID,
  EDGES,
  isEmptyStyle,
  mergeStyle,
  normalizeStyle,
  serializeStyle,
  StyleRegistry,
  type Border,
  type Borders,
  type BorderPreset,
  type CellStyle,
} from "@/lib/spreadsheet/style";
import { styleToCss } from "@/components/features/spreadsheet/cellStyle";

const THIN: Border = { style: "thin", color: "#111111" };
const RED: Border = { style: "medium", color: "#ff0000" };

/* ── Merge / patch semantics ──────────────────────────────────────────────── */

test("AUDIT: mergeStyle — absent key inherits, explicit undefined clears", () => {
  const base: CellStyle = { bold: true, color: "#333333", numberFormat: { kind: "currency" } };
  // Absent keys survive the patch untouched.
  assert.deepEqual(mergeStyle(base, { italic: true }), {
    bold: true,
    italic: true,
    color: "#333333",
    numberFormat: { kind: "currency" },
  });
  // An explicit undefined clears — this is how the ribbon's "General" resets
  // the number format (HomeTab.tsx set({ numberFormat: undefined })).
  assert.deepEqual(mergeStyle(base, { numberFormat: undefined }), {
    bold: true,
    color: "#333333",
  });
  // And a false mark drops out entirely rather than being stored as false.
  assert.deepEqual(mergeStyle(base, { bold: false }), {
    color: "#333333",
    numberFormat: { kind: "currency" },
  });
});

test("AUDIT: number format normalisation keeps meaningful zeros, drops automatic", () => {
  // decimals: 0 is a real choice ($1,235) and must survive normalisation.
  assert.deepEqual(normalizeStyle({ numberFormat: { kind: "currency", decimals: 0 } }), {
    numberFormat: { kind: "currency", decimals: 0 },
  });
  // `automatic` IS the default, so it normalises away even with riders —
  // consistent with formatValue, which ignores decimals under automatic, and
  // with the ribbon, which converts automatic→number before stepping decimals.
  assert.deepEqual(normalizeStyle({ numberFormat: { kind: "automatic", decimals: 4 } }), {});
  // An empty currency string is no currency.
  const norm = normalizeStyle({ numberFormat: { kind: "currency", currency: "" } });
  assert.equal(norm.numberFormat?.currency, undefined);
});

test("AUDIT: every style field round-trips through serialize/deserialize", () => {
  const full: CellStyle = {
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontSize: 18,
    bold: true,
    italic: true,
    underline: true,
    strikethrough: true,
    color: "#9c0006",
    background: "#ffc7ce",
    align: "center",
    valign: "bottom",
    wrap: true,
    borders: { top: THIN, right: RED, bottom: THIN, left: RED },
    numberFormat: { kind: "accounting", decimals: 0, currency: "€" },
  };
  assert.deepEqual(deserializeStyle(serializeStyle(full)), normalizeStyle(full));
  // The canonical form is key-order independent — borders written in any order
  // serialise identically (EDGES fixes the order).
  const a = serializeStyle({ borders: { left: THIN, top: RED } });
  const b = serializeStyle({ borders: { top: RED, left: THIN } });
  assert.equal(a, b);
  assert.deepEqual(EDGES, ["top", "right", "bottom", "left"]);
});

test("AUDIT: border normalisation — colourless edges default, styleless edges drop", () => {
  const norm = normalizeStyle({
    borders: {
      top: { style: "thin", color: "" }, // no colour → black
      left: { style: undefined as unknown as Border["style"], color: "#f00" }, // no stroke → gone
    },
  });
  assert.deepEqual(norm.borders, { top: { style: "thin", color: "#000000" } });
  // All edges styleless → borders drops entirely → the style can reach {} again.
  assert.equal(isEmptyStyle({ borders: {} }), true);
});

/* ── Border presets over multi-cell selections ────────────────────────────── */

/** The exact algorithm applyBorders runs (useSpreadsheet.ts:1307) — rebuild the
    touched edges per cell, then merge. Replicated here so the pure contract the
    hook depends on is what gets audited. */
function applyPreset(
  current: Map<string, CellStyle>,
  range: { top: number; left: number; bottom: number; right: number },
  preset: BorderPreset,
  border: Border | null,
): Map<string, CellStyle> {
  const next = new Map(current);
  for (const { row, col, edges } of borderEdgesForPreset(range, preset)) {
    const cur = current.get(`${row}:${col}`) ?? {};
    const borders: Borders = { ...cur.borders };
    for (const edge of edges) {
      if (border && preset !== "none") borders[edge] = border;
      else delete borders[edge];
    }
    next.set(`${row}:${col}`, mergeStyle(cur, { borders }));
  }
  return next;
}

test("AUDIT: 'outer' on a 3x3 borders only the perimeter — corners two edges, middle none", () => {
  const plan = borderEdgesForPreset({ top: 0, left: 0, bottom: 2, right: 2 }, "outer");
  const byCell = new Map(plan.map((p) => [`${p.row}:${p.col}`, [...p.edges].sort()]));
  assert.equal(plan.length, 8, "eight perimeter cells; the centre gets no entry");
  assert.equal(byCell.has("1:1"), false, "the interior cell is untouched");
  // Corners: exactly their two outside edges.
  assert.deepEqual(byCell.get("0:0"), ["left", "top"]);
  assert.deepEqual(byCell.get("0:2"), ["right", "top"]);
  assert.deepEqual(byCell.get("2:0"), ["bottom", "left"]);
  assert.deepEqual(byCell.get("2:2"), ["bottom", "right"]);
  // Edge centres: exactly one edge.
  assert.deepEqual(byCell.get("0:1"), ["top"]);
  assert.deepEqual(byCell.get("1:0"), ["left"]);
  assert.deepEqual(byCell.get("1:2"), ["right"]);
  assert.deepEqual(byCell.get("2:1"), ["bottom"]);
});

test("AUDIT: 'outer' degenerate shapes — single cell and single row", () => {
  const single = borderEdgesForPreset({ top: 3, left: 3, bottom: 3, right: 3 }, "outer");
  assert.equal(single.length, 1);
  assert.deepEqual([...single[0].edges].sort(), ["bottom", "left", "right", "top"]);

  const row = borderEdgesForPreset({ top: 1, left: 0, bottom: 1, right: 2 }, "outer");
  const byCell = new Map(row.map((p) => [`${p.row}:${p.col}`, [...p.edges].sort()]));
  assert.deepEqual(byCell.get("1:0"), ["bottom", "left", "top"]);
  assert.deepEqual(byCell.get("1:1"), ["bottom", "top"], "a 1-row range is all top+bottom");
  assert.deepEqual(byCell.get("1:2"), ["bottom", "right", "top"]);
});

test("AUDIT: presets compose — 'none' clears exactly what 'all' set, keeping other styling", () => {
  const range = { top: 0, left: 0, bottom: 1, right: 1 };
  let cells = new Map<string, CellStyle>([["0:0", { bold: true }]]);
  cells = applyPreset(cells, range, "all", RED);
  assert.deepEqual(cells.get("0:0")?.borders, { top: RED, right: RED, bottom: RED, left: RED });
  assert.equal(cells.get("0:0")?.bold, true, "bordering does not disturb the font");
  assert.deepEqual(cells.get("1:1")?.borders, { top: RED, right: RED, bottom: RED, left: RED });

  cells = applyPreset(cells, range, "none", null);
  for (const key of ["0:0", "0:1", "1:0", "1:1"]) {
    assert.equal(cells.get(key)?.borders, undefined, `${key} has no border edges left`);
  }
  assert.deepEqual(cells.get("0:0"), { bold: true }, "only the borders were cleared");
});

test("AUDIT: a side preset adds its edge without erasing edges already set", () => {
  const range = { top: 0, left: 0, bottom: 0, right: 0 };
  let cells = new Map<string, CellStyle>([["0:0", { borders: { top: THIN } }]]);
  cells = applyPreset(cells, range, "left", RED);
  assert.deepEqual(
    cells.get("0:0")?.borders,
    { top: THIN, left: RED },
    "the existing top edge survives a left-border application",
  );
  // Border style + colour land verbatim on the edge.
  const edge = cells.get("0:0")?.borders?.left;
  assert.equal(edge?.style, "medium");
  assert.equal(edge?.color, "#ff0000");
});

test("AUDIT: raw mergeStyle replaces borders wholesale — the per-edge rebuild is the caller's job", () => {
  /* Documented shallow-merge: a patch's `borders` object REPLACES the base's.
     applyBorders compensates by spreading current.borders first (tested
     above); any new caller patching borders directly must do the same. */
  const merged = mergeStyle({ borders: { top: THIN } }, { borders: { left: RED } });
  assert.deepEqual(merged.borders, { left: RED }, "top was lost — by design, callers pre-merge");
});

/* ── Registry: interning, ids, restore ────────────────────────────────────── */

test("AUDIT: interning distinguishes formats that render differently", () => {
  const reg = new StyleRegistry();
  const d0 = reg.intern({ numberFormat: { kind: "number", decimals: 0 } });
  const d2 = reg.intern({ numberFormat: { kind: "number", decimals: 2 } });
  const dDefault = reg.intern({ numberFormat: { kind: "number" } });
  assert.notEqual(d0, d2, "0 vs 2 decimals are different styles");
  assert.notEqual(d2, dDefault, "explicit 2 and default-2 stay distinct records");
  const eur = reg.intern({ numberFormat: { kind: "currency", currency: "€" } });
  const usd = reg.intern({ numberFormat: { kind: "currency", currency: "$" } });
  assert.notEqual(eur, usd);
  assert.notEqual(reg.get(999), undefined, "unknown id yields the empty style, never undefined");
  assert.deepEqual(reg.get(999), {});
});

test("AUDIT: deserialize preserves ids even when entries normalise to duplicates", () => {
  /* Two persisted records that normalise identically must BOTH stay resolvable
     at their old ids (cells reference them by id); fresh interns may then
     collapse onto either. */
  const reg = StyleRegistry.deserialize('[{},{"bold":true},{"bold":true,"italic":false}]');
  assert.deepEqual(reg.get(1), { bold: true });
  assert.deepEqual(reg.get(2), { bold: true }, "the duplicate id still resolves");
  const fresh = reg.intern({ bold: true });
  assert.ok(fresh === 1 || fresh === 2, "a fresh intern reuses one of the existing ids");
  assert.equal(reg.size(), 3, "no new record was created");
});

test("AUDIT: deserialize survives corrupt entries instead of crashing the load", () => {
  /* A workbook file can arrive with a null (or non-object) style entry — the
     JSON import path also drops those defensively, but the registry itself
     must not be crashable by one. A corrupt STYLE degrades to the empty style
     at its id, so cells referencing it render unformatted instead of the whole
     load dying. */
  assert.doesNotThrow(() => StyleRegistry.deserialize('[null,{"bold":true}]'));
  assert.doesNotThrow(() => StyleRegistry.deserialize('[{},42,"bold"]'));
  // The ids stay aligned: the corrupt slot is {} and its neighbour survives.
  const reg = StyleRegistry.deserialize('[null,{"bold":true}]');
  assert.deepEqual(reg.get(0), {});
  assert.deepEqual(reg.get(1), { bold: true });
});

test("AUDIT: an empty or absent table restores to the default registry", () => {
  const reg = StyleRegistry.deserialize("[]");
  assert.equal(reg.size(), 1);
  assert.deepEqual(reg.get(DEFAULT_STYLE_ID), {});
  assert.equal(reg.intern({}), DEFAULT_STYLE_ID);
  assert.equal(reg.intern({ wrap: false }), DEFAULT_STYLE_ID, "normalising still lands on id 0");
});

/* ── Effective style: conditional formats layered over the cell style ─────── */

test("AUDIT: CF layering — later rules win per property, untouched properties inherit", () => {
  /* effectiveStyle (useSpreadsheet.ts:585) is mergeStyle folded left over the
     matching rules' registry styles. Audit that composition contract. */
  const reg = new StyleRegistry();
  const cellStyle: CellStyle = { bold: true, background: "#ffdddd", color: "#111111" };
  const rule1 = reg.get(reg.intern({ background: "#c6efce", color: "#006100" }));
  const rule2 = reg.get(reg.intern({ background: "#ffeb9c" }));

  const effective = mergeStyle(mergeStyle(cellStyle, rule1), rule2);
  assert.equal(effective.background, "#ffeb9c", "the LAST matching rule's fill shows");
  assert.equal(effective.color, "#006100", "rule2 sets no colour, so rule1's survives");
  assert.equal(effective.bold, true, "the cell's own weight is inherited throughout");
  // The stored cell style was never touched — clearing rules reveals it intact.
  assert.deepEqual(cellStyle, { bold: true, background: "#ffdddd", color: "#111111" });
});

test("AUDIT: a CF style can add marks but never subtract them", () => {
  /* Interning drops falsy properties, so { bold:false } becomes the empty
     style — a rule cannot un-bold a bold cell. Matches the additive model
     conditional formatting has everywhere; asserted so a change is noticed. */
  const reg = new StyleRegistry();
  const unbold = reg.get(reg.intern({ bold: false }));
  assert.deepEqual(unbold, {}, "the falsy mark vanished at intern time");
  assert.deepEqual(mergeStyle({ bold: true }, unbold), { bold: true });
});

/* ── clearFormatting ──────────────────────────────────────────────────────── */

test("AUDIT: clear formatting is style id 0 — one merge with nothing set", () => {
  const reg = new StyleRegistry();
  const heavy = reg.intern({
    bold: true,
    background: "#ffff00",
    borders: { top: THIN },
    numberFormat: { kind: "percent", decimals: 1 },
  });
  assert.notEqual(heavy, DEFAULT_STYLE_ID);
  // clearFormatting (useSpreadsheet.ts:949) writes style 0 directly; the
  // registry's id 0 must always BE the empty style for that to mean "cleared".
  assert.deepEqual(reg.get(DEFAULT_STYLE_ID), {});
  assert.equal(isEmptyStyle(reg.get(DEFAULT_STYLE_ID)), true);
});

/* ── The CSS adapter (cellStyle.ts) ───────────────────────────────────────── */

test("AUDIT: styleToCss — font, decoration, alignment and wrap translate faithfully", () => {
  const css = styleToCss(
    {
      fontFamily: "Georgia, serif",
      fontSize: 18,
      bold: true,
      italic: true,
      underline: true,
      strikethrough: true,
      color: "#123456",
      background: "#fafafa",
      valign: "top",
      wrap: true,
    },
    "right",
  );
  assert.equal(css.fontFamily, "Georgia, serif");
  assert.equal(css.fontSize, 18);
  assert.equal(css.fontWeight, 700);
  assert.equal(css.fontStyle, "italic");
  assert.equal(css.textDecorationLine, "underline line-through", "both decorations combine");
  assert.equal(css.color, "#123456");
  assert.equal(css.background, "#fafafa");
  assert.equal(css.justifyContent, "flex-end");
  assert.equal(css.textAlign, "right");
  assert.equal(css.alignItems, "flex-start");
  assert.equal(css.whiteSpace, "normal");
  assert.equal(css.wordBreak, "break-word");
});

test("AUDIT: styleToCss — defaults centre vertically, nowrap, and draw each border edge", () => {
  const css = styleToCss({ borders: { top: THIN, left: RED } }, "left");
  assert.equal(css.alignItems, "center", "no valign = middle, the spreadsheet default");
  assert.equal(css.whiteSpace, "nowrap", "unwrapped text clips, never flows");
  assert.equal(css.borderTop, "1px solid #111111");
  assert.equal(css.borderLeft, "2px solid #ff0000");
  assert.equal(css.borderRight, undefined, "unset edges draw nothing");
  // Every stroke keeps a CSS-legal width (double needs >= 3px to render).
  const strokes: [Border["style"], string][] = [
    ["thin", "1px solid"],
    ["medium", "2px solid"],
    ["thick", "3px solid"],
    ["dashed", "1px dashed"],
    ["dotted", "1px dotted"],
    ["double", "3px double"],
  ];
  for (const [style, expect] of strokes) {
    const edge = styleToCss({ borders: { top: { style, color: "#000000" } } }, "left").borderTop;
    assert.equal(edge, `${expect} #000000`);
  }
});
