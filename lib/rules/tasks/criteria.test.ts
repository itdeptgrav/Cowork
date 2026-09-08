import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addCriterion,
  commitCriterion,
  removeCriterion,
  subtaskCriteria,
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

/* ── What a subtask is created with ───────────────────────────────────────── */

/**
 * A subtask claims one of its parent's completion requirements, and that claim
 * is the reason it exists. It used to be carried only as a link on the parent,
 * so the child was created with just the criteria typed into its own form: the
 * person doing it saw two criteria, and the thing they were actually
 * answerable for appeared nowhere on their task.
 */

test("the claimed requirement is a criterion on the subtask, ahead of the typed ones", () => {
  assert.deepEqual(
    subtaskCriteria(["meeting system need to complete"], ["need to do 1", "need to do 2"]),
    ["meeting system need to complete", "need to do 1", "need to do 2"],
  );
});

test("several claimed requirements all come through, in the parent's order", () => {
  assert.deepEqual(
    subtaskCriteria(["first", "second"], ["typed"]),
    ["first", "second", "typed"],
  );
});

test("claiming nothing leaves the typed list exactly as it was", () => {
  /* An ordinary task in a project claims no requirement, and must be created
     with what was typed and nothing else. */
  assert.deepEqual(subtaskCriteria([], ["a", "b"]), ["a", "b"]);
  assert.deepEqual(subtaskCriteria([], []), []);
});

test("typing the claimed requirement out again makes one criterion, not two", () => {
  /* Two identical rows is two things for a reviewer to tick for one promise.
     Matched without regard to case or surrounding space, because that is the
     same sentence however it was retyped. */
  assert.deepEqual(
    subtaskCriteria(["Check the tariff tables"], ["  check the TARIFF tables  ", "and file it"]),
    ["Check the tariff tables", "and file it"],
  );
});

test("the parent's own spelling is the one kept", () => {
  /* The inherited row is first, so it wins the de-duplication — the criterion
     reads as the requirement it answers, not as somebody's paraphrase. */
  assert.deepEqual(subtaskCriteria(["Ship IT"], ["ship it"]), ["Ship IT"]);
});

test("blank and whitespace-only entries are dropped from either side", () => {
  assert.deepEqual(subtaskCriteria(["  ", "real"], ["", "  ", "typed"]), [
    "real",
    "typed",
  ]);
});

test("a repeat WITHIN the typed list collapses too", () => {
  assert.deepEqual(subtaskCriteria([], ["same", "SAME", "other"]), [
    "same",
    "other",
  ]);
});

test("neither input list is mutated", () => {
  const inherited = ["a"];
  const typed = ["b"];
  subtaskCriteria(inherited, typed);
  assert.deepEqual(inherited, ["a"]);
  assert.deepEqual(typed, ["b"]);
});
