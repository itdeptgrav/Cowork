import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asksForTimeAdjustment,
  normaliseTexts,
  removalRefusal,
  requirementChangeSummary,
  withRequirementEdited,
  withRequirementRemoved,
  withRequirementsAdded,
} from "./requirementEdits.ts";

const FIVE = ["1111", "222", "3333", "444", "555"];

/* ── The three operations ─────────────────────────────────────────────────── */

test("a requirement is appended to the end", () => {
  const edit = withRequirementsAdded(FIVE, ["666"]);
  assert.ok(edit);
  assert.deepEqual(edit.texts, [...FIVE, "666"]);
  assert.equal(edit.kind, "added");
  assert.equal(edit.subject, "666");
});

test("several added at once are one change, not one per line", () => {
  /* The composer takes one per line. Splitting that into separate writes would
     ask for the time adjustment once per line for a single act. */
  const edit = withRequirementsAdded(FIVE, ["666", "777"]);
  assert.ok(edit);
  assert.equal(edit.texts.length, 7);
  assert.equal(edit.subject, "2 requirements");
});

test("removing one leaves the rest in order", () => {
  const edit = withRequirementRemoved(FIVE, 2);
  assert.ok(edit);
  assert.deepEqual(edit.texts, ["1111", "222", "444", "555"]);
  assert.equal(edit.subject, "3333");
});

test("the last requirement may be removed", () => {
  /* A task with none is an ordinary task, and the panel already renders that
     state. Refusing would mean a list that can only grow. */
  const edit = withRequirementRemoved(["only one"], 0);
  assert.ok(edit);
  assert.deepEqual(edit.texts, []);
});

test("editing replaces one line and touches no other", () => {
  const edit = withRequirementEdited(FIVE, 1, "222 corrected");
  assert.ok(edit);
  assert.deepEqual(edit.texts, [
    "1111",
    "222 corrected",
    "3333",
    "444",
    "555",
  ]);
  assert.equal(edit.kind, "edited");
});

/* ── What is refused, and why it matters ──────────────────────────────────── */

test("an edit to empty is not a delete", () => {
  /* Clearing the box and saving would silently remove the requirement while the
     person believed they were editing it. Deleting has its own control. */
  assert.equal(withRequirementEdited(FIVE, 0, "   "), null);
  assert.equal(withRequirementEdited(FIVE, 0, ""), null);
});

test("an edit that changes nothing is not a write", () => {
  assert.equal(withRequirementEdited(FIVE, 0, "1111"), null);
  assert.equal(withRequirementEdited(FIVE, 0, "  1111  "), null);
});

test("an index off the end changes nothing", () => {
  /* The list on screen can be a render behind the one in the repository. An
     out-of-range index has to be a no-op rather than an append or a throw. */
  for (const bad of [-1, 5, 99, 1.5, NaN]) {
    assert.equal(withRequirementRemoved(FIVE, bad), null, `removed at ${bad}`);
    assert.equal(withRequirementEdited(FIVE, bad, "x"), null, `edited at ${bad}`);
  }
});

test("adding nothing is not a change", () => {
  assert.equal(withRequirementsAdded(FIVE, []), null);
  assert.equal(withRequirementsAdded(FIVE, ["", "  "]), null);
});

test("blank lines are dropped rather than stored", () => {
  assert.deepEqual(normaliseTexts([" a ", "", "  ", "b"]), ["a", "b"]);
});

/* ── When the time prompt appears ─────────────────────────────────────────── */

test("adding and removing ask about time; rewording does not", () => {
  /*
   * Adding work and dropping work change how long the task takes. Fixing a typo
   * does not, and prompting every time somebody corrects a word would train
   * people to dismiss the prompt — which is how the one that mattered gets
   * dismissed too.
   */
  assert.equal(asksForTimeAdjustment("added"), true);
  assert.equal(asksForTimeAdjustment("removed"), true);
  assert.equal(asksForTimeAdjustment("edited"), false);
});

test("the prompt names what just happened", () => {
  const added = withRequirementsAdded(FIVE, ["666"])!;
  const removed = withRequirementRemoved(FIVE, 0)!;
  assert.match(requirementChangeSummary(added), /Added/);
  assert.match(requirementChangeSummary(added), /666/);
  assert.match(requirementChangeSummary(removed), /Removed/);
  assert.match(requirementChangeSummary(removed), /1111/);
});

/* ── The list is never corrupted ──────────────────────────────────────────── */

test("no operation mutates the list it was given", () => {
  const original = [...FIVE];
  withRequirementsAdded(FIVE, ["666"]);
  withRequirementRemoved(FIVE, 0);
  withRequirementEdited(FIVE, 0, "changed");
  assert.deepEqual(FIVE, original, "the caller's array was modified");
});

/* ── Removal cannot silently re-point a subtask ───────────────────────────── */

test("a requirement a subtask is claiming cannot be removed", () => {
  /* Removing it orphans the subtask's claim outright. */
  const refusal = removalRefusal([0, 2, 0], 1);
  assert.ok(refusal);
  assert.match(refusal!, /subtask/i);
});

test("removing above a claimed requirement is refused, because ids are indexes", () => {
  /*
   * **The reason this rule exists at all.** `taskMap.ts` mints a requirement's
   * id as `req-<index>`, and a subtask stores that string. Removing index 0
   * renumbers everything below: a subtask claiming `req-2` afterwards points at
   * what used to be `req-3`. It still resolves, still renders, and now means a
   * different piece of work — with nothing reporting an error.
   */
  const refusal = removalRefusal([0, 0, 1], 0);
  assert.ok(refusal);
  assert.match(refusal!, /up a place/i);
});

test("removing below every claim is allowed — nothing shifts", () => {
  /* Claims sit at 0 and 1; removing 3 moves neither. */
  assert.equal(removalRefusal([1, 1, 0, 0], 3), null);
  assert.equal(removalRefusal([1, 1, 0, 0], 2), null);
});

test("with no subtasks at all, every requirement can be removed", () => {
  const none = [0, 0, 0, 0, 0];
  for (let i = 0; i < none.length; i++) {
    assert.equal(removalRefusal(none, i), null, `index ${i} was refused`);
  }
});

test("an index off the end is not refused — it is simply not a removal", () => {
  /* `withRequirementRemoved` already answers null for those; a refusal message
     here would put a reason on screen for something nobody attempted. */
  assert.equal(removalRefusal([1, 1], 5), null);
  assert.equal(removalRefusal([1, 1], -1), null);
});
