import assert from "node:assert/strict";
import { test } from "node:test";
import {
  displayablePriority,
  holdersOf,
  resolveTaskPriority,
  UNRANKED,
} from "./resolveTaskPriority.ts";
import { rankOf } from "./priorityDeadline.ts";

/**
 * One priority source, for every screen.
 *
 * **The bug.** Pramod could not see a priority on his own task. Every priority
 * read — the mapper's `myRank`, its assignment ranks, the queue builder, the
 * detail header — was keyed on `assigneeIds`. A cross-department task waiting
 * at the approval gate has an EMPTY `assigneeIds` and its person sitting in
 * `pendingAssigneeId`, so all four answered "not yours" to the one person
 * holding the work, and the screen showed a dash.
 *
 * It was not a display bug. He was absent from the data.
 */

const PRAMOD = "GR0099";

test("the per-person rank beats the shared one", () => {
  const task = { assigneePriorities: { [PRAMOD]: 3, OTHER: 1 }, priority: 1 };
  assert.equal(resolveTaskPriority(task, PRAMOD), 3);
  assert.equal(resolveTaskPriority(task, "OTHER"), 1);
});

test("the shared priority is the fallback, exactly as legacy has it", () => {
  assert.equal(resolveTaskPriority({ priority: 2 }, PRAMOD), 2);
  assert.equal(resolveTaskPriority({ assigneePriorities: {}, priority: 2 }, PRAMOD), 2);
});

test("nothing written reads as unranked, never as P0", () => {
  /* `?? 0` shipped here once. P0 is not on the 1–10 scale and reads as the
     most urgent thing on the screen. */
  assert.equal(resolveTaskPriority({}, PRAMOD), UNRANKED);
  assert.equal(displayablePriority({}, PRAMOD), null);
  assert.equal(displayablePriority({ priority: 0 }, PRAMOD), null);
  assert.equal(displayablePriority({ priority: UNRANKED }, PRAMOD), null);
});

test("junk in the document does not become a rank", () => {
  assert.equal(resolveTaskPriority({ assigneePriorities: "nonsense" }, PRAMOD), UNRANKED);
  assert.equal(resolveTaskPriority({ priority: "3" as never }, PRAMOD), 3);
  /* `Number(null)` is 0, and 0 is finite — so a null entry resolved to P0,
     which is off the scale AND sorts ahead of every real priority. A person
     with one blank entry would have jumped the whole queue. */
  assert.equal(resolveTaskPriority({ assigneePriorities: { [PRAMOD]: null } }, PRAMOD), UNRANKED);
  assert.equal(resolveTaskPriority({ assigneePriorities: { [PRAMOD]: "" } }, PRAMOD), UNRANKED);
  /* And it falls THROUGH to the shared priority rather than stopping at 0. */
  assert.equal(
    resolveTaskPriority({ assigneePriorities: { [PRAMOD]: null }, priority: 4 }, PRAMOD),
    4,
  );
});

test("the deadline chain sorts by the SAME number the screen shows", () => {
  /* `rankOf` was a second copy of this expression. A task displayed at P3 and
     chained at P5 would be given a start time from a queue nobody can see. */
  const task = { assigneePriorities: { [PRAMOD]: 3 }, priority: 9 } as never;
  assert.equal(rankOf(task, PRAMOD), resolveTaskPriority(task as never, PRAMOD));
  assert.equal(rankOf(task, PRAMOD), 3);
});

/* ── Who holds the task ───────────────────────────────────────────────────── */

test("a pending assignee holds the task", () => {
  /* The whole of bug 2 in one assertion. */
  assert.deepEqual(
    holdersOf({ assigneeIds: [], pendingAssigneeIds: [PRAMOD] }),
    [PRAMOD],
  );
});

test("holders are deduplicated and order is stable", () => {
  assert.deepEqual(
    holdersOf({ assigneeIds: ["A", PRAMOD], pendingAssigneeIds: [PRAMOD, "B"] }),
    ["A", PRAMOD, "B"],
  );
  assert.deepEqual(holdersOf({}), []);
});

test("a pending assignee's rank resolves the same as an assignee's", () => {
  /* Same task, same document, two stages of the same handover. The number a
     person sees must not change because an approval has not happened yet. */
  const doc = { assigneePriorities: { [PRAMOD]: 2 }, priority: 5 };
  const held = { ...doc, assigneeIds: [], pendingAssigneeIds: [PRAMOD] };
  const handed = { ...doc, assigneeIds: [PRAMOD], pendingAssigneeIds: [] };

  assert.equal(holdersOf(held)[0], holdersOf(handed)[0]);
  assert.equal(resolveTaskPriority(held, PRAMOD), 2);
  assert.equal(resolveTaskPriority(handed, PRAMOD), 2);
});

/* ── One number, whoever is looking ───────────────────────────────────────── */

test("the viewer does not change the priority", () => {
  /* A manager and the assignee must read the same P-number off the same task.
     The resolver takes the SUBJECT, never the viewer, so there is no way to
     ask it a viewer-shaped question. */
  const task = { assigneePriorities: { [PRAMOD]: 2 }, priority: 7 };
  const managerLooking = resolveTaskPriority(task, PRAMOD);
  const pramodLooking = resolveTaskPriority(task, PRAMOD);
  assert.equal(managerLooking, 2);
  assert.equal(pramodLooking, 2);
  assert.equal(managerLooking, pramodLooking);
});
