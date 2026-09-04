import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mayEdit,
  protectRange,
  protectSheet,
  protectionAt,
  protectionInRect,
  readProtection,
  refusalMessage,
  shiftProtection,
  unprotectRange,
} from "./protection";

const totals = { top: 5, left: 0, bottom: 5, right: 3 };

test("ranges protect their cells; the owner may still edit them", () => {
  const p = protectRange(undefined, "r1", totals, "quarterly totals");
  assert.equal(protectionAt(p, 5, 2)?.kind, "range");
  assert.equal(protectionAt(p, 4, 2), null);
  assert.equal(mayEdit(p, "editor", { top: 5, left: 1, bottom: 5, right: 1 }), false);
  assert.equal(mayEdit(p, "editor", { top: 0, left: 0, bottom: 4, right: 9 }), true);
  assert.equal(mayEdit(p, "owner", totals), true);
  assert.equal(mayEdit(p, undefined, totals), false, "no known access is treated as not the owner");
  const hit = protectionInRect(p, { top: 3, left: 2, bottom: 6, right: 2 });
  assert.ok(hit && hit.kind === "range");
  assert.equal(refusalMessage(hit!), "quarterly totals (A6:D6) is protected. Only the owner can change it.");
});

test("protecting the sheet covers everything, and removing the last protection leaves nothing", () => {
  let p = protectSheet(undefined, true);
  assert.deepEqual(p, { sheet: true });
  assert.equal(protectionAt(p, 100, 100)?.kind, "sheet");
  assert.equal(refusalMessage({ kind: "sheet" }), "This sheet is protected. Only the owner can change it.");
  p = protectSheet(p, false);
  assert.equal(p, undefined);
  p = protectRange(p, "a", totals);
  p = unprotectRange(p, "a");
  assert.equal(p, undefined, "an empty protection object is not kept");
});

test("ranges follow inserted and deleted rows", () => {
  const p = protectRange(undefined, "a", totals, "t");
  assert.deepEqual(shiftProtection(p, { axis: "row", at: 0, count: 2, mode: "insert" })?.ranges?.[0].rect, { top: 7, left: 0, bottom: 7, right: 3 });
  assert.equal(shiftProtection(p, { axis: "row", at: 5, count: 1, mode: "delete" }), undefined, "a deleted range is gone");
  assert.deepEqual(shiftProtection(p, { axis: "col", at: 1, count: 1, mode: "delete" })?.ranges?.[0].rect, { top: 5, left: 0, bottom: 5, right: 2 });
  assert.equal(shiftProtection(undefined, { axis: "row", at: 0, count: 1, mode: "insert" }), undefined);
});

test("stored protection is read defensively", () => {
  const p = readProtection({ sheet: false, ranges: [{ id: "a", rect: totals, note: "ok" }, { id: 1, rect: totals }, { id: "b", rect: { top: -1 } }] });
  assert.deepEqual(p, { ranges: [{ id: "a", rect: totals, note: "ok" }] });
  assert.equal(readProtection({ sheet: false, ranges: [] }), undefined);
  assert.deepEqual(readProtection({ sheet: true }), { sheet: true });
  assert.equal(readProtection("nope"), undefined);
});
