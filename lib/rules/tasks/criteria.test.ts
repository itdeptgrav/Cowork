import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addCriterion,
  commitCriterion,
  removeCriterion,
} from "./criteria.ts";

const LIST = ["wwwww", "ssss", "fffff"];

test("an edit replaces the criterion in place and closes the editor", () => {
  const r = commitCriterion(LIST, 1, "revised");
  assert.deepEqual(r.list, ["wwwww", "revised", "fffff"]);
  assert.equal(r.editingIndex, -1);
});

test("surrounding whitespace is not saved", () => {
  assert.deepEqual(commitCriterion(LIST, 0, "  trimmed  ").list, [
    "trimmed",
    "ssss",
    "fffff",
  ]);
});

test("emptying a criterion removes it rather than saving a blank row", () => {
  /* A blank acceptance criterion is one the reviewer cannot judge and the
     assignee cannot satisfy. Deleting every character of one is somebody
     saying they want rid of it. */
  assert.deepEqual(commitCriterion(LIST, 1, "   ").list, ["wwwww", "fffff"]);
});

test("committing with no editor open changes nothing", () => {
  const r = commitCriterion(LIST, -1, "ignored");
  assert.deepEqual(r.list, LIST);
  assert.equal(r.editingIndex, -1);
});

test("removing the row being edited closes the editor", () => {
  /* It would otherwise stay open over a line that no longer exists. */
  const r = removeCriterion(LIST, 1, 1);
  assert.deepEqual(r.list, ["wwwww", "fffff"]);
  assert.equal(r.editingIndex, -1);
});

test("removing a row ABOVE the edited one moves the editor down with it", () => {
  /* The bug this exists for. Editing "fffff" at index 2 and deleting "wwwww"
     leaves "fffff" at index 1 — an editor still holding 2 would be pointing
     past the end, and holding the old index in a longer list would rewrite the
     wrong criterion entirely. */
  const r = removeCriterion(LIST, 0, 2);
  assert.deepEqual(r.list, ["ssss", "fffff"]);
  assert.equal(r.editingIndex, 1);
  assert.equal(r.list[r.editingIndex], "fffff");
});

test("removing a row BELOW the edited one leaves the editor alone", () => {
  const r = removeCriterion(LIST, 2, 0);
  assert.deepEqual(r.list, ["wwwww", "ssss"]);
  assert.equal(r.editingIndex, 0);
  assert.equal(r.list[r.editingIndex], "wwwww");
});

test("the editor still points at the same TEXT after any removal", () => {
  /* The property that matters, checked exhaustively rather than by example:
     whatever was being edited is still what is being edited, unless it was the
     thing removed. */
  for (let editing = 0; editing < LIST.length; editing++) {
    for (let remove = 0; remove < LIST.length; remove++) {
      const before = LIST[editing];
      const r = removeCriterion(LIST, remove, editing);
      if (remove === editing) {
        assert.equal(r.editingIndex, -1, `editing ${editing}, removed ${remove}`);
      } else {
        assert.equal(
          r.list[r.editingIndex],
          before,
          `editing ${editing}, removed ${remove}`,
        );
      }
    }
  }
});

test("adding ignores blank input", () => {
  assert.deepEqual(addCriterion(LIST, "   "), LIST);
  assert.deepEqual(addCriterion(LIST, " new "), [...LIST, "new"]);
});

test("an out-of-range removal is a no-op, not a corrupted list", () => {
  assert.deepEqual(removeCriterion(LIST, 9, 1).list, LIST);
  assert.equal(removeCriterion(LIST, 9, 1).editingIndex, 1);
});
