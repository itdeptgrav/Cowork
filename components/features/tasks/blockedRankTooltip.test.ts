import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * **The explanation has to be where the number is.**
 *
 * A blocked task shows the position it holds — P2 — rather than the P1 somebody
 * set. That is the owner rule of 21 Aug 2026, and it leaves a reader with a
 * rank that moved and no reason given.
 *
 * `rankTitle` writes the reason, and it was wired to `TasksOverview` and
 * `TaskDetail` only. The task LIST — the screen this is actually read on — had
 * three hardcoded tooltips ("Change priority", "Your priority is set by your
 * manager", rank conflict) and none of them mentioned a demotion.
 */

const table = readFileSync("components/features/tasks/TaskTable.tsx", "utf8");

test("the list chip explains a demotion instead of offering only 'Change priority'", () => {
  assert.match(table, /const blockedNote = rankDisplay\.isBlocked \? rankTitle\(rankDisplay\) : null;/);
  assert.match(table, /\(blockedNote \?\? "Change priority"\)/);
  assert.match(table, /\(blockedNote \?\? "Your priority is set by your manager"\)/);
});

test("a rank conflict still wins — it is the more urgent fault", () => {
  /* Two tasks holding one rank is a defect in the data; being blocked is the
     system working. The conflict must not be hidden behind the explanation. */
  const conflictFirst = table.indexOf("Rank conflict — more than one task holds this rank");
  const noteAfter = table.indexOf("blockedNote ??", conflictFirst);
  assert.ok(conflictFirst !== -1 && noteAfter > conflictFirst);
});

test("the compact card carries the same sentence", () => {
  /* It renders the identical chip and had no title at all. */
  assert.match(table, /title=\{rankTitle\(rankFor\(view, viewerId\)\)\}/);
});

test("the tooltip is not re-written inline anywhere", () => {
  /* One sentence, one author. The list must ASK `rankTitle`, never restate it —
     restating is how the two surfaces drifted apart in the first place. */
  assert.doesNotMatch(table, /waiting on an input/);
  assert.doesNotMatch(table, /takes that place back/);
});
