import assert from "node:assert/strict";
import { test } from "node:test";

import { axisLabelVisibility } from "./axisLabels.ts";

/** Which indices are readable at each breakpoint, given the returned classes. */
function visibleAt(count: number, width: "phone" | "tablet" | "deck"): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const cls = axisLabelVisibility(i, count);
    if (cls === "") {
      out.push(i);
      continue;
    }
    if (width === "phone") continue;
    if (width === "tablet" && cls.includes("sm:visible")) out.push(i);
    if (width === "deck") out.push(i);
  }
  return out;
}

test("a short axis is never thinned", () => {
  for (let i = 0; i < 5; i++) assert.equal(axisLabelVisibility(i, 5), "");
});

test("a phone keeps every fourth label, and both ends", () => {
  /* Twelve weeks in a 330px card: three or four dates are readable, twelve are
     not — and six were still being truncated to "15 J…", which is the fault
     this exists to fix. */
  assert.deepEqual(visibleAt(12, "phone"), [0, 4, 8, 11]);
});

test("a tablet keeps every second, a wide window keeps them all", () => {
  assert.deepEqual(visibleAt(12, "tablet"), [0, 2, 4, 6, 8, 10, 11]);
  assert.deepEqual(visibleAt(12, "deck"), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("each width is a superset of the narrower one — nothing flickers away", () => {
  for (const count of [6, 9, 12, 24]) {
    const phone = new Set(visibleAt(count, "phone"));
    const tablet = new Set(visibleAt(count, "tablet"));
    const deck = new Set(visibleAt(count, "deck"));
    for (const i of phone)
      assert.ok(tablet.has(i), `index ${i} vanishes between phone and tablet`);
    for (const i of tablet)
      assert.ok(deck.has(i), `index ${i} vanishes between tablet and deck`);
  }
});

test("the first and last label always survive", () => {
  for (const count of [6, 12, 24]) {
    assert.equal(axisLabelVisibility(0, count), "");
    assert.equal(axisLabelVisibility(count - 1, count), "");
  }
});

test("a phone never has to read more than a handful", () => {
  /* The point of the rule: whatever the series length, the phone axis stays
     legible rather than becoming a row of ellipses. */
  for (const count of [12, 24, 52]) {
    assert.ok(
      visibleAt(count, "phone").length <= Math.ceil(count / 4) + 1,
      `too many labels survive on a phone for ${count} points`,
    );
  }
});
