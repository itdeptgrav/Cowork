import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The rank cell against `TaskTable.tsx`'s own hold-reason branch.
 *
 * Reported as "the subtask priority is not happening": every subtask and every
 * freshly created task starts in `WAITING_FOR_ASSIGNEE` (`lib/legacy/tasks.ts`),
 * so `isBudgetSettled` is false until it is accepted. `TaskTable.tsx`'s `Row`
 * used that to blank the rank cell to an em dash UNCONDITIONALLY — discarding
 * `rankText`, which `lib/rules/tasks/priority.ts`'s `displayPriority` had
 * already resolved to the STORED rank precisely so this would not happen.
 * `activeQueue.test.ts:508` pins the rule this violated: "an unsettled task
 * reports no live rank but keeps its stored one."
 *
 * The component itself is not import-safe under `node --test` — it pulls
 * `@/lib/repositories` through `useRepository`, and the `@/` alias does not
 * resolve here (the same limitation `subtaskDelegation.test.ts` documents) — so
 * this reads the source as text, the way that file does.
 */

const source = readFileSync(
  new URL("../../../components/features/tasks/TaskTable.tsx", import.meta.url),
  "utf8",
);

test("the em-dash branch does not fire on a task with a real stored rank", () => {
  assert.match(
    source,
    /heldReason\s*&&\s*rankText\s*===\s*"—"\s*\?/,
    'the blank-dash branch must be conditioned on rankText === "—", not on heldReason alone — otherwise a real stored rank is discarded for every task awaiting acceptance',
  );
});

test("a held task with a real number shows the number, not a button", () => {
  const from = source.indexOf("Held out of the LIVE queue, but real work");
  assert.ok(from > 0, "the held-with-a-number branch is missing");
  const to = source.indexOf("onPriority ? (", from);
  const body = source.slice(from, to);
  /* `<span data-figure>{rankText}</span>` — the real value, not a fixed "—". */
  assert.match(body, /data-figure>\{rankText\}<\/span>/);
  /* Not a `<button>` — a task not yet in the live queue must not be draggable
     or open the reorder dialog, which is the one part of the original
     restriction that was correct. */
  assert.ok(!body.includes("<button"), "a held task's rank must not be a button");
});
